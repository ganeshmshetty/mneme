import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { MemoryStore } from "../../src/lib/memory/types";

/**
 * The memory implementation is owned by src/lib/memory. This loader only finds
 * its factory so the seed/reset scripts and the app share one store.
 *
 * Integration contract: export a `createMemoryStore()` (or equivalent) from
 * src/lib/memory/store.ts, or set MNEME_MEMORY_MODULE to another module.
 *
 * TODO(integration): once the store lands, keep this list in sync if its file
 * name differs. No SQL or storage logic lives in this file.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const MODULE_CANDIDATES = [
  "src/lib/memory/store.ts",
  "src/lib/memory/index.ts",
  "src/lib/memory/sqlite.ts",
  "src/lib/memory/memory.ts",
  "src/lib/memory/db.ts",
  "src/lib/memory.ts",
  "src/memory/store.ts",
  "src/memory/index.ts",
  "src/memory/sqlite.ts",
  "src/memory/memory.ts",
  "src/memory.ts",
];

const FACTORY_NAMES = [
  "createMemoryStore",
  "openMemoryStore",
  "getMemoryStore",
  "createStore",
  "openStore",
  "getStore",
  "createMemoryDb",
  "openMemoryDb",
  "MemoryStore",
  "SqliteMemoryStore",
  "Store",
  "memoryStore",
  "store",
  "default",
];

const STORE_METHODS: Array<keyof MemoryStore> = [
  "createChat",
  "getChat",
  "listChats",
  "renameChat",
  "deleteChat",
  "addMessage",
  "getMessages",
  "recall",
  "saveClaims",
  "saveTurn",
  "reset",
  "close",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isMemoryStore(value: unknown): value is MemoryStore {
  if (!isRecord(value)) return false;
  return STORE_METHODS.every((method) => typeof value[method] === "function");
}

function missingMethods(value: unknown): string[] {
  if (!isRecord(value)) return STORE_METHODS.map(String);
  return STORE_METHODS.filter((method) => typeof value[method] !== "function").map(String);
}

async function resolveFactory(value: unknown, label: string): Promise<MemoryStore> {
  if (isMemoryStore(value)) return value;

  if (typeof value === "function") {
    const source = Function.prototype.toString.call(value);
    const looksLikeClass = /^class\s/.test(source);

    if (!looksLikeClass) {
      try {
        const produced = await (value as () => unknown)();
        if (isMemoryStore(produced)) return produced;
      } catch (error) {
        // A class cannot be called without `new`; fall through and construct it.
        if (!/class constructor/i.test(error instanceof Error ? error.message : "")) {
          // Keep trying constructors, but remember the factory error for the
          // final diagnostic if nothing else works.
        }
      }
    }

    try {
      const produced = new (value as new () => unknown)();
      if (isMemoryStore(produced)) return produced;
    } catch {
      // Not a zero-argument store constructor.
    }
  }

  if (isRecord(value) && value.default !== undefined && value.default !== value) {
    return resolveFactory(value.default, `${label}.default`);
  }

  throw new Error(
    `${label} does not look like a MemoryStore. Missing: ${missingMethods(value).join(", ")}.`,
  );
}

interface LoadedModule {
  file: string;
  exports: Record<string, unknown>;
}

async function importCandidates(): Promise<{ modules: LoadedModule[]; errors: string[] }> {
  const explicit = process.env.MNEME_MEMORY_MODULE?.trim();
  const files = explicit
    ? [path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit)]
    : MODULE_CANDIDATES.map((file) => path.join(ROOT, file));

  const modules: LoadedModule[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const imported: unknown = await import(pathToFileURL(file).href);
      if (!isRecord(imported)) {
        errors.push(`${path.relative(ROOT, file)}: module did not export an object.`);
        continue;
      }
      modules.push({ file: path.relative(ROOT, file), exports: imported });
    } catch (error) {
      errors.push(
        `${path.relative(ROOT, file)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { modules, errors };
}

export async function loadMemoryStore(): Promise<MemoryStore> {
  const { modules, errors } = await importCandidates();

  for (const module of modules) {
    for (const name of FACTORY_NAMES) {
      if (!(name in module.exports)) continue;
      try {
        return await resolveFactory(module.exports[name], `${module.file}#${name}`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  const lookedFor = process.env.MNEME_MEMORY_MODULE
    ? [process.env.MNEME_MEMORY_MODULE]
    : MODULE_CANDIDATES.map((file) => path.join(ROOT, file)).filter((file) => existsSync(file));

  throw new Error(
    [
      "Could not find a usable memory store.",
      lookedFor.length
        ? `Found modules: ${lookedFor.map((file) => path.relative(ROOT, file)).join(", ")}`
        : `Looked for: ${MODULE_CANDIDATES.join(", ")}`,
      `Expected one of these exports: ${FACTORY_NAMES.join(", ")}.`,
      "TODO(integration): export createMemoryStore() from src/lib/memory/store.ts,",
      "or point MNEME_MEMORY_MODULE at the module that does.",
      ...errors.map((error) => `- ${error}`),
    ].join("\n"),
  );
}
