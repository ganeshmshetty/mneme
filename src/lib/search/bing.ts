import type { PageContent, SearchOptions, SearchProvider, SearchResult } from "./types";
import {
  clampLimit,
  dedupeResults,
  fetchReadablePage,
  fetchText,
  isAbortError,
  mergeResultGroups,
  SearchUnavailableError,
  stripHtml,
} from "./common";

/**
 * Unofficial last-resort search. Bing's HTML page is not a supported API and
 * can change or challenge automated requests without warning, so this is used
 * only after Firecrawl Keyless fails and no search key is configured. If it
 * fails too, the caller throws SearchUnavailableError; it never invents results.
 */
const BING_URL = "https://www.bing.com/search";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function unwrapBingUrl(raw: string): string {
  const decoded = stripHtml(raw);
  try {
    const url = new URL(decoded);
    if (!/(^|\.)bing\.com$/i.test(url.hostname) || !url.pathname.startsWith("/ck/a")) {
      return decoded;
    }
    const value = url.searchParams.get("u");
    if (!value?.startsWith("a1")) return decoded;
    const encoded = value.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), "=");
    const target = Buffer.from(padded, "base64").toString("utf8");
    return target.startsWith("http") ? target : decoded;
  } catch {
    return decoded;
  }
}

export function parseBingResults(html: string, limit?: number): SearchResult[] {
  const starts: number[] = [];
  const pattern = /<li[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>/gi;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    starts.push(match.index);
  }

  const results: SearchResult[] = [];
  for (const [index, start] of starts.entries()) {
    const next = starts[index + 1] ?? Math.min(html.length, start + 20_000);
    const block = html.slice(start, next);

    const link =
      block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) ??
      block.match(/<a[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;

    const url = unwrapBingUrl(link[1]);
    const title = stripHtml(link[2]);
    if (!title) continue;

    const snippet =
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ??
      block.match(/class=["'][^"']*b_caption[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];

    results.push({
      url,
      title,
      snippet: snippet ? stripHtml(snippet) : undefined,
    });
  }

  return dedupeResults(results, limit);
}

async function searchOne(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, count: String(limit), setlang: "en" });
  const response = await fetchText(
    `${BING_URL}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "user-agent": BROWSER_USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.8",
      },
    },
    signal,
  );

  if (!response.ok) {
    throw new SearchUnavailableError(
      `Bing returned ${response.status}; no keyless search provider is available.`,
      response.status,
    );
  }

  const results = parseBingResults(response.text, limit);
  if (
    results.length === 0 &&
    /captcha|verify you are human|unusual traffic|access denied/i.test(response.text)
  ) {
    throw new SearchUnavailableError(
      "Bing challenged the request; no keyless search provider is available.",
    );
  }
  return results;
}

export function createBingProvider(): SearchProvider {
  return {
    name: "bing-keyless-fallback",

    async search(queries: string[], options?: SearchOptions): Promise<SearchResult[]> {
      const trimmed = queries.map((query) => query.trim()).filter(Boolean).slice(0, 4);
      if (trimmed.length === 0) return [];
      const limit = clampLimit(options?.limit);

      try {
        const settled = await Promise.allSettled(
          trimmed.map((query) => searchOne(query, limit, options?.signal)),
        );
        const groups: SearchResult[][] = [];
        let firstError: unknown;
        for (const result of settled) {
          if (result.status === "fulfilled") {
            groups.push(result.value);
          } else if (firstError === undefined) {
            firstError = result.reason;
          }
        }
        if (options?.signal?.aborted) throw firstError ?? new Error("The search was aborted.");
        if (groups.length === 0) throw firstError ?? new SearchUnavailableError("Bing search failed.");
        return mergeResultGroups(groups, limit);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof SearchUnavailableError) throw error;
        throw new SearchUnavailableError(
          "Bing search failed; no keyless search provider is available.",
        );
      }
    },

    async openPage(url: string, options?: SearchOptions): Promise<PageContent> {
      const page = await fetchReadablePage(url, options?.signal);
      return {
        url: page.url,
        title: page.title,
        text: page.text,
        publishedAt: page.publishedAt,
      };
    },
  };
}
