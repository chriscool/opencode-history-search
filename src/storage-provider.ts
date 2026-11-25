import {
  listSessionsSqlite,
  listMessagesSqlite,
  listPartsSqlite,
} from "./storage-sqlite";
import type { Session, Message, Part } from "./storage";

// Each listing opens the OpenCode database, and fails with an explanation
// when it cannot be found (see openDb()).

export async function* listSessions(
  projectID: string | null,
): AsyncGenerator<Session> {
  yield* listSessionsSqlite(projectID);
}

export async function* listMessages(
  sessionID: string,
  role?: "user" | "assistant",
): AsyncGenerator<Message> {
  yield* listMessagesSqlite(sessionID, role);
}

export async function* listParts(messageID: string): AsyncGenerator<Part> {
  yield* listPartsSqlite(messageID);
}

export type { Session, Message, Part };
