# Installation Guide

opencode-history-search is an OpenCode 2 plugin. Install it with **one** of the
methods below; using more than one registers the tool twice. OpenCode reloads
plugins when their config or files change, so there is no need to restart it.

## 1. OpenCode Config (Recommended)

Let OpenCode add it to your global config:

```bash
opencode plugin add opencode-history-search
```

Or add it to `~/.config/opencode/opencode.json` yourself:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-history-search"]
}
```

OpenCode installs the package and keeps it up to date.

## 2. Quick Install (single file)

```bash
npx opencode-history-search
# or
bunx opencode-history-search
# or, from GitHub
npx github:joeyism/opencode-history-search
```

The installer:

- ✅ Copies the plugin to `~/.config/opencode/plugins/history-search.ts`
  (`$XDG_CONFIG_HOME/opencode/plugins/` when set)
- ✅ Warns if your global config also lists the package
- ✅ Lists files left by the OpenCode v1 installer, which you can remove

OpenCode loads any `.ts` file in that directory. The file has no dependencies,
so nothing else needs installing.

## 3. From a Local Clone

```bash
git clone https://github.com/joeyism/opencode-history-search.git
cd opencode-history-search
bun install
bun run build
```

Then either add the clone's absolute path to `plugins` in
`~/.config/opencode/opencode.json`:

```json
{
  "plugins": ["/home/me/opencode-history-search"]
}
```

or copy the built file into your plugins directory:

```bash
bun run install:tool
```

When loading from the clone, OpenCode watches `dist/history-search.ts`, so
`bun run build` is enough to pick up changes.

---

## Verification

1. **Check that OpenCode loaded it:**

   ```bash
   grep history-search ~/.local/share/opencode/log/opencode.log | tail -5
   ```

   You should see `loading plugin` for it and no `failed to load plugin`; a
   failure line carries the reason.

2. **Check that searching works** (from a clone, after `bun run build`):

   ```bash
   bun run verify-installation.ts
   ```

3. **Try it in OpenCode:**

   ```
   You: Search my conversation history for "storage"
   AI: <uses the history-search tool and shows results>
   ```

---

## Troubleshooting

### The tool does not show up

- Make sure you use OpenCode 2 (`opencode --version`). This version of the
  plugin does not load in OpenCode v1.
- Check the log for `failed to load plugin` next to `history-search`.
- A plugin path configured in `opencode.json` must be a directory (the clone),
  not a file.

### The tool shows up twice

It is installed by more than one method. Keep either the `plugins` entry in
`opencode.json` or `~/.config/opencode/plugins/history-search.ts`, not both.

### Build errors

Make sure you have Bun installed:

```bash
curl -fsSL https://bun.sh/install | bash
```

---

## Upgrading from OpenCode v1

OpenCode 2 no longer loads custom tools from `tool/` directories, so the files
the old installer wrote are ignored. Remove them, then install again with one of
the methods above:

```bash
rm -f ~/.opencode/tool/history-search.ts ~/.opencode/tool/history-search.txt
rm -f ~/.config/opencode/tool/history-search.ts ~/.config/opencode/tool/history-search.txt
```

Your v1 history stays searchable; see "Sessions from OpenCode v1" in the README.

---

## Updating

- **Config:** OpenCode updates the package itself; `opencode plugin update`
  forces it.
- **Quick Install:** run `npx opencode-history-search@latest` again.
- **Local clone:** `git pull && bun install && bun run build`, then
  `bun run install:tool` again if you copied the file.

---

## Uninstallation

Remove whichever you installed:

```bash
opencode plugin remove opencode-history-search
rm ~/.config/opencode/plugins/history-search.ts
```

or delete the clone's path from `plugins` in `~/.config/opencode/opencode.json`.
