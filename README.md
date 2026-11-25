# opencode-history-search

[![npm version](https://img.shields.io/npm/v/opencode-history-search.svg)](https://www.npmjs.com/package/opencode-history-search)
[![npm downloads](https://img.shields.io/npm/dm/opencode-history-search.svg)](https://www.npmjs.com/package/opencode-history-search)
[![Tests](https://github.com/joeyism/opencode-history-search/workflows/Tests/badge.svg)](https://github.com/joeyism/opencode-history-search/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Search through your OpenCode conversation history across ALL projects or within the current repository. Supports keyword, regex, fuzzy, and global search.

<video src="https://github.com/user-attachments/assets/f492da67-3f54-4989-abb3-2d40c3a8fe7c" autoplay loop muted playsinline width="100%"></video>

## Features

- **Keyword Search** - Find exact matches in your conversation history
- **Regex Search** - Use regular expressions for advanced pattern matching
- **Fuzzy Search** - Typo-tolerant search that finds matches even with spelling errors
- **Multi-Term AND Search** - Find sessions matching multiple concepts at once (e.g., `["truck", "vertex", "gemini"]`)
- **Date Filtering** - Filter by "today", "last 7 days", "2024-01", date ranges, and more
- **Role Filtering** - Search only your messages (`user`) or only AI responses (`assistant`)
- **File Modification Tracking** - Find which sessions modified specific files
- **Multiple Match Types** - Search across session titles, messages, tool invocations, and file paths
- **Global Search** - Search across ALL projects on your machine with `searchAllProjects: true`
- **Project-Aware Results** - See which project directory each result came from
- **Fast** - Single-term queries ~500ms; multi-term session-level AND ~1s (on 100k+ parts)
- **OpenCode 2** - Reads the OpenCode 2 session store, including history migrated from OpenCode v1 (see [Sessions from OpenCode v1](#sessions-from-opencode-v1))

## Installation

Requires OpenCode 2. Pick one of the methods below: using more than one
registers the tool twice. OpenCode reloads plugins when their config or files
change, so there is no need to restart it.

### OpenCode Config (Recommended)

Add the package to your global OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-history-search"
  ]
}
```

Or let OpenCode add it for you:

```bash
opencode plugin add opencode-history-search
```

### Quick Install

```bash
# Using npx (npm)
npx opencode-history-search

# Using bunx (bun)
bunx opencode-history-search

# From GitHub directly
npx github:joeyism/opencode-history-search
```

The installer copies the plugin to `~/.config/opencode/plugins/history-search.ts`
(`$XDG_CONFIG_HOME/opencode/plugins/` when set), where OpenCode loads it
automatically.

### From a Local Clone

```bash
git clone https://github.com/joeyism/opencode-history-search.git
cd opencode-history-search
bun install
bun run build
```

Then add the clone's absolute path to `plugins` in `~/.config/opencode/opencode.json`
(for example `"plugins": ["/home/me/opencode-history-search"]`), or copy the
built file into your plugins directory with `bun run install:tool`. OpenCode
watches the built file, so after `bun run build` it reloads the plugin.

### Upgrading from OpenCode v1

OpenCode 2 no longer loads custom tools from `tool/` directories. If you used
the old installer, remove `history-search.ts` and `history-search.txt` from
`~/.opencode/tool/` or `~/.config/opencode/tool/`, then install again with one
of the methods above. The installer lists any such leftover files it finds.

## Use Cases

Things you can ask OpenCode once this tool is installed:

### Find something you worked on but forgot which project

> "Search across all my projects for conversations about auth code"

> "Find sessions globally where you wrote a database migration"

> "Which project did we discuss the rate limiting implementation?"

### Find sessions where a file was created or modified

> "Find me sessions where you created or modified `src/install.ts`"

> "Which sessions touched anything under `src/utils/`?"

> "Show me every time you edited the auth module"

### Find something you worked on recently

> "Find sessions from the last 7 days where we talked about storage"

> "What did we work on yesterday?"

> "Show me sessions from January where we discussed authentication"

### Recall something the AI said or implemented

> "Find sessions where you explained how fuzzy search works"

> "Search my history for where you wrote a Bun SQLite query"

> "Find sessions where you mentioned ripgrep"

### Recall something you asked

> "Find sessions where I asked about rate limiting" _(role: user)_

> "Search only my messages for 'how do I'"

### Find sessions by topic when you can't remember the exact wording

> "Find sessions related to 'autentication'" _(fuzzy — catches typos)_

> "Search for 'databse connection'" _(fuzzy — finds "database connection")_

### Find sessions matching multiple concepts at once

> "Find sessions about training gemini with truck data" _(multi-term — matches all concepts across any part of the session)_

> "Search for sessions that mention both 'authentication' and 'rate limiting'"

> "Find conversations where we used vertex and gemini and discussed fine-tuning"

### Find sessions where a specific tool was used

> "Find sessions where you ran grep on the codebase"

> "Show me sessions where you used the bash tool"

### Search with a pattern

> "Find all sessions that touched any `.test.ts` file"

> "Find sessions mentioning any `stor*.ts` file"

## Parameters

| Parameter        | Type                      | Default     | Description                                            |
| ---------------- | ------------------------- | ----------- | ------------------------------------------------------ |
| `searchAllProjects` | boolean                   | `false`     | Search ALL projects on this machine (set to `true` for global search) |
| `query`          | string                    | _required_  | Search query (keyword, regex, or fuzzy term). Required unless `filePath` or `terms` is provided. |
| `terms`          | string[]                  | _none_      | Array of terms to search for with AND semantics — returns sessions that contain ALL terms across any part. For 2+ terms. |
| `filePath`       | string                    | _none_      | Trace touch history for a file path.                   |
| `mode`           | `"keyword"` \| `"fuzzy"`  | `"keyword"` | Search mode                                            |
| `regex`          | boolean                   | `false`     | Treat query as regex (keyword mode only)               |
| `caseSensitive`  | boolean                   | `false`     | Enable case-sensitive search (keyword mode only)       |
| `fuzzyThreshold` | number                    | `0.4`       | Fuzzy match strictness 0.0-1.0 (fuzzy mode only)       |
| `date`           | string                    | _none_      | Filter by date (see [Date Filtering](#date-filtering)) |
| `limit`          | number                    | `50`        | Maximum number of results                              |
| `role`           | `"user"` \| `"assistant"` | _none_      | Filter by message role (omit to search both)           |

## Search Modes

### Keyword Search

Finds exact matches (case-insensitive by default).

```typescript
{ query: "storage", mode: "keyword" }
// Finds: "storage", "Storage", "STORAGE"
// Does not find: "storag", "storing"
```

### Regex Search

Uses regular expressions for pattern matching.

```typescript
{ query: "stor.*ge", regex: true }
// Finds: "storage", "storeage"
```

### Fuzzy Search

Tolerates typos and variations using Levenshtein distance.

```typescript
{ query: "storag", mode: "fuzzy", fuzzyThreshold: 0.3 }
// Finds: "storage" (missing letter)

{ query: "ripgrap", mode: "fuzzy", fuzzyThreshold: 0.4 }
// Finds: "ripgrep" (transposition)
```

### Multi-Term AND Search

Search for sessions that contain **all** of multiple concepts at once. Each term is matched as a substring across session titles and part content (text, tool inputs/outputs, file paths). Returns one result per session, with an excerpt for each matched term.

```typescript
{
  terms: ["truck", "vertex", "gemini"],
  searchAllProjects: true,
  limit: 20
}
// Returns sessions whose parts collectively contain "truck" AND "vertex" AND "gemini"
// (terms can be in different parts of the same session)
```

Multi-term search is **session-level**: a session matches if all terms appear anywhere in its content, even across different messages. This is useful when you remember multiple concepts from a session but not a single connecting phrase. It runs as a single SQL query with conditional aggregation for performance.

## Date Filtering

| Format                       | Example                            | Description                      |
| ---------------------------- | ---------------------------------- | -------------------------------- |
| `"today"`                    | `date: "today"`                    | Today (00:00:00 - 23:59:59)      |
| `"yesterday"`                | `date: "yesterday"`                | Yesterday                        |
| `"last N days"`              | `date: "last 7 days"`              | Last N days from now             |
| `"last N weeks"`             | `date: "last 2 weeks"`             | Last N weeks from now            |
| `"last N months"`            | `date: "last 3 months"`            | Last N months from now           |
| `"YYYY-MM-DD"`               | `date: "2024-01-15"`               | Specific day                     |
| `"YYYY-MM"`                  | `date: "2024-01"`                  | Entire month                     |
| `"YYYY-MM-DD to YYYY-MM-DD"` | `date: "2024-01-01 to 2024-01-31"` | Date range (inclusive)           |

## Output Format

```
Found 3 matches in conversation history:

## Implement storage layer
- Session ID: ses_abc123...
- Project: /home/user/projects/my-app
- Date: 2026-02-01 10:30:00
- Match Type: title
- Excerpt: "Implement storage layer"

## Fix storage bug
- Session ID: ses_def456...
- Date: 2026-01-31 14:20:15
- Match Type: message
- Excerpt: "The storage module has a bug..."
- Context: ...need to fix the storage module has a bug in the...
```

### Match Types

| Type        | What it matches                                           |
| ----------- | --------------------------------------------------------- |
| `title`     | Session title                                             |
| `message`   | Text content of a user or assistant message               |
| `tool`      | Tool name (grep, edit, bash, read, etc.)                  |
| `filepath`  | File paths in tool inputs/outputs or patch parts          |

### Multi-Term Output Format

When using `terms` (multi-term AND search), output is session-grouped with per-term excerpts:

```
Found 3 sessions in conversation history:

## Train truck model on Vertex
- Session ID: ses_abc123...
- Project: /home/user/projects/my-app
- Date: 2026-07-15
- Matched terms: truck, vertex, gemini
  - truck: ...we trained truck model on data...
  - vertex: ...please use vertex ai...
  - gemini: ...tune gemini-2.5-flash...

## Another session
- Session ID: ses_def456...
- Project: /home/user/projects/other
- Date: 2026-07-10
- Matched terms: truck, vertex, gemini
  - truck: ...NonTruckExamples/x.ts...
  - vertex: ...GOOGLE_VERTEX_LOCATION=global...
  - gemini: ...gemini-service-account.json...
```

## How It Works

1. **Storage**: Reads OpenCode 2's SQLite database, read-only
2. **Project Scoping**: By default, scopes searches to the OpenCode project the plugin is loaded in. Set `searchAllProjects: true` to search across all projects.
3. **Indexing**: For fuzzy search, builds a searchable index of all content
4. **Matching**: Applies chosen search algorithm (keyword, regex, or fuzzy)
5. **Sorting**: Returns results sorted by timestamp (newest first)

## Storage Structure

```
~/.local/share/opencode/opencode.db   ($XDG_DATA_HOME/opencode/opencode.db)
├── session_v2        # sessions
├── session_message   # user prompts, assistant messages (with modified files)
└── session_part      # assistant text and tool calls
```

These are OpenCode's internal tables, not a public API. If an OpenCode release
changes them, the queries to update are in `storage-sqlite.ts`,
`search/file-trace.ts` and `search/multiterm-sql.ts`.

### Sessions from OpenCode v1

History from OpenCode v1 stays searchable, because OpenCode 2 migrates it into
the tables above:

- v1.2+ kept sessions in the same database, in `session`, `message` and `part`.
  On first start OpenCode 2 copies them into its own tables and leaves the v1
  tables as they were, so this plugin never reads them.
- v1.1.x kept sessions as JSON files under `~/.local/share/opencode/storage/`.
  v1.2+ moved them into its database when it started, and the files were left
  behind, so they reach OpenCode 2 the same way.

This plugin no longer reads the JSON files. The one case that loses history is
going straight from v1.1.x to OpenCode 2 without ever running v1.2+: OpenCode 2
migrates only v1's database, so those JSON-only sessions never reach it, and
this plugin cannot find them either.

## Development

```bash
# Run unit tests
bun run test

# Run integration tests (requires real OpenCode data)
bun run test:integration

# Build
bun run build
```

### Project Structure

```
src/
├── index.ts                  # Plugin definition, tool registration & main entry
├── format.ts                 # Output formatting (single-term, multi-term, file-trace)
├── storage.ts                # Session, message and part shapes used by the searches
├── storage-sqlite.ts         # OpenCode 2 session store (read-only)
├── storage-provider.ts       # Storage API used by keyword and fuzzy search
├── test-fixture.ts           # In-memory OpenCode 2 database for tests
└── search/
    ├── keyword.ts            # Keyword & regex search (single-term, per-part)
    ├── multiterm-sql.ts       # Multi-term AND search (session-level, SQL-based)
    ├── fuzzy.ts              # Fuzzy search
    ├── file-trace.ts         # File touch history tracing
    └── date-filter.ts        # Date filtering
```

## License

MIT

## Acknowledgments

- Built for [OpenCode](https://opencode.ai)
- Uses [Fuse.js](https://fusejs.io/) for fuzzy search
- Powered by [Bun](https://bun.sh)
