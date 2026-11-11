import type { SearchResult } from "./types";

export const DEFAULT_RESULT_LIMIT = 6;
export const MAX_RESULT_LIMIT = 10;
export const SEARCH_TIMEOUT_MS = 20_000;
export const PAGE_TIMEOUT_MS = 15_000;
export const MAX_PAGE_CHARS = 8_000;

export class SearchError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, options: { retryable?: boolean; status?: number } = {}) {
    super(message);
    this.name = "SearchError";
    this.retryable = options.retryable ?? true;
    this.status = options.status;
  }
}

/**
 * Firecrawl Keyless is real, but it refuses requests from VPN and datacenter
 * IPs. This error tells the provider registry to use the named keyless
 * fallback instead of failing the turn.
 */
export class SearchUnavailableError extends SearchError {
  constructor(message: string, status?: number) {
    super(message, { retryable: true, status });
    this.name = "SearchUnavailableError";
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function abortError(): Error {
  const error = new Error("The search was aborted.");
  error.name = "AbortError";
  return error;
}

export function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_RESULT_LIMIT;
  return Math.min(MAX_RESULT_LIMIT, Math.max(1, Math.round(limit as number)));
}

export function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function domainOf(raw: string): string | undefined {
  try {
    return new URL(raw).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

export function stripHtml(text: string): string {
  return decodeEntities(
    text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

/**
 * Search results often carry relative dates ("3 months ago"). Those are not
 * publication dates, so they are dropped instead of being guessed.
 */
export function parsePublishedAt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
  }
  if (/^\d{10,13}$/.test(trimmed)) {
    const numeric = Number(trimmed);
    const milliseconds = trimmed.length === 10 ? numeric * 1000 : numeric;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
  }
  if (/\b(ago|yesterday|today|tomorrow)\b/i.test(trimmed)) return undefined;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

export function cleanText(text: string | undefined | null, max = 700): string | undefined {
  if (!text) return undefined;
  const cleaned = stripHtml(text);
  if (!cleaned) return undefined;
  return cleaned.length > max ? `${cleaned.slice(0, max).trimEnd()}…` : cleaned;
}

function normalizeResult(result: SearchResult): SearchResult | null {
  const canonical = canonicalUrl(result.url);
  if (!canonical) return null;
  const domain = result.domain ?? domainOf(canonical);
  const title = cleanText(result.title, 300) ?? domain ?? canonical;
  return {
    ...result,
    url: result.url.trim(),
    title,
    domain,
    snippet: cleanText(result.snippet, 700),
    publishedAt: parsePublishedAt(result.publishedAt),
  };
}

/**
 * Caps and dedupes by canonical URL, then puts dated results first so fresher
 * sources lead the prompt. The sort is stable, so provider rank survives ties.
 */
export function dedupeResults(results: SearchResult[], limit?: number): SearchResult[] {
  const cap = clampLimit(limit);
  const seen = new Set<string>();
  const unique: SearchResult[] = [];
  for (const result of results) {
    const normalized = normalizeResult(result);
    if (!normalized) continue;
    const canonical = canonicalUrl(normalized.url);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    unique.push(normalized);
  }
  unique.sort((left, right) => {
    if (left.publishedAt && right.publishedAt) {
      return right.publishedAt.localeCompare(left.publishedAt);
    }
    if (left.publishedAt) return -1;
    if (right.publishedAt) return 1;
    return 0;
  });
  return unique.slice(0, cap);
}

/** Merges one ranked list per query without letting the first query fill the cap. */
export function mergeResultGroups(groups: SearchResult[][], limit?: number): SearchResult[] {
  const cap = clampLimit(limit);
  const merged: SearchResult[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longest && merged.length < cap * 2; index += 1) {
    for (const group of groups) {
      const result = group[index];
      if (result) merged.push(result);
    }
  }
  return dedupeResults(merged, cap);
}

interface TextResponse {
  ok: boolean;
  status: number;
  text: string;
}

export async function fetchText(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs = SEARCH_TIMEOUT_MS,
): Promise<TextResponse> {
  if (signal?.aborted) throw abortError();

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (isAbortError(error)) {
      if (timedOut) throw new SearchError("The search timed out.", { retryable: true });
      throw abortError();
    }
    throw new SearchError("Could not reach the search provider.", { retryable: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs = SEARCH_TIMEOUT_MS,
): Promise<unknown> {
  const response = await fetchText(url, init, signal, timeoutMs);
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new SearchError(`Search provider returned ${response.status}.`, {
      retryable,
      status: response.status,
    });
  }
  try {
    return JSON.parse(response.text) as unknown;
  } catch {
    throw new SearchError("Search provider returned invalid JSON.", { retryable: true });
  }
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanText(match[1], 300) : undefined;
}

function extractPublishedAt(html: string): string | undefined {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["'](?:date|pubdate|publishdate)["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const parsed = match ? parsePublishedAt(match[1]) : undefined;
    if (parsed) return parsed;
  }
  return undefined;
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<(?:br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** A plain HTTP reader used only when a provider has no scrape API key. */
export async function fetchReadablePage(
  url: string,
  signal: AbortSignal | undefined,
): Promise<{ url: string; title: string; text: string; publishedAt?: string }> {
  const response = await fetchText(
    url,
    {
      method: "GET",
      headers: { "user-agent": "mneme-chat-agent/1.0" },
    },
    signal,
    PAGE_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new SearchError(`Could not open ${url} (${response.status}).`, {
      retryable: response.status >= 500 || response.status === 429,
      status: response.status,
    });
  }
  const title = extractTitle(response.text) ?? domainOf(url) ?? url;
  const text = htmlToText(response.text).slice(0, MAX_PAGE_CHARS);
  return {
    url,
    title,
    text,
    publishedAt: extractPublishedAt(response.text),
  };
}
