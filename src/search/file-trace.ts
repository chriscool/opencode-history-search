import type { Database } from "bun:sqlite";
import { getDbPath } from "../storage-sqlite";
import { inDateRange, type DateRange } from "./date-filter";

export interface FileTraceResult {
  sessionID: string;
  sessionTitle: string;
  timestamp: number;
  firstTouch: boolean;
  userPrompt: string | null;
  toolName: string | null;
  filePath: string;
}

export interface TraceFileOptions {
  limit?: number;
  /**
   * Keeps touches in this range; applied before the limit. firstTouch still
   * marks the file's first touch overall, so it is only set when that touch
   * falls in the range.
   */
  dateRange?: DateRange;
}

export function traceFileSqlite(
  db: Database,
  projectID: string | null,
  queryPath: string,
  options?: TraceFileOptions
): FileTraceResult[] {
  const normalizedQuery = queryPath.replace(/\\/g, "/");
  const isExactPath = normalizedQuery.includes("/");

  // Use broad SQL LIKE matching, then refine to exact/basename rules in TypeScript.
  const likePattern = `%${normalizedQuery}%`;

  const projectFilter = projectID !== null ? "AND s.project_id = ?" : "";

  // OpenCode 2 sources, newest first, tool calls before snapshots:
  //   0. `write`/`edit` tool calls in session_part. 2.x names the input `path`;
  //      sessions migrated from v1 keep `filePath`.
  //   0. the same, held inline in session_message.data.content by early 2.x.
  //   1. files an assistant step modified (`snapshot.files`, relative paths),
  //      which replace v1's patch parts and also cover the `patch` tool.
  const toolPath = (json: string) =>
    `COALESCE(json_extract(${json}, '$.state.input.path'), json_extract(${json}, '$.state.input.filePath'))`;
  // json_each() rejects malformed JSON even when WHERE would filter the row out.
  const safeData = "CASE WHEN json_valid(m.data) THEN m.data ELSE '{}' END";

  const sql = `
    SELECT
      s.id AS session_id,
      s.title AS session_title,
      s.directory AS directory,
      m.id AS message_id,
      m.time_created AS message_time,
      json_extract(p.data, '$.name') AS tool_name,
      ${toolPath("p.data")} AS matched_file_path_tool,
      NULL AS matched_files_patch,
      0 AS source_priority
    FROM session_v2 s
    JOIN session_message m ON m.session_id = s.id AND m.type = 'assistant'
    JOIN session_part p ON p.message_id = m.id
    WHERE p.type = 'tool'
      AND json_valid(p.data)
      AND json_extract(p.data, '$.name') IN ('write', 'edit')
      AND ${toolPath("p.data")} LIKE ?
      ${projectFilter}

    UNION ALL

    SELECT
      s.id, s.title, s.directory, m.id, m.time_created,
      json_extract(c.value, '$.name'),
      ${toolPath("c.value")},
      NULL,
      0
    FROM session_v2 s
    JOIN session_message m ON m.session_id = s.id AND m.type = 'assistant'
    JOIN json_each(${safeData}, '$.content') c
    WHERE json_extract(c.value, '$.type') = 'tool'
      AND json_extract(c.value, '$.name') IN ('write', 'edit')
      AND ${toolPath("c.value")} LIKE ?
      ${projectFilter}

    UNION ALL

    SELECT
      s.id, s.title, s.directory, m.id, m.time_created,
      NULL,
      NULL,
      json_extract(m.data, '$.snapshot.files'),
      1
    FROM session_v2 s
    JOIN session_message m ON m.session_id = s.id AND m.type = 'assistant'
    WHERE json_valid(m.data)
      AND json_extract(m.data, '$.snapshot.files') LIKE ?
      ${projectFilter}
    ORDER BY message_time DESC, source_priority ASC
  `;

  const binds: Array<string> = [0, 1, 2].flatMap(() =>
    projectID !== null ? [likePattern, projectID] : [likePattern],
  );

  const rows = db.query(sql).all(...binds) as Array<{
    session_id: string;
    session_title: string | null;
    directory: string;
    message_id: string;
    message_time: number;
    tool_name: string | null;
    matched_file_path_tool: string | null;
    matched_files_patch: string | null;
    source_priority: number;
  }>;

  const candidates: Array<{
    sessionID: string;
    sessionTitle: string;
    messageID: string;
    timestamp: number;
    toolName: string | null;
    filePath: string;
  }> = [];

  for (const row of rows) {
    let matchedPath: string | null = null;
    
    if (row.source_priority === 0 && row.matched_file_path_tool) {
      const toolPath = relativeTo(row.directory, row.matched_file_path_tool);
      if (isMatch(toolPath, normalizedQuery, isExactPath)) {
        matchedPath = toolPath;
      }
    } else if (row.source_priority === 1 && row.matched_files_patch) {
      try {
        const files = JSON.parse(row.matched_files_patch);
        if (Array.isArray(files)) {
          for (const f of files) {
            if (typeof f === "string" && isMatch(f, normalizedQuery, isExactPath)) {
              matchedPath = f;
              break;
            }
          }
        }
      } catch {
        continue;
      }
    }

    if (matchedPath) {
      candidates.push({
        sessionID: row.session_id,
        sessionTitle: row.session_title ?? "",
        messageID: row.message_id,
        timestamp: row.message_time,
        toolName: row.tool_name,
        filePath: matchedPath,
      });
    }
  }

  // Deduplicate by sessionID + messageID + filePath
  // Since SQL orders by message_time DESC, source_priority ASC (tool before patch)
  // we just keep the first one we see for a given key.
  const seen = new Set<string>();
  const deduped: typeof candidates = [];
  for (const c of candidates) {
    const key = `${c.sessionID}|${c.messageID}|${c.filePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(c);
    }
  }

  // Find firstTouch
  let earliestTime = Infinity;
  let earliestIndex = -1;
  for (let i = 0; i < deduped.length; i++) {
    const candidate = deduped[i];
    if (candidate && candidate.timestamp < earliestTime) {
      earliestTime = candidate.timestamp;
      earliestIndex = i;
    }
  }

  // Lookup user prompts: in OpenCode 2 the prompt text is on the user message itself.
  const findUserPrompt = db.query(`
    SELECT json_extract(data, '$.text') AS text
    FROM session_message
    WHERE session_id = ?
      AND type = 'user'
      AND time_created < ?
      AND json_valid(data)
    ORDER BY time_created DESC
    LIMIT 1
  `);

  const results: FileTraceResult[] = deduped.map((c, idx) => {
    const promptRow = findUserPrompt.get(c.sessionID, c.timestamp) as { text: string } | undefined;
    return {
      sessionID: c.sessionID,
      sessionTitle: c.sessionTitle,
      timestamp: c.timestamp,
      firstTouch: idx === earliestIndex,
      userPrompt: promptRow ? promptRow.text : null,
      toolName: c.toolName,
      filePath: c.filePath,
    };
  });

  const limit = options?.limit ?? 50;
  return results
    .filter((result) => inDateRange(result.timestamp, options?.dateRange))
    .slice(0, limit);
}

/** Strips the session directory, so absolute tool paths compare like the relative `snapshot.files`. */
function relativeTo(directory: string, filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const prefix = directory.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

function isMatch(path: string, query: string, isExact: boolean): boolean {
  if (isExact) {
    return path === query;
  }
  return path === query || path.endsWith(`/${query}`);
}

export async function traceFile(
  projectID: string | null,
  filePath: string,
  options?: TraceFileOptions
): Promise<FileTraceResult[]> {
  const { Database } = await import("bun:sqlite");
  const dbPath = getDbPath();
  const db = new Database(dbPath, { readonly: true });
  try {
    return traceFileSqlite(db, projectID, filePath, options);
  } finally {
    db.close();
  }
}
