import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Session, Message, Part } from "./storage";
import { listSessionsSqlite, listMessagesSqlite, listPartsSqlite, toolOutput } from "./storage-sqlite";
import { createV2Db, addSession, addUser, addAssistant, text, tool } from "./test-fixture";

async function collect<T>(items: AsyncGenerator<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}

describe("OpenCode 2 SQLite storage", () => {
  let db: Database;

  beforeAll(() => {
    db = createV2Db();
    addSession(db, { id: "ses_001", projectID: "proj1", directory: "/mock", title: "Implement storage layer", created: 1706745600000, updated: 1706745700000 });
    addSession(db, { id: "ses_002", projectID: "proj2", directory: "/other", title: null, created: 1706745600000, updated: 1706745800000 });

    addUser(db, { id: "msg_001", sessionID: "ses_001", time: 1706745600000, text: "Help me implement storage" });
    addAssistant(db, {
      id: "msg_002", sessionID: "ses_001", time: 1706745601000,
      parts: [
        { type: "reasoning", text: "thinking..." },
        text("Done, see storage.ts"),
        tool("edit", { path: "src/storage.ts" }, "Created"),
      ],
      files: ["src/storage.ts", "src/index.ts"],
    });
    addAssistant(db, {
      id: "msg_003", sessionID: "ses_001", time: 1706745602000,
      parts: [text("from session_part")],
      inline: [text("from inline content")],
    });
  });

  afterAll(() => {
    db.close();
  });

  describe("listSessionsSqlite", () => {
    test("scopes sessions to a project", async () => {
      const sessions = await collect(listSessionsSqlite("proj1", db));
      expect(sessions.map((s) => s.id)).toEqual(["ses_001"]);
      expect(sessions[0]).toEqual({
        id: "ses_001",
        projectID: "proj1",
        title: "Implement storage layer",
        directory: "/mock",
        time: { created: 1706745600000, updated: 1706745700000 },
      } satisfies Session);
    });

    test("lists all projects, newest first, when projectID is null", async () => {
      const sessions = await collect(listSessionsSqlite(null, db));
      expect(sessions.map((s) => s.id)).toEqual(["ses_002", "ses_001"]);
    });

    test("maps an untitled session to an empty title", async () => {
      const sessions = await collect(listSessionsSqlite("proj2", db));
      expect(sessions[0]?.title).toBe("");
    });

    test("returns nothing when there are no sessions", async () => {
      const empty = createV2Db();
      expect(await collect(listSessionsSqlite(null, empty))).toEqual([]);
      empty.close();
    });
  });

  describe("listMessagesSqlite", () => {
    test("lists user and assistant messages in order", async () => {
      const messages = await collect(listMessagesSqlite("ses_001", undefined, db));
      expect(messages.map((m) => [m.id, m.role, m.agent])).toEqual([
        ["msg_001", "user", "user"],
        ["msg_002", "assistant", "build"],
        ["msg_003", "assistant", "build"],
      ]);
    });

    test("filters by role", async () => {
      const messages: Message[] = await collect(listMessagesSqlite("ses_001", "user", db));
      expect(messages.map((m) => m.id)).toEqual(["msg_001"]);
    });
  });

  describe("listPartsSqlite", () => {
    test("maps a user prompt to one text part", async () => {
      const parts = await collect(listPartsSqlite("msg_001", db));
      expect(parts).toEqual([
        { id: "msg_001", messageID: "msg_001", sessionID: "ses_001", type: "text", text: "Help me implement storage" },
      ] satisfies Part[]);
    });

    test("maps assistant text, tool, and snapshot files, skipping reasoning", async () => {
      const parts = await collect(listPartsSqlite("msg_002", db));
      expect(parts.map((p) => p.type)).toEqual(["text", "tool", "patch"]);
      expect(parts[1]).toMatchObject({
        type: "tool",
        tool: "edit",
        state: { input: { path: "src/storage.ts" }, output: "Created", title: "edit" },
      });
      expect(parts[2]?.files).toEqual(["src/storage.ts", "src/index.ts"]);
    });

    test("reads session_part content before inline content", async () => {
      const parts = await collect(listPartsSqlite("msg_003", db));
      expect(parts.map((p) => p.text)).toEqual(["from session_part", "from inline content"]);
      expect(new Set(parts.map((p) => p.id)).size).toBe(2);
    });

    test("returns nothing for an unknown message", async () => {
      expect(await collect(listPartsSqlite("msg_missing", db))).toEqual([]);
    });
  });

  test("toolOutput joins the text items of a tool result", () => {
    expect(
      toolOutput([
        { type: "text", text: "first" },
        { type: "file", uri: "file:///x.png", mime: "image/png" },
        { type: "text", text: "second" },
      ]),
    ).toBe("first\nsecond");
    expect(toolOutput(undefined)).toBe("");
  });
});
