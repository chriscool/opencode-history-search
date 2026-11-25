import { describe, test, expect } from "bun:test";
import { runSearch } from "../src/index";

// These run against the real OpenCode database. Searches that are not global
// are scoped to this project ID; set HISTORY_SEARCH_PROJECT_ID to one of yours.
const projectID = process.env.HISTORY_SEARCH_PROJECT_ID ?? "global";

describe("Global Search Integration Tests", () => {
  test("global search returns results", async () => {
    const result = await runSearch({
      query: "storage",
      searchAllProjects: true,
      limit: 5,
    }, projectID);
    expect(result).toContain("conversation history");
  });

  test("global search with date filter works", async () => {
    const result = await runSearch({
      query: "storage",
      searchAllProjects: true,
      date: "today",
      limit: 5,
    }, projectID);
    expect(result).toContain("conversation history");
  });

  test("global file trace works", async () => {
    const result = await runSearch({
      filePath: "src/storage.ts",
      searchAllProjects: true,
      limit: 5,
    }, projectID);
    expect(result).toContain("conversation history");
  });

  test("scoped search still works (backward compatibility)", async () => {
    const result = await runSearch({ query: "storage", limit: 5 }, projectID);
    expect(result).toContain("conversation history");
  });
});
