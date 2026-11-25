import type { Database } from "bun:sqlite";
import type { DateRange } from "./date-filter";

export interface MultitermSqlOptions {
  limit: number;
  /** Keeps sessions last updated in this range; applied before the limit. */
  dateRange?: DateRange;
}

export interface MultitermSqlResult {
  sql: string;
  binds: any[];
}

export interface MultitermSearchMatch {
  sessionID: string;
  sessionTitle: string;
  timestamp: number;
  projectDirectory: string;
  termHits: Map<string, { partID: string; matchType: string; excerpt: string }>;
}

/**
 * The searchable text of one assistant content item `item` (JSON object
 * text, or NULL): a text item's text, or a tool call's name, input and the
 * text of its output. Reasoning, and anything else, gives NULL, as in the
 * keyword and fuzzy searches.
 */
const contentText = (item: string) => `
  CASE json_extract(${item}, '$.type')
    WHEN 'text' THEN json_extract(${item}, '$.text')
    WHEN 'tool' THEN
      COALESCE(json_extract(${item}, '$.name'), '') || ' ' ||
      COALESCE(json_extract(${item}, '$.state.input'), '') || ' ' ||
      COALESCE((
        SELECT group_concat(json_extract(CASE WHEN o.type = 'object' THEN o.value END, '$.text'), ' ')
        FROM json_each(${item}, '$.state.content') o
      ), '')
  END`;

/** Joins non-NULL SQL string expressions with spaces, NULL when all are NULL or empty. */
const joined = (parts: string[]) =>
  `NULLIF(TRIM(${parts.map((part) => `COALESCE(${part}, '')`).join(" || ' ' || ")}), '')`;

// Values that are not JSON make json_extract() and json_each() throw, so
// every JSON value goes through CASE, which SQLite evaluates lazily.
const validData = "(CASE WHEN json_valid(data) THEN data END)";
const item = "(CASE WHEN c.type = 'object' THEN c.value END)";

/**
 * Searchable OpenCode 2 session content, as plain text, one row per document:
 *
 * - assistant text and tool calls from session_part;
 * - a user prompt's text plus its attachments' names and URIs, but not
 *   their content, which is base64 a term could match by chance;
 * - for each assistant message, the files it modified and any content early
 *   2.x releases kept inline.
 *
 * Reasoning is left out, and so are an assistant message's other fields
 * (model, tokens, ...), so that a model name does not match every session
 * that used it. Using text rather than the stored JSON also keeps JSON
 * syntax and escapes such as \\n out of the excerpts.
 */
const DOCUMENTS = `
  doc AS (
    SELECT session_id, message_id || ':' || ordinal AS part_id, ${contentText(validData)} AS text, time_created
    FROM session_part
    WHERE type IN ('text', 'tool')
    UNION ALL
    SELECT
      session_id,
      id AS part_id,
      ${joined([
        `json_extract(${validData}, '$.text')`,
        `(SELECT group_concat(${joined([
          `json_extract(${item}, '$.name')`,
          `json_extract(${item}, '$.source.uri')`,
        ])}, ' ') FROM json_each(${validData}, '$.files') c)`,
      ])} AS text,
      time_created
    FROM session_message
    WHERE type = 'user'
    UNION ALL
    SELECT
      session_id,
      id AS part_id,
      ${joined([
        `(SELECT group_concat(${contentText(item)}, ' ') FROM json_each(${validData}, '$.content') c)`,
        `(SELECT group_concat(CASE WHEN c.type = 'text' THEN c.value END, ' ')
          FROM json_each(${validData}, '$.snapshot.files') c)`,
      ])} AS text,
      time_created
    FROM session_message
    WHERE type = 'assistant'
  )`;

export function buildMultitermSql(
  terms: string[],
  projectID: string | null,
  options: MultitermSqlOptions,
): MultitermSqlResult {
  if (terms.length === 0) {
    throw new Error("terms array must contain at least one term");
  }

  const conditions = terms
    .map((_, i) =>
      `MAX(CASE WHEN d.text LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END) AS match_${i}`
    )
    .join(", ");

  const having = terms
    .map((_, i) => `match_${i} = 1`)
    .join(" AND ");

  const projectFilter = projectID !== null ? "AND s.project_id = ?" : "";
  const dateFilter = options.dateRange ? "AND s.time_updated BETWEEN ? AND ?" : "";

  const sql = `
    WITH ${DOCUMENTS}
    SELECT s.id AS session_id, COALESCE(s.title, '') AS title, s.directory, s.time_updated, ${conditions}
    FROM session_v2 s
    JOIN doc d ON d.session_id = s.id
    WHERE 1=1
      ${projectFilter}
      ${dateFilter}
    GROUP BY s.id
    HAVING ${having}
    ORDER BY s.time_updated DESC
    LIMIT ${options.limit}
  `.trim();

  const binds: any[] = [];
  for (const term of terms) {
    const escaped = term.replace(/[%_\\]/g, "\\$&");
    binds.push(`%${escaped}%`);
    binds.push(`%${escaped}%`);
  }
  if (projectID !== null) {
    binds.push(projectID);
  }
  if (options.dateRange) {
    binds.push(options.dateRange.start.getTime(), options.dateRange.end.getTime());
  }

  return { sql, binds };
}

export function searchMultitermSqlite(
  db: Database,
  projectID: string | null,
  terms: string[],
  options?: { limit?: number; dateRange?: DateRange },
): MultitermSearchMatch[] {
  const { sql, binds } = buildMultitermSql(terms, projectID, {
    limit: options?.limit ?? 50,
    dateRange: options?.dateRange,
  });

  type Row = {
    session_id: string;
    title: string;
    directory: string;
    time_updated: number;
  };

  const rows = db.query(sql).all(...binds) as Row[];

  if (rows.length === 0) {
    return [];
  }

  const placeholder = rows.map(() => "?").join(",");

  // Every document of the matched sessions, oldest first, to pick one excerpt per term.
  const sqlFollow = `
    WITH ${DOCUMENTS}
    SELECT session_id, part_id, text
    FROM doc
    WHERE session_id IN (${placeholder}) AND text IS NOT NULL
    ORDER BY time_created ASC
  `;

  type FollowRow = { session_id: string; part_id: string; text: string };
  const followRows = db
    .query(sqlFollow)
    .all(...rows.map((r) => r.session_id)) as FollowRow[];

  const termHitsBySession = new Map<string, Map<string, { partID: string; matchType: string; excerpt: string }>>();

  for (const row of followRows) {
    if (!termHitsBySession.has(row.session_id)) {
      termHitsBySession.set(row.session_id, new Map());
    }
    const sessionMap = termHitsBySession.get(row.session_id)!;
    if (sessionMap.size >= terms.length) continue;

    for (const term of terms) {
      if (sessionMap.has(term)) continue;
      const lower = row.text.toLowerCase();
      const termLower = term.toLowerCase();
      if (lower.includes(termLower)) {
        const idx = lower.indexOf(termLower);
        const start = Math.max(0, idx - 50);
        const end = Math.min(row.text.length, idx + termLower.length + 50);
        sessionMap.set(term, {
          partID: row.part_id,
          matchType: "data",
          // One line per term in the output, whatever the text's line breaks.
          excerpt: row.text.slice(start, end).replace(/\s+/g, " "),
        });
      }
    }
  }

  return rows.map((row) => ({
    sessionID: row.session_id,
    sessionTitle: row.title,
    timestamp: row.time_updated,
    projectDirectory: row.directory,
    termHits: termHitsBySession.get(row.session_id) ?? new Map(),
  }));
}

export async function searchMultiterm(
  projectID: string | null,
  terms: string[],
  options?: { limit?: number; dateRange?: DateRange },
): Promise<MultitermSearchMatch[]> {
  const { Database } = await import("bun:sqlite");
  const { getDbPath } = await import("../storage-sqlite");
  const dbPath = getDbPath();
  const db = new Database(dbPath, { readonly: true });
  try {
    return searchMultitermSqlite(db, projectID, terms, options);
  } finally {
    db.close();
  }
}
