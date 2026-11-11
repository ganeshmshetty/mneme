import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ModelRoute } from "@/lib/agent/events";
import type { ProviderOptionsMap } from "./model-call";
import { getKey, type KeyName } from "@/lib/keys";
import {
  DEFAULT_MODEL_ID,
  getModel,
  MODELS,
  type ModelOption,
  type ProviderId,
  type ReasoningEffort,
} from "@/lib/models";

export type OpenCodePlan = "console" | "go";
export type ModelConnection = "direct" | "opencode" | "opencode-go";

export interface ResolvedModel {
  /** Registry entry, used for storage and the model chip. */
  option: ModelOption;
  model: LanguageModel;
  route: ModelRoute;
  connection: ModelConnection;
  modelId: string;
  apiModelId: string;
  label: string;
  reasoning: ReasoningEffort;
  /**
   * Provider options that must be present on every call, such as DeepSeek's
   * reasoning_effort. Keyed by the provider name passed to the SDK.
   */
  providerOptions?: ProviderOptionsMap;
}

export class ModelKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelKeyError";
  }
}

/**
 * Every registry entry gets an explicit effort. Providers change their defaults,
 * so leaving this unset makes two turns behave differently for no visible reason.
 */
const REASONING_BY_MODEL: Record<string, ReasoningEffort> = {
  "deepseek-v4.1-flash": "low",
  "anthropic-sonnet-5.5": "low",
  "anthropic-opus-5.5": "high",
  "openai-gpt-6.1-sol": "low",
  "openai-gpt-6-astra": "high",
  "google-gemini-3.8-flash": "low",
  "google-gemini-4-argon": "high",
};

/** Models that OpenCode Go can serve from this registry. */
const GO_MODEL_IDS = new Set(["deepseek-v4.1-flash", "google-gemini-4-argon"]);

const OPENCODE_ROOT = "https://opencode.ai/inference";
const OPENCODE_GO_ROOT = "https://opencode.ai/inference/go";
const OPENCODE_USER_AGENT = "mneme-chat-agent/1.0";

export function getOpenCodePlan(): OpenCodePlan {
  return process.env.OPENCODE_PLAN?.trim().toLowerCase() === "go" ? "go" : "console";
}

export function defaultModelId(): string {
  return process.env.MNEME_DEFAULT_MODEL?.trim() || DEFAULT_MODEL_ID;
}

function openCodeReasoningOverride(): ReasoningEffort | null {
  const value = process.env.OPENCODE_REASONING_EFFORT?.trim().toLowerCase();
  return value === "low" || value === "high" || value === "max" ? value : null;
}

/**
 * OpenCode uses hyphens in Claude version suffixes (claude-sonnet-5-5), while
 * the direct Anthropic registry IDs use a dot. Other IDs pass through.
 */
export function openCodeModelId(option: ModelOption): string {
  if (option.provider !== "anthropic") return option.modelId;
  return option.modelId.replace(/^(claude-[a-z]+)-(\d+)\.(\d+)$/, "$1-$2-$3");
}

export function reasoningForModel(
  option: ModelOption,
  useOpenCodeOverride = false,
): ReasoningEffort {
  if (useOpenCodeOverride) {
    const override = openCodeReasoningOverride();
    if (override) return override;
  }
  return option.reasoningEffort ?? REASONING_BY_MODEL[option.id] ?? "low";
}

function openCodeTarget(option: ModelOption, plan: OpenCodePlan): ModelOption {
  if (plan === "console") return option;
  if (option.route === "opencode" || option.go) return option;
  return GO_MODEL_IDS.has(option.id) ? option : getModel("google-gemini-4-argon");
}

function genericOpenCodeOption(id: string): ModelOption {
  const plan = getOpenCodePlan();
  return {
    id,
    provider: "opencode",
    providerLabel: plan === "go" ? "OpenCode Go" : "OpenCode",
    label: id,
    modelId: id,
    tier: "default",
    keyEnv: "OPENCODE_API_KEY",
    route: "opencode",
    reasoningEffort: "low",
    go: plan === "go",
  };
}

function openCodeHeaders(sessionId: string): Record<string, string> {
  return {
    "x-opencode-session": sessionId,
    "User-Agent": OPENCODE_USER_AGENT,
  };
}

function createDirectModel(option: ModelOption, apiKey: string): LanguageModel {
  switch (option.provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(option.modelId);
    case "openai":
      return createOpenAI({ apiKey })(option.modelId);
    case "google":
      return createGoogle({ apiKey })(option.modelId);
    case "deepseek":
      throw new ModelKeyError("DeepSeek runs only through OpenCode.");
    case "opencode":
      throw new ModelKeyError("OpenCode models run only through the OpenCode route.");
  }
}

function createOpenCodeModel(
  option: ModelOption,
  apiKey: string,
  plan: OpenCodePlan,
  sessionId: string,
): LanguageModel {
  const root = plan === "go" ? OPENCODE_GO_ROOT : OPENCODE_ROOT;
  const headers = {
    ...openCodeHeaders(sessionId),
    Authorization: `Bearer ${apiKey}`,
  };
  const modelId = openCodeModelId(option);

  switch (option.provider) {
    case "deepseek":
    case "opencode":
      return createOpenAICompatible({
        name: "opencode",
        baseURL: `${root}/openai/v1`,
        apiKey,
        headers: openCodeHeaders(sessionId),
      }).chatModel(modelId);
    case "anthropic":
      return createAnthropic({
        apiKey,
        baseURL: `${root}/anthropic`,
        headers,
      })(modelId);
    case "openai":
      return createOpenAI({
        apiKey,
        baseURL: `${root}/openai/v1`,
        headers,
      })(modelId);
    case "google":
      return createGoogle({
        apiKey,
        baseURL: `${root}/google/v1beta`,
        headers,
      })(modelId);
  }
}

function keyNameFor(provider: ProviderId): KeyName {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "google":
      return "GOOGLE_GENERATIVE_AI_API_KEY";
    case "deepseek":
    case "opencode":
      return "OPENCODE_API_KEY";
  }
}

export interface ResolveModelInput {
  modelId?: string;
  /** Stable per-chat id for x-opencode-session. */
  sessionId?: string;
}

/**
 * One model handles the whole turn. A direct key for the selected family wins;
 * otherwise the same registry model runs through OpenCode Console. DeepSeek has
 * no direct route and always uses OpenCode's OpenAI-compatible endpoint.
 */
export async function resolveModel(input: ResolveModelInput = {}): Promise<ResolvedModel> {
  const requestedId = input.modelId?.trim() || defaultModelId();
  const selected =
    MODELS.find((model) => model.id === requestedId) ??
    genericOpenCodeOption(requestedId);
  const sessionId = input.sessionId?.trim() || crypto.randomUUID();
  const openCodeKey = await getKey("OPENCODE_API_KEY");

  const mustUseOpenCode = selected.route === "opencode" || selected.provider === "deepseek";

  if (!mustUseOpenCode) {
    const directKey = await getKey(keyNameFor(selected.provider));
    if (directKey) {
      return {
        option: selected,
        model: createDirectModel(selected, directKey),
        route: "direct",
        connection: "direct",
        modelId: selected.id,
        apiModelId: selected.modelId,
        label: selected.label,
        reasoning: reasoningForModel(selected),
      };
    }
  }

  if (!openCodeKey) {
    const directName = keyNameFor(selected.provider);
    throw new ModelKeyError(
      selected.provider === "deepseek"
        ? "No OpenCode API key. Add OPENCODE_API_KEY in .env.local or paste it in the app."
        : `No API key for ${selected.providerLabel} and no OpenCode key. Add ${directName} or OPENCODE_API_KEY.`,
    );
  }

  const plan = getOpenCodePlan();
  const target = openCodeTarget(selected, plan);
  const reasoning = reasoningForModel(target, true);

  return {
    option: target,
    model: createOpenCodeModel(target, openCodeKey, plan, sessionId),
    route: "opencode",
    connection: plan === "go" ? "opencode-go" : "opencode",
    modelId: target.id,
    apiModelId: openCodeModelId(target),
    label: target.label,
    reasoning,
  };
}

/** For the model picker and tests: the registry is the only source of IDs. */
export const MODEL_IDS = MODELS.map((model) => model.id);
