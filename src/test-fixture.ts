import { Database } from "bun:sqlite";

/**
 * In-memory database with the OpenCode 2 session tables this plugin reads
 * (`session_v2`, `session_message`, `session_part`), mirroring their columns
 * in packages/core/src/session/sql.ts. Data shapes follow the
 * Session.Message schemas: user prompt text on the message, assistant content
 * in parts, modified files in `snapshot.files`.
 */
export function createV2Db(file = ":memory:"): Database {
  const db = new Database(file);
  db.run(`CREATE TABLE session_v2 (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, slug TEXT NOT NULL,
    directory TEXT NOT NULL, title TEXT, version TEXT NOT NULL,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE session_message (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES session_v2(id)
  )`);
  db.run(`CREATE TABLE session_part (
    message_id TEXT NOT NULL, session_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
    type TEXT NOT NULL, call_id TEXT,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (message_id, ordinal),
    FOREIGN KEY (message_id) REFERENCES session_message(id)
  )`);
  return db;
}

export function addSession(
  db: Database,
  session: { id: string; projectID: string; directory: string; title: string | null; created: number; updated?: number },
) {
  db.query(
    `INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, '2.3.0', ?, ?)`,
  ).run(
    session.id,
    session.projectID,
    session.id,
    session.directory,
    session.title,
    session.created,
    session.updated ?? session.created,
  );
}

/** Adds a user message. `files` are prompt attachments, such as `attachment()` builds. */
export function addUser(
  db: Database,
  message: { id: string; sessionID: string; time: number; text: string; files?: Array<Record<string, unknown>> },
) {
  insertMessage(db, message.id, message.sessionID, "user", message.time, JSON.stringify({
    text: message.text,
    ...(message.files ? { files: message.files } : {}),
    time: { created: message.time },
  }));
}

/** A prompt attachment stored inline, with its content as base64 (Prompt.FileAttachment). */
export const attachment = (name: string, content: string, uri?: string) => ({
  data: Buffer.from(content).toString("base64"),
  mime: "text/plain",
  source: uri ? { type: "uri", uri } : { type: "inline" },
  name,
});

/**
 * Adds an assistant message. `parts` go to session_part as current releases
 * store them; `inline` stays in the message's `data.content`, as early 2.x
 * releases stored it. A string part is written verbatim, to model a corrupt row.
 */
export function addAssistant(
  db: Database,
  message: {
    id: string;
    sessionID: string;
    time: number;
    parts?: Array<Record<string, unknown> | string>;
    inline?: Array<Record<string, unknown>>;
    files?: string[];
    data?: string;
  },
) {
  insertMessage(
    db,
    message.id,
    message.sessionID,
    "assistant",
    message.time,
    message.data ??
      JSON.stringify({
        agent: "build",
        model: { id: "claude-sonnet-5-5", providerID: "anthropic" },
        time: { created: message.time },
        ...(message.inline ? { content: message.inline } : {}),
        ...(message.files ? { snapshot: { files: message.files } } : {}),
      }),
  );
  (message.parts ?? []).forEach((part, ordinal) => {
    const type = typeof part === "string" ? "text" : String(part.type);
    db.query(
      `INSERT INTO session_part (message_id, session_id, ordinal, type, call_id, time_created, time_updated, data)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).run(
      message.id,
      message.sessionID,
      ordinal,
      type,
      message.time + ordinal + 1,
      message.time + ordinal + 1,
      typeof part === "string" ? part : JSON.stringify(part),
    );
  });
}

export const text = (value: string) => ({ type: "text", text: value });

export const tool = (name: string, input: Record<string, unknown>, output?: string) => ({
  type: "tool",
  id: `call_${name}`,
  name,
  state: {
    status: "completed",
    input,
    content: [{ type: "text", text: output ?? `${name} done` }],
  },
  time: { created: 0 },
});

const seqs = new WeakMap<Database, Map<string, number>>();

function insertMessage(db: Database, id: string, sessionID: string, type: string, time: number, data: string) {
  const bySession = seqs.get(db) ?? new Map<string, number>();
  seqs.set(db, bySession);
  const seq = (bySession.get(sessionID) ?? 0) + 1;
  bySession.set(sessionID, seq);
  db.query(
    `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sessionID, type, seq, time, time, data);
}
