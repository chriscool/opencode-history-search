import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import type { Database } from "bun:sqlite";
import { searchMultitermSqlite, searchMultiterm } from "./multiterm-sql";
import { createV2Db, addSession, addUser, addAssistant, text, tool } from "../test-fixture";

describe("searchMultitermSqlite (in-memory SQLite, OpenCode 2 schema)", () => {
  let db: Database;

  beforeAll(() => {
    db = createV2Db();
    const main = { projectID: "proj_main", directory: "/mock/main" };

    // ses_a: text with "truck" only — should NOT match [truck, vertex, gemini]
    addSession(db, { ...main, id: "ses_a", title: "Truck overview", created: 1774100000000 });
    addAssistant(db, { id: "msg_a1", sessionID: "ses_a", time: 1774100000000, parts: [text("we trained truck model on data")] });

    // ses_b: cross-document match — user prompt, tool output, and modified file names
    addSession(db, { ...main, id: "ses_b", title: "Vertex Gemini fine-tune", created: 1774200000000 });
    addUser(db, { id: "msg_b1", sessionID: "ses_b", time: 1774200000000, text: "please use vertex ai" });
    addAssistant(db, {
      id: "msg_b2", sessionID: "ses_b", time: 1774200001000,
      parts: [tool("shell", { command: "tune" }, "gemini-2.5-flash ready")],
      files: ["src/NonTruckExamples/x.ts", "src/Other.ts"],
    });

    // ses_c: title has "Truck Vertex" but no document has "gemini"
    addSession(db, { ...main, id: "ses_c", title: "Truck Vertex plan", created: 1774300000000 });
    addUser(db, { id: "msg_c1", sessionID: "ses_c", time: 1774300000000, text: "some notes" });

    // ses_d: one part with all 3 terms
    addSession(db, { ...main, id: "ses_d", title: "Seed data", created: 1774400000000 });
    addAssistant(db, {
      id: "msg_d1", sessionID: "ses_d", time: 1774400000000,
      parts: [tool("write", { path: "seed.txt" }, "TRUCK Vertex GEMINI all in one")],
    });

    // ses_e: different project, has "truck" — used for project scoping tests
    addSession(db, { projectID: "proj_other", directory: "/mock/other", id: "ses_e", title: "Other proj truck", created: 1774500000000 });
    addUser(db, { id: "msg_e1", sessionID: "ses_e", time: 1774500000000, text: "truck reference here" });

    // ses_f: empty session — no messages
    addSession(db, { ...main, id: "ses_f", title: "Empty session", created: 1774600000000 });

    // ses_g: session with a malformed part
    addSession(db, { ...main, id: "ses_g", title: "Malformed test", created: 1774700000000 });
    addAssistant(db, {
      id: "msg_g1", sessionID: "ses_g", time: 1774700000000,
      parts: ["{not valid json truck}", text("valid truck here")],
    });

    // ses_h: assistant content stored inline by early 2.x releases
    addSession(db, { ...main, id: "ses_h", title: null, created: 1774800000000 });
    addAssistant(db, { id: "msg_h1", sessionID: "ses_h", time: 1774800000000, inline: [text("inline zeppelin notes")] });
  });

  afterAll(() => {
    db.close();
  });

  test("finds session containing all terms across multiple parts", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck", "vertex", "gemini"]);
    expect(results.map((r) => r.sessionID)).toContain("ses_b");
  });

  test("matches session where one part contains all terms", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck", "vertex", "gemini"]);
    expect(results.map((r) => r.sessionID)).toContain("ses_d");
  });

  test("excludes session missing one term", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck", "vertex", "gemini"]);
    expect(results.map((r) => r.sessionID)).not.toContain("ses_a");
  });

  test("substring matches inside camelCase filename in tool input", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["NonTruck"]);
    expect(results.map((r) => r.sessionID)).toContain("ses_b");
  });

  test("case-insensitive: 'TRUCK' finds 'truck' and 'Truck'", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["TRUCK"]);
    const ids = results.map((r) => r.sessionID);
    expect(ids).toContain("ses_a");
    expect(ids).toContain("ses_b");
    expect(ids).toContain("ses_d");
  });

  test("a term in session.title counts toward match", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck", "vertex"]);
    expect(results.map((r) => r.sessionID)).toContain("ses_c");
  });

  test("session with no messages is safely excluded", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck", "vertex", "gemini"]);
    expect(results.map((r) => r.sessionID)).not.toContain("ses_f");
  });

  test("malformed JSON in part.data is skipped without error", () => {
    expect(() =>
      searchMultitermSqlite(db, "proj_main", ["truck"]),
    ).not.toThrow();
    const results = searchMultitermSqlite(db, "proj_main", ["truck"]);
    expect(results).toBeDefined();
  });

  test("only returns sessions in specified project", () => {
    const main = searchMultitermSqlite(db, "proj_main", ["truck"]);
    const other = searchMultitermSqlite(db, "proj_other", ["truck"]);

    expect(main.every((r) => r.projectDirectory === "/mock/main")).toBe(true);
    expect(other.every((r) => r.projectDirectory === "/mock/other")).toBe(true);
    expect(other.map((r) => r.sessionID)).toContain("ses_e");
  });

  test("projectID = null searches across all projects", () => {
    const results = searchMultitermSqlite(db, null, ["truck"]);
    const ids = results.map((r) => r.sessionID);
    expect(ids).toContain("ses_a");
    expect(ids).toContain("ses_e");
  });

  test("results sorted by session time_updated descending", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck"]);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i]!.timestamp).toBeGreaterThanOrEqual(
        results[i + 1]!.timestamp,
      );
    }
  });

  test("respects limit parameter", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck"], {
      limit: 2,
    });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("each result includes termHits showing which parts matched which terms", () => {
    const results = searchMultitermSqlite(db, "proj_main", [
      "truck",
      "vertex",
      "gemini",
    ]);
    const sesB = results.find((r) => r.sessionID === "ses_b");
    expect(sesB).toBeDefined();
    expect(sesB!.termHits).toBeDefined();
    expect(sesB!.termHits.size).toBe(3);
    expect(sesB!.termHits.has("truck")).toBe(true);
    expect(sesB!.termHits.has("vertex")).toBe(true);
    expect(sesB!.termHits.has("gemini")).toBe(true);
  });

  test("excerpt is the matching text fragment", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["vertex"]);
    const sesB = results.find((r) => r.sessionID === "ses_b");
    expect(sesB).toBeDefined();
    const vertexHit = sesB!.termHits.get("vertex");
    expect(vertexHit).toBeDefined();
    expect(vertexHit!.excerpt.length).toBeGreaterThan(0);
    expect(vertexHit!.excerpt.toLowerCase()).toContain("vertex");
  });

  test("each result has required fields", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck"]);
    const r = results[0]!;
    expect(r).toHaveProperty("sessionID");
    expect(r).toHaveProperty("sessionTitle");
    expect(r).toHaveProperty("timestamp");
    expect(r).toHaveProperty("projectDirectory");
    expect(r).toHaveProperty("termHits");
  });

  test("finds assistant content stored inline by early 2.x releases", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["zeppelin", "inline"]);
    expect(results.map((r) => r.sessionID)).toEqual(["ses_h"]);
    expect(results[0]!.sessionTitle).toBe("");
  });

  test("does not match an assistant message's model name", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["claude-sonnet"]);
    expect(results).toHaveLength(0);
  });

  test("async wrapper searchMultiterm is exported", () => {
    expect(typeof searchMultiterm).toBe("function");
  });
});
