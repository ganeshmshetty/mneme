import { z } from "zod";
import { DEFAULT_MODEL_ID, type ModelOption } from "@/lib/models";

const modelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  family: z.string().optional(),
  cost: z
    .object({
      text: z
        .object({
          input: z.object({ price: z.number() }).optional(),
          output: z.object({ price: z.number() }).optional(),
        })
        .optional(),
    })
    .optional(),
});

const catalogSchema = z.object({
  data: z.array(modelSchema),
});

export type OpenCodePlan = "console" | "go";

const PRETTY_LABELS: Record<string, string> = {
  "deepseek-v4.1-flash": "DeepSeek 4.1 Flash",
  "deepseek-v4-pro": "DeepSeek 4 Pro",
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "gemini-4-argon": "Gemini 4 Argon",
  "gpt-6-luna": "GPT-6 Luna",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "glm-5.3-flash": "GLM-5.3 Flash",
  "glm-5.3": "GLM-5.3",
  "glm-5.2": "GLM-5.2",
  "kimi-k3": "Kimi K3",
  "kimi-k3.1-pro": "Kimi K3.1 Pro",
  "qwen3.8-flash": "Qwen3.8 Flash",
  "qwen3.8-max": "Qwen3.8 Max",
  "minimax-m3": "MiniMax M3",
  "grok-4.7": "Grok 4.7",
};

const FAMILY_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  claude: "Anthropic",
  gemini: "Google",
  gpt: "OpenAI",
  glm: "GLM",
  kimi: "Kimi",
  qwen: "Qwen",
  minimax: "MiniMax",
  grok: "Grok",
  muse: "Muse",
  hy: "Hy",
  "big-pickle": "OpenCode",
};

function familyLabel(family: string | undefined): string | undefined {
  if (!family) return undefined;
  const key = family.toLowerCase();
  if (FAMILY_LABELS[key]) return FAMILY_LABELS[key];
  const base = key.split(/[-_]/)[0];
  return (
    FAMILY_LABELS[base] ??
    family
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function prettyLabel(id: string, name: string | undefined): string {
  return PRETTY_LABELS[id] ?? (name ?? id).replace(/\s+\d{4}$/, "");
}

interface CacheEntry {
  at: number;
  models: ModelOption[];
}

let cache: CacheEntry | null = null;

export async function fetchOpenCodeModels(
  plan: OpenCodePlan,
  apiKey: string,
): Promise<ModelOption[] | null> {
  if (cache && Date.now() - cache.at < 60_000) return cache.models;

  const base =
    plan === "go"
      ? "https://opencode.ai/inference/go/v1/models"
      : "https://opencode.ai/inference/v1/models";

  try {
    const response = await fetch(base, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "mneme-chat-agent/1.0",
        "x-opencode-session": "mneme-model-catalog",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;

    const parsed = catalogSchema.safeParse(await response.json());
    if (!parsed.success) return null;

    const models: ModelOption[] = [];
    for (const item of parsed.data.data) {
      if (item.type && item.type !== "chat") continue;
      if (item.id.endsWith("-free")) continue;
      if (/free\b/i.test(item.name ?? "")) continue;

      const input = item.cost?.text?.input?.price ?? 0;
      const output = item.cost?.text?.output?.price ?? 0;
      if (input <= 0 && output <= 0) continue;

      models.push({
        id: item.id,
        provider: "opencode",
        providerLabel: plan === "go" ? "OpenCode Go" : "OpenCode",
        label: prettyLabel(item.id, item.name),
        modelId: item.id,
        tier: "default",
        keyEnv: "OPENCODE_API_KEY",
        route: "opencode",
        reasoningEffort: "low",
        go: plan === "go",
        family: familyLabel(item.family),
      });
    }

    models.sort((a, b) => {
      if (a.id === DEFAULT_MODEL_ID) return -1;
      if (b.id === DEFAULT_MODEL_ID) return 1;
      return a.label.localeCompare(b.label);
    });

    cache = { at: Date.now(), models };
    return models;
  } catch {
    return null;
  }
}
