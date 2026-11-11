import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KeyStatus } from "@/lib/models";

export const KEY_NAMES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENCODE_API_KEY",
  "FIRECRAWL_API_KEY",
  "TAVILY_API_KEY",
] as const;

export type KeyName = (typeof KEY_NAMES)[number];

const DATA_DIR = path.join(process.cwd(), "data");
const KEY_FILE = path.join(DATA_DIR, "keys.json");

function mask(value: string): string {
  if (value.length <= 4) return "••••";
  return `${"•".repeat(Math.min(12, Math.max(4, value.length - 4)))}${value.slice(-4)}`;
}

async function readFileKeys(): Promise<Partial<Record<KeyName, string>>> {
  try {
    const raw = await readFile(KEY_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const keys: Partial<Record<KeyName, string>> = {};
    for (const name of KEY_NAMES) {
      const value = parsed[name];
      if (typeof value === "string" && value.trim()) keys[name] = value.trim();
    }
    return keys;
  } catch {
    return {};
  }
}

export async function getKey(name: KeyName): Promise<string | undefined> {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = await readFileKeys();
  return fromFile[name];
}

export async function getKeyStatuses(): Promise<Record<KeyName, KeyStatus>> {
  const fileKeys = await readFileKeys();
  const statuses = {} as Record<KeyName, KeyStatus>;
  for (const name of KEY_NAMES) {
    const envValue = process.env[name]?.trim();
    if (envValue) {
      statuses[name] = { configured: true, masked: mask(envValue), source: "env" };
      continue;
    }
    const fileValue = fileKeys[name];
    statuses[name] = fileValue
      ? { configured: true, masked: mask(fileValue), source: "file" }
      : { configured: false };
  }
  return statuses;
}

export async function saveKey(name: KeyName, value: string): Promise<void> {
  if (!KEY_NAMES.includes(name)) throw new Error("Unknown key");
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Key is empty");
  const existing = await readFileKeys();
  existing[name] = trimmed;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(KEY_FILE, JSON.stringify(existing, null, 2), { mode: 0o600 });
}
