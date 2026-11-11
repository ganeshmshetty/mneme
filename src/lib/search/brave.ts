import type { PageContent, SearchOptions, SearchProvider, SearchResult } from "./types";
import {
  abortError,
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
 * Brave's HTML page is an unofficial, last-resort search surface: it is not a
 * supported API and can change, challenge, or rate-limit automated requests.
 * It is used only after Firecrawl Keyless fails and no search key is configured,
 * and only real parsed results are returned. A Firecrawl or Tavily key is
 * recommended for reliable live search. No snippets are invented.
 */
const BRAVE_URL = "https://search.brave.com/search";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function resolveUrl(raw: string): string {
  try {
    return new URL(stripHtml(raw), "https://search.brave.com").toString();
  } catch {
    return stripHtml(raw);
  }
}

export function parseBraveResults(html: string, limit?: number): SearchResult[] {
  const starts: Array<{ index: number; tag: string }> = [];
  const pattern =
    /<div[^>]*class=["'](?:[^"']*\s)?snippet(?:\s[^"']*)?["'][^>]*>/gi;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    // Only result containers carry data-type="web"; title divs also contain
    // "snippet" in their class and must not truncate the previous block.
    if (/data-type=["']web["']/i.test(match[0])) {
      starts.push({ index: match.index, tag: match[0] });
    }
  }

  const results: SearchResult[] = [];
  for (const [position, start] of starts.entries()) {
    const next = starts[position + 1]?.index ?? Math.min(html.length, start.index + 20_000);
    const block = html.slice(start.index, next);

    const link = block.match(/<a[^>]*href=["']([^"']+)["'][^>]*>/i);
    if (!link) continue;
    const url = resolveUrl(link[1]);
    if (!/^https?:\/\//i.test(url)) continue;

    const titleHtml =
      block.match(
        /<div[^>]*class=["'](?:[^"']*\s)?search-snippet-title(?:\s[^"']*)?["'][^>]*>([\s\S]*?)<\/div>/i,
      )?.[1] ??
      block.match(
        /<div[^>]*class=["'](?:[^"']*\s)?title(?:\s[^"']*)?["'][^>]*>([\s\S]*?)<\/div>/i,
      )?.[1];
    const title = titleHtml
      ? stripHtml(titleHtml)
      : stripHtml(block.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");

    const snippet = block.match(
      /<div[^>]*class=["'](?:[^"']*\s)?content(?:\s[^"']*)?["'][^>]*>([\s\S]*?)<\/div>/i,
    )?.[1];

    if (!title) continue;
    results.push({
      url,
      title,
      snippet: snippet ? stripHtml(snippet) : undefined,
    });
  }

  return dedupeResults(results, limit);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function searchOne(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, source: "web" });
  const request = () =>
    fetchText(
      `${BRAVE_URL}?${params.toString()}`,
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

  let response = await request();
  if (response.status === 429) {
    // A short backoff sometimes clears Brave's HTML rate limit.
    await sleep(800, signal);
    response = await request();
  }

  if (!response.ok) {
    throw new SearchUnavailableError(
      `Brave returned ${response.status}; no keyless search provider is available.`,
      response.status,
    );
  }

  const results = parseBraveResults(response.text, limit);
  if (
    results.length === 0 &&
    /captcha|verify you are human|unusual traffic|access denied/i.test(response.text)
  ) {
    throw new SearchUnavailableError(
      "Brave challenged the request; no keyless search provider is available.",
    );
  }
  return results;
}

export function createBraveProvider(): SearchProvider {
  return {
    name: "brave-keyless-fallback",

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
        if (groups.length === 0) {
          throw firstError ?? new SearchUnavailableError("Brave search failed.");
        }
        return mergeResultGroups(groups, limit);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof SearchUnavailableError) throw error;
        throw new SearchUnavailableError(
          "Brave search failed; no keyless search provider is available.",
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
