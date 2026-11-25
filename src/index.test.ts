import { test, expect, describe } from "bun:test";
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

  test("rejects an empty terms array", async () => {
    await expect(runSearch({ terms: [] }, "proj_main")).rejects.toThrow("non-empty array");
  });
});
