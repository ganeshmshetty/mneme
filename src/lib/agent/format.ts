import type {
  AnswerFormat,
  MemoryClaim,
  MemoryEpisode,
} from "./events";
import type { ClaimRecord, EpisodeRecord } from "@/lib/memory/types";
import { ModelOutputError } from "./model-call";
import {
  recallControlSchema,
  searchControlSchema,
  type SearchControl,
} from "./schemas";

export interface ParsedAnswer {
  format: AnswerFormat;
  text: string;
}

export type AnswerControl =
  | { type: "recall"; query?: string }
  | ({ type: "search" } & SearchControl);

export type AnswerStreamResult =
  | { type: "answer"; format: AnswerFormat; text: string }
  | AnswerControl;

export interface AnswerStreamParser {
  push(chunk: string): void;
  finish(): AnswerStreamResult;
  readonly text: string;
  readonly format: AnswerFormat | null;
}

export function looksLikeOpenUI(text: string): boolean {
  return /^\s*root\s*=\s*Answer\s*\(/.test(text);
}

function stripCodeFence(text: string): string {
  const match = text.match(/^\s*```(?:openui|txt|text)?\s*\n([\s\S]*?)\n\s*```\s*$/i);
  return match ? match[1].trim() : text;
}

function stripOpenUIFence(text: string): string {
  return text
    .replace(/^\s*```(?:openui|txt|text)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/i, "")
    .trim();
}

function jsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) throw new ModelOutputError("The model did not return a JSON object.");

  // Read the first balanced object only. Models sometimes repeat the token or
  // append a second object; slicing to the last brace would break both.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1)) as unknown;
        } catch {
          throw new ModelOutputError("The model returned invalid JSON.");
        }
      }
    }
  }

  throw new ModelOutputError("The model returned incomplete JSON.");
}

function parseRecallQuery(text: string): string | undefined {
  if (!text.includes("{")) return undefined;
  try {
    const parsed = recallControlSchema.safeParse(jsonObject(text));
    return parsed.success ? parsed.data.query : undefined;
  } catch {
    return undefined;
  }
}

function parseSearchControl(text: string): SearchControl {
  const raw = jsonObject(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ModelOutputError("The model returned an invalid search request.");
  }

  const value = raw as Record<string, unknown>;
  const listed = Array.isArray(value.queries)
    ? value.queries
    : typeof value.queries === "string"
      ? [value.queries]
      : [];
  // A model may return one query per shortlisted item and overshoot the limit.
  // Keep the turn instead of rejecting it; the search runs on the first four.
  const queries = [
    ...new Set(
      listed
        .filter((query): query is string => typeof query === "string")
        .map((query) => query.trim().slice(0, 240))
        .filter(Boolean),
    ),
  ].slice(0, 4);
  const flag = (item: unknown) => item === true || item === "true";

  const parsed = searchControlSchema.safeParse({
    queries,
    openPages: flag(value.openPages),
    recall: flag(value.recall),
    recheck: flag(value.recheck),
  });
  if (!parsed.success) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[mneme] invalid search control", parsed.error, JSON.stringify(text));
    }
    throw new ModelOutputError("The model returned an invalid search request.");
  }
  return parsed.data;
}

/**
 * Parses the leading [[markdown]] / [[openui]] answer token, or a
 * [[recall]] / [[search]] control token, while the model is still streaming.
 * Answer text is emitted as it arrives; control requests emit no answer text.
 */
export function createAnswerStreamParser(
  onFormat: (format: AnswerFormat) => void,
  onDelta: (text: string) => void,
): AnswerStreamParser {
  let buffer = "";
  let format: AnswerFormat | null = null;
  let formatEmitted = false;
  let fullText = "";
  let control: "recall" | "search" | null = null;
  let controlText = "";

  function emitText(text: string): void {
    if (!text) return;
    if (!format) format = looksLikeOpenUI(text) ? "openui" : "markdown";
    if (!formatEmitted) {
      onFormat(format);
      formatEmitted = true;
    }
    fullText += text;
    onDelta(text);
  }

  return {
    get text() {
      return fullText;
    },
    get format() {
      return format;
    },

    push(chunk: string): void {
      if (!chunk) return;

      if (control) {
        controlText += chunk;
        return;
      }

      if (format) {
        emitText(chunk);
        return;
      }

      buffer += chunk;

      const answerMarker = buffer.match(
        /^\s*\[\[\s*(markdown|openui)\s*\]\]\s*/i,
      );
      if (answerMarker) {
        format = answerMarker[1].toLowerCase() as AnswerFormat;
        const rest = buffer.slice(answerMarker[0].length);
        buffer = "";
        emitText(rest);
        return;
      }

      const recallMarker = buffer.match(/^\s*\[\[\s*recall\s*\]\]\s*/i);
      if (recallMarker) {
        control = "recall";
        controlText = buffer.slice(recallMarker[0].length);
        buffer = "";
        return;
      }

      const searchMarker = buffer.match(/^\s*\[\[\s*search\s*\]\]\s*/i);
      if (searchMarker) {
        control = "search";
        controlText = buffer.slice(searchMarker[0].length);
        buffer = "";
        return;
      }

      const withoutLeadingSpace = buffer.replace(/^\s+/, "");
      if (withoutLeadingSpace.startsWith("[[")) {
        // A token may still be arriving. A malformed opener falls back after
        // 64 characters rather than buffering the whole answer.
        if (buffer.length < 64) return;
        format = looksLikeOpenUI(buffer) ? "openui" : "markdown";
        const rest = buffer;
        buffer = "";
        emitText(rest);
        return;
      }

      if (!withoutLeadingSpace) {
        // Wait briefly; the token itself may start after leading whitespace.
        if (buffer.length < 16) return;
        buffer = "";
        return;
      }

      if (buffer.length < 16) return;
      format = looksLikeOpenUI(buffer) ? "openui" : "markdown";
      const rest = buffer;
      buffer = "";
      emitText(rest);
    },

    finish(): AnswerStreamResult {
      if (control === "recall") {
        return { type: "recall", query: parseRecallQuery(controlText) };
      }
      if (control === "search") {
        return { type: "search", ...parseSearchControl(controlText) };
      }

      if (buffer) {
        if (!format) {
          const parsed = parseAnswerFormat(buffer);
          format = parsed.format;
          const rest = parsed.text;
          buffer = "";
          emitText(rest);
        } else {
          const rest = buffer;
          buffer = "";
          emitText(rest);
        }
      }

      let text = fullText.trim();
      if (format === "openui") text = stripOpenUIFence(text);
      return { type: "answer", format: format ?? "markdown", text };
    },
  };
}

/**
 * The answer model starts with [[markdown]] or [[openui]]. The pipeline strips
 * that token before storing or rendering the answer, and emits answer_format.
 */
export function parseAnswerFormat(raw: string): ParsedAnswer {
  let text = raw.trim();
  const marker = text.match(/^\[\[\s*(markdown|openui)\s*\]\]\s*/i);

  let format: AnswerFormat = marker
    ? (marker[1].toLowerCase() as AnswerFormat)
    : looksLikeOpenUI(stripCodeFence(text))
      ? "openui"
      : "markdown";

  if (marker) text = text.slice(marker[0].length);

  if (format === "openui") {
    text = stripCodeFence(text);
    if (!looksLikeOpenUI(text)) format = "markdown";
  }

  return { format, text: text.trim() };
}

export function toMemoryEpisode(record: EpisodeRecord): MemoryEpisode {
  return {
    id: record.id,
    userText: record.userText,
    answerText: record.answerText,
    createdAt: record.createdAt,
    resolvedFrom: record.resolvedFrom,
    resolvedTo: record.resolvedTo,
  };
}

export function toMemoryClaim(record: ClaimRecord): MemoryClaim {
  return {
    id: record.id,
    text: record.text,
    sourceUrl: record.sourceUrl,
    sourceTitle: record.sourceTitle,
    assertedAt: record.assertedAt,
    validFrom: record.validFrom,
    validTo: record.validTo,
    supersedesClaimId: record.supersedesClaimId,
    isLatest: record.isLatest,
  };
}
