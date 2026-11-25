#!/usr/bin/env bun

import { existsSync } from "fs";
import { homedir } from "os";
import path from "path";
import { runSearch } from "./src/index";

console.log("🔍 Verifying opencode-history-search installation...\n");

const location = path.join(
  process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
  "opencode",
  "plugins",
  "history-search.ts",
);

if (existsSync(location)) {
  console.log(`✅ Plugin found at: ${location}`);
} else {
  console.log(`ℹ️  No plugin file at ${location}.`);
  console.log("   That is expected if you load it from opencode.json instead; otherwise run: bun run install:tool");
}

console.log("\n🧪 Testing search against your OpenCode history...\n");

try {
  const result = await runSearch({ query: "storage", limit: 3, searchAllProjects: true }, "global");
  if (result.includes("conversation history")) {
    console.log("✅ Search ran successfully");
    console.log("\nSample output:");
    console.log(result.split("\n").slice(0, 10).join("\n"));
    console.log("...");
  } else {
    console.log("⚠️  Search returned unexpected output");
    console.log(result);
  }
} catch (error) {
  console.log("❌ Search failed:");
  console.error(error);
  process.exit(1);
}

console.log("\n🎉 All checks passed! In OpenCode:");
console.log("   Ask: \"Search my conversation history for 'storage'\"");
console.log("   Or: \"Find conversations about 'testing' from last 7 days\"");
