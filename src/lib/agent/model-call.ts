import { generateText, type LanguageModel } from "ai";
import type { ZodType } from "zod";
import type { ProviderId, ReasoningEffort } from "@/lib/models";

export class AgentAbortedError extends Error {
  constructor() {
    super("The run was aborted.");
    this.name = "AbortError";
  }
}

export class EmptyModelOutputError extends Error {
  constructor() {
    super("The model returned an empty answer.");
    this.name = "EmptyModelOutputError";
  }
}

export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelOutputError";
  }
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ProviderOptionsMap = Record<string, { [key: string]: JsonValue }>;

export interface ModelRuntime {
  model: LanguageModel;
  reasoning: ReasoningEffort;
  provider?: ProviderId;
  label?: string;
  /**
   * Sent on every call. DeepSeek's reasoning_effort travels through the
   * openai-compatible adapter as a provider option.
   */
  providerOptions?: ProviderOptionsMap;
}

export interface GenerateOptions {
  signal?: AbortSignal;
  /** Stable developer instructions; dynamic context stays in prompt. */
  system?: string;
  maxOutputTokens?: number;
  /** Deterministic output for routing/rewrite calls. */
  temperature?: number;
  /** One bounded retry by default, so two attempts total. */
  retries?: number;
  /**
   * Plan, query and claim calls do not need thinking. DeepSeek receives
   * `thinking: { type: "disabled" }`; other providers keep their normal path.
   */
  disableThinking?: boolean;
}

function providerOptionsFor(
  runtime: ModelRuntime,
  disableThinking: boolean | undefined,
): ProviderOptionsMap | undefined {
  if (!disableThinking || runtime.provider !== "deepseek") {
    return runtime.providerOptions;
  }
  return {
    ...(runtime.providerOptions ?? {}),
    opencode: {
      ...(runtime.providerOptions?.opencode ?? {}),
      thinking: { type: "disabled" },
    },
  };
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AgentAbortedError();
}

async function generateOnce(
  runtime: ModelRuntime,
  prompt: string,
  options: GenerateOptions,
): Promise<string> {
  assertNotAborted(options.signal);
  const result = await generateText({
    model: runtime.model,
    system: options.system,
    prompt,
    maxOutputTokens: options.maxOutputTokens ?? 4_000,
    temperature: options.temperature,
    reasoning:
      options.disableThinking && runtime.provider === "deepseek"
        ? undefined
        : runtime.reasoning,
    providerOptions: providerOptionsFor(runtime, options.disableThinking),
    maxRetries: 0,
    abortSignal: options.signal,
  });
  const text = result.text.trim();
  if (!text) throw new EmptyModelOutputError();
  return text;
}

export async function generateTextWithRetry(
  runtime: ModelRuntime,
  prompt: string,
  options: GenerateOptions = {},
): Promise<string> {
  const attempts = 1 + Math.max(0, options.retries ?? 1);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await generateOnce(runtime, prompt, options);
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw new AgentAbortedError();
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ModelOutputError("The model call failed.");
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ModelOutputError("The model did not return a JSON object.");
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    throw new ModelOutputError("The model returned invalid JSON.");
  }
}

export async function generateJsonWithRetry<T>(
  runtime: ModelRuntime,
  prompt: string,
  schema: ZodType<T>,
  options: GenerateOptions = {},
): Promise<T> {
  const attempts = 1 + Math.max(0, options.retries ?? 1);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const raw = await generateOnce(runtime, prompt, options);
      return schema.parse(extractJson(raw));
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw new AgentAbortedError();
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ModelOutputError("The model call failed.");
}
