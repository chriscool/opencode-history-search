import {
  dbExists,
  listSessionsSqlite,
  listMessagesSqlite,
  listPartsSqlite,
} from "./storage-sqlite";
import type { Session, Message, Part } from "./storage";

// OpenCode 2 always stores sessions in SQLite. Without a database there is
// no history to search, so every listing is empty.

export async function* listSessions(
  projectID: string | null,
): AsyncGenerator<Session> {
  if (dbExists()) yield* listSessionsSqlite(projectID);
}

export async function* listMessages(
  sessionID: string,
  role?: "user" | "assistant",
): AsyncGenerator<Message> {
  if (dbExists()) yield* listMessagesSqlite(sessionID, role);
}

export async function* listParts(messageID: string): AsyncGenerator<Part> {
  if (dbExists()) yield* listPartsSqlite(messageID);
}

export type { Session, Message, Part };
