import { test, expect, describe } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import plugin, { PLUGIN_ID, TOOL_NAME, input, runSearch } from "./index";

describe("history-search plugin", () => {
  test("default export is an OpenCode 2 plugin definition", () => {
    expect(plugin.id).toBe(PLUGIN_ID);
    expect(typeof plugin.setup).toBe("function");
  });

  test("setup registers the history-search tool", async () => {
    const added: Array<{ name: string; input: unknown }> = [];
    const ctx = {
      location: { project: { id: "proj_main" } },
      tool: {
        transform: async (callback: (editor: { add: (tool: any) => void }) => void) => {
          callback({ add: (tool) => added.push(tool) });
          return { dispose: async () => {} };
        },
      },
    };
    await plugin.setup!(ctx as any);
    expect(added.map((tool) => tool.name)).toEqual([TOOL_NAME]);
    expect(added[0]?.input).toBe(input);
  });

  test("tool schema includes terms parameter for multi-term search", () => {
    expect(input.properties).toHaveProperty("terms");
  });

  test("rejects a search without query, terms, or filePath", async () => {
    await expect(runSearch({}, "proj_main")).rejects.toThrow("Either 'query', 'terms', or 'filePath'");
  });

  test("declares limit as a positive integer, so OpenCode rejects other values", () => {
    expect(input.properties.limit).toMatchObject({ type: "integer", minimum: 1 });
  });

  test("rejects a limit that is not a positive integer", async () => {
    for (const limit of [2.5, -1, 0]) {
      await expect(runSearch({ query: "storage", limit }, "proj_main")).rejects.toThrow(
        "'limit' must be a positive integer",
      );
    }
  });

  test("rejects an empty terms array", async () => {
    await expect(runSearch({ terms: [] }, "proj_main")).rejects.toThrow("non-empty array");
  });

  test("every mode explains a missing database instead of finding nothing", async () => {
    const saved = { XDG_DATA_HOME: process.env.XDG_DATA_HOME, OPENCODE_DB: process.env.OPENCODE_DB };
    const dataHome = mkdtempSync(path.join(os.tmpdir(), "history-search-"));
    process.env.XDG_DATA_HOME = dataHome;
    delete process.env.OPENCODE_DB;
    try {
      for (const args of [
        { query: "storage" },
        { query: "storage", mode: "fuzzy" as const },
        { terms: ["storage", "layer"] },
        { filePath: "src/storage.ts" },
      ]) {
        await expect(runSearch(args, "proj_main")).rejects.toThrow("OpenCode database not found");
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dataHome, { recursive: true, force: true });
    }
  });
});
