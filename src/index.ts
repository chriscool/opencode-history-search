// Type-only: Plugin.define() just returns its argument, so the built file
// has no runtime dependency and also works copied on its own into a
// plugins/ directory, where @opencode/plugin cannot be resolved.
import type { Plugin } from "@opencode/plugin";
import { searchKeyword } from "./search/keyword";
import { searchFuzzy } from "./search/fuzzy";
import { parseDateFilter, filterByDate } from "./search/date-filter";
import { traceFile } from "./search/file-trace";
import { searchMultiterm } from "./search/multiterm-sql";
import { formatResults, formatTraceResults, formatMultitermResults } from "./format";

export const PLUGIN_ID = "opencode-history-search";
export const TOOL_NAME = "history-search";

export const description = `Search through past conversation histories. Use searchAllProjects=true to search ALL projects on this machine. Searches session titles, message content, tool invocations, and file paths.

THREE SEARCH MODES:
1. SINGLE-TERM (query): Pass query for one search term. Returns per-part matches. Use mode: "fuzzy" for typos, regex: true for patterns.
2. MULTI-TERM AND (terms): Pass terms: ["term1", "term2", ...] to find sessions containing ALL terms anywhere in the session (across title, messages, tools, file paths). Returns one result per session with per-term excerpts. Use when the user remembers multiple concepts (e.g., "find sessions about truck, vertex, and gemini"). Requires 2+ terms.
3. FILE TRACE (filePath): Pass filePath to find which sessions created or modified a specific file.

Supports keyword search, regex patterns, fuzzy search, multi-term AND search, date filtering, and role filtering.`;

export const input = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        "Search query (keyword, regex pattern, or fuzzy search term). Required unless filePath or terms is provided.",
    },
    terms: {
      type: "array",
      items: { type: "string" },
      description:
        'Array of terms for multi-term AND search. Returns sessions containing ALL terms anywhere in the session (title, messages, tools, file paths). Use when the user wants sessions matching multiple concepts (e.g., ["truck", "vertex", "gemini"]). Requires 2+ terms for multi-term path; 1 term falls back to single-term query. Case-insensitive substring matching.',
    },
    filePath: {
      type: "string",
      description:
        "File path to trace touch history (e.g., 'src/auth.ts'). If provided, query, mode, regex, caseSensitive, fuzzyThreshold, and role are ignored.",
    },
    searchAllProjects: {
      type: "boolean",
      description:
        "Set to true to search ALL projects on this machine across all repositories, not just the current one. Default: false (current repo only). Use when user asks to search globally, across all projects, machine-wide, or everywhere.",
    },
    mode: {
      type: "string",
      enum: ["keyword", "fuzzy"],
      description:
        "Search mode: 'keyword' for exact matches, 'fuzzy' for typo-tolerant matching (default: keyword)",
    },
    regex: {
      type: "boolean",
      description: "Treat query as regex pattern (keyword mode only, default: false)",
    },
    caseSensitive: {
      type: "boolean",
      description: "Case-sensitive search (keyword mode only, default: false)",
    },
    fuzzyThreshold: {
      type: "number",
      description:
        "Fuzzy match threshold 0.0-1.0 (fuzzy mode only, default: 0.4, lower = stricter)",
    },
    date: {
      type: "string",
      description:
        "Filter by date: 'today', 'yesterday', 'last N days/weeks/months', 'YYYY-MM-DD', 'YYYY-MM', 'YYYY-MM-DD to YYYY-MM-DD'",
    },
    limit: {
      type: "number",
      description: "Maximum number of results (default: 50)",
    },
    role: {
      type: "string",
      enum: ["user", "assistant"],
      description:
        "Filter by message role: 'user' for your messages only, 'assistant' for AI responses only. Ignored if filePath is provided.",
    },
  },
  additionalProperties: false,
} as const;

export interface HistorySearchArgs {
  query?: string;
  terms?: string[];
  filePath?: string;
  searchAllProjects?: boolean;
  mode?: "keyword" | "fuzzy";
  regex?: boolean;
  caseSensitive?: boolean;
  fuzzyThreshold?: number;
  date?: string;
  limit?: number;
  role?: "user" | "assistant";
}

/**
 * Runs one search. `currentProjectID` scopes it unless `searchAllProjects` is set;
 * it is the OpenCode project of the location the plugin loaded in, the same ID
 * OpenCode stores on each session.
 */
export async function runSearch(
  args: HistorySearchArgs,
  currentProjectID: string,
): Promise<string> {
  if (!args.query && !args.filePath && !args.terms) {
    throw new Error("Either 'query', 'terms', or 'filePath' must be provided.");
  }

  const projectID = args.searchAllProjects ? null : currentProjectID;
  const dateRange = args.date ? parseDateFilter(args.date) : undefined;
  let query = args.query;

  if (args.terms !== undefined) {
    if (!Array.isArray(args.terms) || args.terms.length === 0) {
      throw new Error("'terms' must be a non-empty array of strings.");
    }
    if (args.terms.length > 1) {
      const matches = await searchMultiterm(projectID, args.terms, { limit: args.limit });
      return formatMultitermResults(dateRange ? filterByDate(matches, dateRange) : matches);
    }
    query = args.terms[0];
  }

  if (args.filePath) {
    const matches = await traceFile(projectID, args.filePath, { limit: args.limit });
    return formatTraceResults(dateRange ? filterByDate(matches, dateRange) : matches);
  }

  if (!query) {
    throw new Error("'query' is required when 'filePath' is not provided.");
  }

  const matches =
    args.mode === "fuzzy"
      ? await searchFuzzy(projectID, query, {
          threshold: args.fuzzyThreshold,
          limit: args.limit,
          role: args.role,
        })
      : await searchKeyword(projectID, query, {
          regex: args.regex,
          caseSensitive: args.caseSensitive,
          limit: args.limit,
          role: args.role,
        });

  return formatResults(dateRange ? filterByDate(matches, dateRange) : matches);
}

const plugin: Plugin.Plugin = {
  id: PLUGIN_ID,
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: TOOL_NAME,
        description,
        input,
        execute: async (args) => ({
          content: await runSearch(args as HistorySearchArgs, ctx.location.project.id),
        }),
      });
    });
  },
};

export default plugin;
