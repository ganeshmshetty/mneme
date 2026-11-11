export type ProviderId = "deepseek" | "opencode" | "anthropic" | "openai" | "google";

export type ModelTier = "default" | "strong";

export type ModelRoute = "direct" | "opencode";

export type ReasoningEffort = "low" | "high" | "max";

export interface Provider {
  id: ProviderId;
  label: string;
  keyEnv: string;
}

export interface ModelOption {
  id: string;
  provider: ProviderId;
  providerLabel: string;
  label: string;
  modelId: string;
  tier: ModelTier;
  keyEnv: string;
  route?: ModelRoute;
  reasoningEffort?: ReasoningEffort;
  /** Available on an OpenCode Go subscription. */
  go?: boolean;
  /** Provider family label for the model list, e.g. "DeepSeek Flash". */
  family?: string;
}

export interface KeyStatus {
  configured: boolean;
  masked?: string;
  source?: "env" | "file";
}

export type OpenCodePlan = "console" | "go";

export interface ModelsResponse {
  providers: Provider[];
  models: ModelOption[];
  keys: Record<string, KeyStatus>;
  opencode: boolean;
  opencodePlan: OpenCodePlan;
}

export const PROVIDERS: Provider[] = [
  { id: "deepseek", label: "DeepSeek", keyEnv: "OPENCODE_API_KEY" },
  { id: "anthropic", label: "Anthropic", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY" },
  { id: "google", label: "Google", keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY" },
];

export const MODELS: ModelOption[] = [
  {
    id: "deepseek-v4.1-flash",
    provider: "deepseek",
    providerLabel: "DeepSeek",
    label: "DeepSeek 4.1 Flash",
    modelId: "deepseek-v4.1-flash",
    tier: "default",
    keyEnv: "OPENCODE_API_KEY",
    route: "opencode",
    reasoningEffort: "low",
    go: true,
  },
  {
    id: "anthropic-sonnet-5.5",
    provider: "anthropic",
    providerLabel: "Anthropic",
    label: "Claude Sonnet 5.5",
    modelId: "claude-sonnet-5-5",
    tier: "default",
    keyEnv: "ANTHROPIC_API_KEY",
  },
  {
    id: "anthropic-opus-5.5",
    provider: "anthropic",
    providerLabel: "Anthropic",
    label: "Claude Opus 5.5",
    modelId: "claude-opus-5-5",
    tier: "strong",
    keyEnv: "ANTHROPIC_API_KEY",
  },
  {
    id: "openai-gpt-6.1-sol",
    provider: "openai",
    providerLabel: "OpenAI",
    label: "GPT-6.1 Sol",
    modelId: "gpt-6.1-sol",
    tier: "default",
    keyEnv: "OPENAI_API_KEY",
  },
  {
    id: "openai-gpt-6-astra",
    provider: "openai",
    providerLabel: "OpenAI",
    label: "GPT-6 Astra",
    modelId: "gpt-6-astra",
    tier: "strong",
    keyEnv: "OPENAI_API_KEY",
  },
  {
    id: "google-gemini-3.8-flash",
    provider: "google",
    providerLabel: "Google",
    label: "Gemini 3.8 Flash",
    modelId: "gemini-3.8-flash",
    tier: "default",
    keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
  },
  {
    id: "google-gemini-4-argon",
    provider: "google",
    providerLabel: "Google",
    label: "Gemini 4 Argon",
    modelId: "gemini-4-argon",
    tier: "strong",
    keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    go: true,
  },
];

export const DEFAULT_MODEL_ID = "deepseek-v4.1-flash";

export function getModel(id: string | null | undefined): ModelOption {
  return MODELS.find((model) => model.id === id) ?? MODELS[0];
}

export function modelsForProvider(provider: ProviderId): ModelOption[] {
  return MODELS.filter((model) => model.provider === provider);
}
