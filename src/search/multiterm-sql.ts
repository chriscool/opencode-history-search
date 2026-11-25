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
 * Searchable OpenCode 2 session content, one row per document:
 * assistant content in session_part, user prompts in session_message, and
 * for each assistant message the files it modified plus any content early
 * 2.x releases kept inline. An assistant row's other fields (model, tokens,
 * ...) are left out so that, for example, a model name does not match every
 * session that used it.
 */
const DOCUMENTS = `
  doc AS (
    SELECT session_id, message_id || ':' || ordinal AS part_id, data, time_created
    FROM session_part
    UNION ALL
    SELECT
      session_id,
      id AS part_id,
      CASE
        WHEN type = 'user' THEN data
        WHEN json_valid(data) THEN
          NULLIF(
            COALESCE(json_extract(data, '$.content'), '') || ' ' ||
              COALESCE(json_extract(data, '$.snapshot.files'), ''),
            ' '
          )
      END AS data,
      time_created
    FROM session_message
    WHERE type IN ('user', 'assistant')
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
      `MAX(CASE WHEN d.data LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END) AS match_${i}`
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
    SELECT session_id, part_id, data
    FROM doc
    WHERE session_id IN (${placeholder}) AND data IS NOT NULL
    ORDER BY time_created ASC
  `;

  type FollowRow = { session_id: string; part_id: string; data: string };
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
      const lower = row.data.toLowerCase();
      const termLower = term.toLowerCase();
      if (lower.includes(termLower)) {
        const idx = lower.indexOf(termLower);
        const start = Math.max(0, idx - 50);
        const end = Math.min(row.data.length, idx + termLower.length + 50);
        sessionMap.set(term, {
          partID: row.part_id,
          matchType: "data",
          excerpt: row.data.slice(start, end),
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
