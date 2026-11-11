import { streamText } from "ai";
import type { AnswerFormat } from "./events";
import {
  createAnswerStreamParser,
  type AnswerStreamResult,
} from "./format";
import {
  AgentAbortedError,
  EmptyModelOutputError,
  isAbortError,
  type GenerateOptions,
  type ModelRuntime,
} from "./model-call";

export interface AnswerStreamCallbacks {
  onFormat: (format: AnswerFormat) => void;
  onDelta: (text: string) => void;
}

/**
 * Streams one model response and strips its leading format token. A control
 * response ([[recall]] or [[search]]) is returned before any answer text.
 * A retry happens only when the stream fails before any text reached the UI,
 * so a partial answer is never duplicated.
 */
export async function streamAnswerWithRetry(
  runtime: ModelRuntime,
  prompt: string,
  options: GenerateOptions,
  callbacks: AnswerStreamCallbacks,
): Promise<AnswerStreamResult> {
  const attempts = 1 + Math.max(0, options.retries ?? 1);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) throw new AgentAbortedError();

    let sawText = false;
    const parser = createAnswerStreamParser(callbacks.onFormat, (text) => {
      sawText = true;
      callbacks.onDelta(text);
    });

    try {
      const result = streamText({
        model: runtime.model,
        system: options.system,
        prompt,
        maxOutputTokens: options.maxOutputTokens ?? 6_000,
        reasoning: runtime.reasoning,
        providerOptions: runtime.providerOptions,
        maxRetries: 0,
        abortSignal: options.signal,
      });

      for await (const chunk of result.textStream) {
        parser.push(chunk);
      }

      const final = parser.finish();
      if (final.type === "answer" && !final.text) {
        throw new EmptyModelOutputError();
      }
      return final;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw new AgentAbortedError();
      lastError = error;
      // Once text reached the UI, a retry would duplicate it.
      if (sawText) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new EmptyModelOutputError();
}
