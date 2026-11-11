import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let loaded = false;

/**
 * Standalone tsx scripts do not get Next.js's automatic .env loading.
 * Load the repo's local files once, without logging any values. Existing
 * process environment variables keep their values.
 */
export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;

  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.join(ROOT, file));
    } catch {
      // Missing or unreadable env files are fine; the caller may have exported
      // the values already.
    }
  }
}
