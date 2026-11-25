import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import type { Database } from "bun:sqlite";
import { traceFileSqlite } from "./file-trace";
import { createV2Db, addSession, addUser, addAssistant, text, tool } from "../test-fixture";

describe("file-trace search", () => {
  let db: Database;

  beforeAll(() => {
    db = createV2Db();
    const main = { projectID: "proj_main", directory: "/mock/main" };

    // ses_a: `write` with the 2.x `path` input, plus the step's snapshot files.
    addSession(db, { ...main, id: "ses_a", title: "build auth module", created: 1774346400000, updated: 1774346401200 });
    addUser(db, { id: "msg_a1", sessionID: "ses_a", time: 1774346400000, text: "build me an auth module" });
    addAssistant(db, {
      id: "msg_a2", sessionID: "ses_a", time: 1774346401000,
      parts: [tool("write", { path: "src/auth.ts" }, "Wrote src/auth.ts")],
      files: ["src/auth.ts"],
    });

    // ses_b: `edit` with v1's `filePath` input, as in sessions migrated from v1.
    addSession(db, { ...main, id: "ses_b", title: "add rate limiting", created: 1774951200000, updated: 1774951201200 });
    addUser(db, { id: "msg_b1", sessionID: "ses_b", time: 1774951200000, text: "add rate limiting to auth" });
    addAssistant(db, {
      id: "msg_b2", sessionID: "ses_b", time: 1774951201000,
      parts: [tool("edit", { filePath: "src/auth.ts" }, "Updated src/auth.ts")],
      files: ["src/auth.ts", "src/rate-limit.ts"],
    });

    // ses_c: only read-only references to files.
    addSession(db, { ...main, id: "ses_c", title: "review auth code", created: 1774954800000, updated: 1774954801200 });
    addUser(db, { id: "msg_c1", sessionID: "ses_c", time: 1774954800000, text: "find all usages of auth" });
    addAssistant(db, {
      id: "msg_c2", sessionID: "ses_c", time: 1774954801000,
      parts: [
        tool("grep", { pattern: "auth" }, "src/grep-only.ts; src/auth.ts"),
        text("I found references to src/text-only.ts and src/auth.ts in the codebase."),
      ],
    });

    // ses_d: two user prompts, then an edit with an absolute path.
    addSession(db, { ...main, id: "ses_d", title: "fix login bug", created: 1775296800000, updated: 1775296801200 });
    addUser(db, { id: "msg_d1", sessionID: "ses_d", time: 1775296800000, text: "fix the login bug" });
    addUser(db, { id: "msg_d2", sessionID: "ses_d", time: 1775296800500, text: "specifically in auth.ts" });
    addAssistant(db, {
      id: "msg_d3", sessionID: "ses_d", time: 1775296801000,
      parts: [tool("edit", { path: "/mock/main/src/auth.ts" }, "Fixed login bug")],
      files: ["src/auth.ts"],
    });

    // ses_f: no user prompt at all.
    addSession(db, { ...main, id: "ses_f", title: "bootstrap config", created: 1775124000000, updated: 1775124000200 });
    addAssistant(db, {
      id: "msg_f1", sessionID: "ses_f", time: 1775124000000,
      parts: [tool("write", { path: "src/config.ts" }, "Wrote src/config.ts")],
      files: ["src/config.ts"],
    });

    // ses_e: another project.
    addSession(db, { projectID: "proj_other", directory: "/mock/other", id: "ses_e", title: "other project auth change", created: 1775383200000, updated: 1775383201200 });
    addUser(db, { id: "msg_e1", sessionID: "ses_e", time: 1775383200000, text: "touch auth in other project" });
    addAssistant(db, {
      id: "msg_e2", sessionID: "ses_e", time: 1775383201000,
      parts: [tool("write", { path: "src/auth.ts" }, "Wrote src/auth.ts")],
      files: ["src/auth.ts"],
    });

    // ses_g: an assistant row whose data is not valid JSON.
    addSession(db, { ...main, id: "ses_g", title: "malformed patch", created: 1775386800000, updated: 1775386801200 });
    addAssistant(db, { id: "msg_g1", sessionID: "ses_g", time: 1775386800000, data: '{"snapshot":{"files":oops}}' });

    // ses_i: inline content holding non-objects, which must not break the query.
    addSession(db, { ...main, id: "ses_i", title: "odd inline content", created: 1775392000000, updated: 1775392001000 });
    addAssistant(db, {
      id: "msg_i1", sessionID: "ses_i", time: 1775392000000,
      data: JSON.stringify({ content: ["oops", 42, tool("write", { path: "src/odd.ts" }, "Wrote src/odd.ts")] }),
    });
    addAssistant(db, { id: "msg_i2", sessionID: "ses_i", time: 1775392001000, data: JSON.stringify({ content: "oops" }) });

    // ses_h: assistant content stored inline by early 2.x releases.
    addSession(db, { ...main, id: "ses_h", title: "legacy inline content", created: 1775390000000, updated: 1775390001000 });
    addUser(db, { id: "msg_h1", sessionID: "ses_h", time: 1775390000000, text: "write the legacy module" });
    addAssistant(db, {
      id: "msg_h2", sessionID: "ses_h", time: 1775390001000,
      inline: [tool("write", { path: "src/legacy.ts" }, "Wrote src/legacy.ts")],
    });
  });

  afterAll(() => {
    db.close();
  });

  describe("Group 1: Core lookup", () => {
    test("finds file touches from the assistant snapshot files", () => {
      const results = traceFileSqlite(db, "proj_main", "src/rate-limit.ts");
      expect(results).toHaveLength(1);
      expect(results[0]?.sessionID).toBe("ses_b");
      expect(results[0]?.filePath).toBe("src/rate-limit.ts");
    });

    test("finds file touches from write tool input.path", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const sesA = results.find((r) => r.sessionID === "ses_a");
      expect(sesA).toBeDefined();
      expect(sesA?.toolName).toBe("write");
    });

    test("finds file touches from edit tool input.path and migrated input.filePath", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const sesB = results.find((r) => r.sessionID === "ses_b");
      const sesD = results.find((r) => r.sessionID === "ses_d");
      expect(sesB?.toolName).toBe("edit");
      expect(sesD?.toolName).toBe("edit");
    });

    test("does not match grep tool references", () => {
      const results = traceFileSqlite(db, "proj_main", "src/grep-only.ts");
      expect(results).toHaveLength(0);
    });

    test("does not match plain text mentions", () => {
      const results = traceFileSqlite(db, "proj_main", "src/text-only.ts");
      expect(results).toHaveLength(0);
    });

    test("returns empty array for unknown file", () => {
      const results = traceFileSqlite(db, "proj_main", "src/unknown.ts");
      expect(results).toHaveLength(0);
    });

    test("deduplicates tool and patch matches within the same assistant message", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.sessionID)).toEqual(["ses_d", "ses_b", "ses_a"]);
    });
  });

  describe("Group 2: firstTouch logic", () => {
    test("marks the earliest touch as firstTouch and later touches as false", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const sesA = results.find((r) => r.sessionID === "ses_a");
      const sesB = results.find((r) => r.sessionID === "ses_b");
      const sesD = results.find((r) => r.sessionID === "ses_d");
      
      expect(sesA?.firstTouch).toBe(true);
      expect(sesB?.firstTouch).toBe(false);
      expect(sesD?.firstTouch).toBe(false);
    });

    test("marks a single touch as firstTouch", () => {
      const results = traceFileSqlite(db, "proj_main", "src/rate-limit.ts");
      expect(results).toHaveLength(1);
      expect(results[0]?.firstTouch).toBe(true);
    });

    test("computes firstTouch from chronology not output order", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      expect(results[0]?.sessionID).toBe("ses_d");
      expect(results[0]?.firstTouch).toBe(false);
      
      expect(results[results.length - 1]?.sessionID).toBe("ses_a");
      expect(results[results.length - 1]?.firstTouch).toBe(true);
    });
  });

  describe("Group 3: user prompt retrieval", () => {
    test("returns the preceding user message text", () => {
      const results = traceFileSqlite(db, "proj_main", "src/rate-limit.ts");
      expect(results[0]?.userPrompt).toBe("add rate limiting to auth");
    });

    test("returns the immediately preceding user message when multiple user messages exist", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const sesD = results.find((r) => r.sessionID === "ses_d");
      expect(sesD?.userPrompt).toBe("specifically in auth.ts");
    });

    test("returns null when no preceding user message exists", () => {
      const results = traceFileSqlite(db, "proj_main", "src/config.ts");
      expect(results[0]?.userPrompt).toBe(null);
    });
  });

  describe("Group 4: result shape and ordering", () => {
    test("returns results sorted newest first", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      expect(results.map((r) => r.timestamp)).toEqual([1775296801000, 1774951201000, 1774346401000]);
      expect(results.map((r) => r.sessionID)).toEqual(["ses_d", "ses_b", "ses_a"]);
    });

    test("includes toolName", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      expect(results.map((r) => r.toolName)).toEqual(["edit", "edit", "write"]);
    });

    test("includes the matched filePath", () => {
      const results = traceFileSqlite(db, "proj_main", "auth.ts");
      for (const result of results) {
        expect(result.filePath).toBe("src/auth.ts");
      }
    });

    test("applies the date range before the limit", () => {
      // ses_d is the newest touch of src/auth.ts; only the oldest, ses_a, is in range.
      const dateRange = { start: new Date(1774346400000), end: new Date(1774346409999) };
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts", { limit: 1, dateRange });
      expect(results.map((r) => r.sessionID)).toEqual(["ses_a"]);
      expect(results[0]?.firstTouch).toBe(true);
    });

    test("keeps firstTouch for the first touch overall when it is outside the date range", () => {
      const dateRange = { start: new Date(1774951200000), end: new Date(1774951209999) };
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts", { dateRange });
      expect(results.map((r) => r.sessionID)).toEqual(["ses_b"]);
      expect(results[0]?.firstTouch).toBe(false);
    });

    test("looks up user prompts only for the results it returns", () => {
      // Counts executions of the prompt lookup, the only query on user messages.
      let lookups = 0;
      const counting = {
        query: (sql: string) => {
          const statement = db.query(sql);
          if (!sql.includes("type = 'user'")) return statement;
          return { get: (...args: unknown[]) => (lookups++, statement.get(...(args as []))) };
        },
      } as unknown as Database;

      const results = traceFileSqlite(counting, "proj_main", "src/auth.ts", { limit: 1 });
      expect(results.map((r) => r.userPrompt)).toEqual(["specifically in auth.ts"]);
      expect(lookups).toBe(1);

      lookups = 0;
      const dateRange = { start: new Date(1774346400000), end: new Date(1774346409999) };
      expect(traceFileSqlite(counting, "proj_main", "src/auth.ts", { dateRange })).toHaveLength(1);
      expect(lookups).toBe(1);
    });

    test("respects the limit parameter", () => {
      const results = traceFileSqlite(db, "proj_main", "auth.ts", { limit: 2 });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.sessionID)).toEqual(["ses_d", "ses_b"]);
    });
  });

  describe("Group 5: project scoping", () => {
    test("only returns touches from the specified project", () => {
      const mainResults = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const otherResults = traceFileSqlite(db, "proj_other", "src/auth.ts");
      
      expect(mainResults.map((r) => r.sessionID)).toEqual(["ses_d", "ses_b", "ses_a"]);
      expect(otherResults.map((r) => r.sessionID)).toEqual(["ses_e"]);
    });
  });

  describe("Group 6: path matching", () => {
    test("matches exact file paths", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      expect(results).toHaveLength(3);
    });

    test("matches basename queries against full stored paths", () => {
      const exactResults = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const basenameResults = traceFileSqlite(db, "proj_main", "auth.ts");
      
      expect(basenameResults).toEqual(exactResults);
    });

    test("normalizes backslash paths before exact matching", () => {
      const forwardSlashResults = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const backslashResults = traceFileSqlite(db, "proj_main", "src\\auth.ts");

      expect(backslashResults).toEqual(forwardSlashResults);
    });

    test("skips malformed message rows without crashing", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      expect(results.map((r) => r.sessionID)).toEqual(["ses_d", "ses_b", "ses_a"]);
    });

    test("reports absolute tool paths relative to the session directory", () => {
      const sesD = traceFileSqlite(db, "proj_main", "src/auth.ts").find((r) => r.sessionID === "ses_d");
      expect(sesD?.filePath).toBe("src/auth.ts");
    });

    test("skips inline content that is not an object without failing the query", () => {
      const results = traceFileSqlite(db, "proj_main", "src/odd.ts");
      expect(results.map((r) => [r.sessionID, r.toolName])).toEqual([["ses_i", "write"]]);
      expect(traceFileSqlite(db, "proj_main", "src/auth.ts").map((r) => r.sessionID)).toEqual(["ses_d", "ses_b", "ses_a"]);
    });

    test("finds tool calls stored inline in the message by early 2.x releases", () => {
      const results = traceFileSqlite(db, "proj_main", "src/legacy.ts");
      expect(results).toHaveLength(1);
      expect(results[0]?.sessionID).toBe("ses_h");
      expect(results[0]?.toolName).toBe("write");
      expect(results[0]?.userPrompt).toBe("write the legacy module");
    });
  });

  describe("Group 7: global scoping (projectID = null)", () => {
    test("traces across all projects", () => {
      const results = traceFileSqlite(db, null, "src/auth.ts");
      const ids = results.map((r) => r.sessionID);
      expect(ids).toContain("ses_e");
      expect(ids).toContain("ses_d");
      expect(ids).toContain("ses_b");
      expect(ids).toContain("ses_a");
    });

    test("respects limit", () => {
      const results = traceFileSqlite(db, null, "src/auth.ts", { limit: 2 });
      expect(results).toHaveLength(2);
    });

    test("returns empty for unknown file", () => {
      const results = traceFileSqlite(db, null, "src/unknown.ts");
      expect(results).toHaveLength(0);
    });

    test("deduplicates correctly across projects", () => {
      const results = traceFileSqlite(db, null, "src/auth.ts");
      const keys = results.map((r) => `${r.sessionID}|${r.filePath}`);
      const uniqueKeys = new Set(keys);
      expect(keys.length).toBe(uniqueKeys.size);
    });

    test("firstTouch is chronologically earliest across all projects", () => {
      const results = traceFileSqlite(db, null, "src/auth.ts");
      const firstTouch = results.find((r) => r.firstTouch);
      expect(firstTouch).toBeDefined();
      expect(firstTouch?.sessionID).toBe("ses_a");
    });

    test("user prompts resolve correctly for each project", () => {
      const results = traceFileSqlite(db, null, "src/auth.ts");
      const sesE = results.find((r) => r.sessionID === "ses_e");
      expect(sesE?.userPrompt).toBe("touch auth in other project");
    });
  });
});
