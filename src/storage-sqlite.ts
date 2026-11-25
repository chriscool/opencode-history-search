import { Database } from "bun:sqlite";
import path from "path";
import os from "os";
import type { Session, Message, Part } from "./storage";

/**
 * Read-only access to the OpenCode 2.x session store.
 *
 * OpenCode 2 keeps sessions in `session_v2`, messages in `session_message`
 * (one row per message, `type` column instead of `data.role`), and assistant
 * content in `session_part`. The v1 `session`/`message`/`part` tables are only
 * a frozen copy that OpenCode 2 migrated from, so they are never read here.
 *
 * This is OpenCode's internal schema, not a public API: if a future release
 * changes it, these queries are the place to update.
 */

export function getDbPath(): string {
  const xdgData =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(xdgData, "opencode", "opencode.db");
}

export function dbExists(): boolean {
  try {
    return Bun.file(getDbPath()).size > 0;
  } catch {
    return false;
  }
}

function openDb(): Database {
  return new Database(getDbPath(), { readonly: true });
}

/** Message types that carry conversation content; the rest are control markers. */
export const SEARCHABLE_MESSAGE_TYPES = ["user", "assistant"] as const;

export async function* listSessionsSqlite(
  projectID: string | null,
  db?: Database,
): AsyncGenerator<Session> {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    const projectFilter = projectID !== null ? "WHERE project_id = ?" : "";
    const rows = _db
      .query(
        `SELECT id, project_id, title, directory, time_created, time_updated
         FROM session_v2 ${projectFilter}
         ORDER BY time_updated DESC`,
      )
      .all(...(projectID !== null ? [projectID] : [])) as Array<{
      id: string;
      project_id: string;
      title: string | null;
      directory: string;
      time_created: number;
      time_updated: number;
    }>;

    for (const row of rows) {
      yield {
        id: row.id,
        projectID: row.project_id,
        title: row.title ?? "",
        directory: row.directory,
        time: { created: row.time_created, updated: row.time_updated },
      };
    }
  } finally {
    if (shouldClose) _db.close();
  }
}

export async function* listMessagesSqlite(
  sessionID: string,
  role?: "user" | "assistant",
  db?: Database,
): AsyncGenerator<Message> {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    const types = role ? [role] : [...SEARCHABLE_MESSAGE_TYPES];
    const rows = _db
      .query(
        `SELECT id, session_id, type, time_created, data
         FROM session_message
         WHERE session_id = ? AND type IN (${types.map(() => "?").join(",")})
         ORDER BY seq ASC`,
      )
      .all(sessionID, ...types) as Array<{
      id: string;
      session_id: string;
      type: "user" | "assistant";
      time_created: number;
      data: string;
    }>;

    for (const row of rows) {
      yield {
        id: row.id,
        sessionID: row.session_id,
        role: row.type,
        agent: row.type === "assistant" ? (parseJson(row.data)?.agent ?? "") : "user",
        time: { created: row.time_created },
      };
    }
  } finally {
    if (shouldClose) _db.close();
  }
}

/**
 * Yields the searchable parts of one message, mapped to the plugin's Part shape:
 *
 * - a user message's prompt text becomes one `text` part;
 * - assistant `text` and `tool` content becomes `text` and `tool` parts
 *   (`reasoning` is skipped, as it was in v1);
 * - the files an assistant step modified (`snapshot.files`) become one
 *   `patch` part, replacing v1's patch parts.
 *
 * Assistant content lives in `session_part`; rows written by early 2.x
 * releases may still hold it inline in `data.content`, so both are read,
 * in the same order OpenCode itself uses.
 */
export async function* listPartsSqlite(
  messageID: string,
  db?: Database,
): AsyncGenerator<Part> {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    const message = _db
      .query(`SELECT session_id, type, data FROM session_message WHERE id = ?`)
      .get(messageID) as
      | { session_id: string; type: string; data: string }
      | null;
    if (!message) return;
    const data = parseJson(message.data);
    if (!data) return;
    const base = { messageID, sessionID: message.session_id };

    if (message.type === "user") {
      if (typeof data.text === "string" && data.text) {
        yield { ...base, id: messageID, type: "text", text: data.text };
      }
      return;
    }
    if (message.type !== "assistant") return;

    const rows = _db
      .query(
        `SELECT ordinal, data FROM session_part
         WHERE message_id = ? ORDER BY ordinal ASC`,
      )
      .all(messageID) as Array<{ ordinal: number; data: string }>;
    const stored = rows.flatMap((row) => {
      const content = parseJson(row.data);
      return content ? [{ id: `${messageID}:${row.ordinal}`, content }] : [];
    });
    const inline = Array.isArray(data.content)
      ? data.content.map((content: any, index: number) => ({
          id: `${messageID}:inline:${index}`,
          content,
        }))
      : [];

    for (const entry of [...stored, ...inline]) {
      const part = toPart(entry.content);
      if (part) yield { ...base, ...part, id: entry.id };
    }

    const files = data.snapshot?.files;
    if (Array.isArray(files) && files.length > 0) {
      yield { ...base, id: `${messageID}:snapshot`, type: "patch", files };
    }
  } finally {
    if (shouldClose) _db.close();
  }
}

function toPart(content: any): Omit<Part, "id" | "messageID" | "sessionID"> | undefined {
  if (content?.type === "text" && typeof content.text === "string") {
    return { type: "text", text: content.text };
  }
  if (content?.type === "tool" && typeof content.name === "string") {
    return {
      type: "tool",
      tool: content.name,
      state: {
        input: content.state?.input,
        output: toolOutput(content.state?.content),
        title: content.name,
      },
    };
  }
  return undefined;
}

/** A v2 tool result is a list of content items; only the text ones are searchable. */
export function toolOutput(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((item) => (item?.type === "text" && typeof item.text === "string" ? [item.text] : []))
    .join("\n");
}

function parseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
