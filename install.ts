#!/usr/bin/env bun

import { existsSync, mkdirSync, copyFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// OpenCode 2 loads single-file plugins from the plugins/ directory of its
// global config directory, and watches it, so no restart is needed.
// OpenCode v1 custom tool directories (tool/) are no longer loaded.

function configDir(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode");
}

/** Files left by the OpenCode v1 installer, which OpenCode 2 ignores. */
function legacyFiles(): string[] {
  return [join(homedir(), ".opencode", "tool"), join(configDir(), "tool")]
    .flatMap((dir) => ["history-search.ts", "history-search.txt"].map((file) => join(dir, file)))
    .filter((file) => existsSync(file));
}

/**
 * A global config file that mentions the plugin, which may mean it already
 * loads it and the tool would be registered twice. Only a hint: a comment in
 * opencode.jsonc can mention it too.
 */
function configMentioningPlugin(): string | undefined {
  return ["opencode.json", "opencode.jsonc"]
    .map((name) => join(configDir(), name))
    .find((file) => existsSync(file) && readFileSync(file, "utf8").includes("opencode-history-search"));
}

function install() {
  console.log("🔍 OpenCode History Search Installer\n");

  const sourcePath = join(import.meta.dir, "dist", "history-search.ts");
  if (!existsSync(sourcePath)) {
    console.error("❌ Error: dist/history-search.ts not found");
    console.error("   Please run: bun run build");
    process.exit(1);
  }

  try {
    const pluginDir = join(configDir(), "plugins");
    mkdirSync(pluginDir, { recursive: true });
    const targetPath = join(pluginDir, "history-search.ts");
    copyFileSync(sourcePath, targetPath);
    console.log(`✅ Installed ${targetPath}`);
  } catch (error) {
    console.error("\n❌ Installation failed:", error);
    process.exit(1);
  }

  const config = configMentioningPlugin();
  if (config) {
    console.log(
      `\n⚠️  ${config} mentions opencode-history-search.` +
        "\n   If it loads the plugin, keep only one of the two, or the tool is registered twice.",
    );
  }

  const legacy = legacyFiles();
  if (legacy.length > 0) {
    console.log("\n🧹 OpenCode 2 ignores these files from the OpenCode v1 installer; you can remove them:");
    legacy.forEach((file) => console.log(`   ${file}`));
  }

  console.log("\n🎉 Installation complete! OpenCode picks up the plugin without a restart.");
  console.log("\n📝 Usage:");
  console.log("   Ask OpenCode: \"Search my conversation history for 'storage'\"");
  console.log("   Or: \"Search for 'storag' using fuzzy mode\"");
}

install();
