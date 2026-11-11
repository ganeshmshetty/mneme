import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./lib/env";
import { loadMemoryStore } from "./lib/memory";

/**
 * Delete all memory (chats, episodes, claims) and nothing else.
 * Keys live in data/keys.json and are intentionally untouched.
 */
async function main(): Promise<void> {
  loadLocalEnv();
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      [
        "Usage: npm run reset",
        "",
        "Deletes every chat, episode and claim from local memory.",
        "Saved API keys in data/keys.json are kept.",
      ].join("\n"),
    );
    return;
  }

  const store = await loadMemoryStore();
  try {
    const before = await store.listChats();
    await store.reset();
    console.log(
      `Memory cleared: ${before.length} chat${before.length === 1 ? "" : "s"} removed.`,
    );
    console.log("Saved keys in data/keys.json were not touched.");
  } finally {
    store.close();
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
