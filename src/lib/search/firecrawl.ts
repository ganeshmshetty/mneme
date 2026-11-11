import { z } from "zod";
import type { PageContent, SearchOptions, SearchProvider, SearchResult } from "./types";
import {
  clampLimit,
  cleanText,
  fetchJson,
  fetchReadablePage,
  isAbortError,
  mergeResultGroups,
  parsePublishedAt,
  SearchError,
  SearchUnavailableError,
} from "./common";

/**
 * Firecrawl Keyless is the default. The /v2/search endpoint accepts requests
 * with no Authorization header; a key only raises rate limits. Firecrawl
 * rejects keyless calls from VPN and datacenter IPs, so the registry wraps this
 * provider in the named keyless fallback when no key is configured.
 *
 * Docs: https://docs.firecrawl.dev/features/search
 */
const SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";

const itemSchema = z.object({
  url: z.string(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  snippet: z.string().nullish(),
  date: z.string().nullish(),
  publishedAt: z.string().nullish(),
  metadata: z
    .object({
      title: z.string().nullish(),
      publishedTime: z.string().nullish(),
      published_at: z.string().nullish(),
      sourceURL: z.string().nullish(),
    })
    .nullish(),
});

const searchResponseSchema = z.object({
  success: z.boolean().optional(),
  error: z.string().nullish(),
  data: z
    .union([
      z.array(itemSchema),
      z.object({
        web: z.array(itemSchema).nullish(),
        news: z.array(itemSchema).nullish(),
      }),
    ])
    .nullish(),
});

const scrapeResponseSchema = z.object({
  success: z.boolean().optional(),
  error: z.string().nullish(),
  data: z
    .object({
      markdown: z.string().nullish(),
      text: z.string().nullish(),
      metadata: z
        .object({
          title: z.string().nullish(),
          publishedTime: z.string().nullish(),
          published_at: z.string().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

type FirecrawlItem = z.infer<typeof itemSchema>;

function itemToResult(item: FirecrawlItem): SearchResult {
  return {
    url: item.url,
    title: item.title ?? item.metadata?.title ?? item.url,
    snippet: item.snippet ?? item.description ?? undefined,
    publishedAt:
      item.publishedAt ??
      item.date ??
      item.metadata?.publishedTime ??
      item.metadata?.published_at ??
      undefined,
  };
}

function itemsFromResponse(data: z.infer<typeof searchResponseSchema>["data"]): FirecrawlItem[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return [...(data.web ?? []), ...(data.news ?? [])];
}

export function createFirecrawlProvider(apiKey?: string): SearchProvider {
  const key = apiKey?.trim() || undefined;

  async function searchOne(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
    let json: unknown;
    try {
      json = await fetchJson(
        SEARCH_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify({
            query,
            limit,
            sources: ["web", "news"],
          }),
        },
        signal,
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (!key && error instanceof SearchError) {
        throw new SearchUnavailableError(error.message, error.status);
      }
      throw error;
    }

    const parsed = searchResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new SearchError("Firecrawl returned an unexpected response.", { retryable: true });
    }
    if (parsed.data.success === false) {
      const message = cleanText(parsed.data.error, 300) ?? "Firecrawl search failed.";
      if (!key) throw new SearchUnavailableError(message);
      throw new SearchError(message, { retryable: false });
    }
    return itemsFromResponse(parsed.data.data).map(itemToResult);
  }

  return {
    name: key ? "firecrawl" : "firecrawl-keyless",

    async search(queries: string[], options?: SearchOptions): Promise<SearchResult[]> {
      const trimmed = queries.map((query) => query.trim()).filter(Boolean).slice(0, 4);
      if (trimmed.length === 0) return [];
      const limit = clampLimit(options?.limit);

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
      if (groups.length === 0) throw firstError ?? new SearchError("Firecrawl search failed.");
      return mergeResultGroups(groups, limit);
    },

    async openPage(url: string, options?: SearchOptions): Promise<PageContent> {
      if (key) {
        try {
          const json = await fetchJson(
            SCRAPE_URL,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${key}`,
              },
              body: JSON.stringify({
                url,
                formats: ["markdown"],
                onlyMainContent: true,
                timeout: 15000,
              }),
            },
            options?.signal,
          );
          const parsed = scrapeResponseSchema.safeParse(json);
          if (parsed.success && parsed.data.success !== false) {
            const data = parsed.data.data;
            const text = cleanText(data?.markdown ?? data?.text, 8000);
            if (text) {
              return {
                url,
                title:
                  cleanText(data?.metadata?.title, 300) ??
                  new URL(url).hostname.replace(/^www\./, ""),
                text,
                publishedAt: parsePublishedAt(
                  data?.metadata?.publishedTime ?? data?.metadata?.published_at,
                ),
              };
            }
          }
        } catch (error) {
          if (isAbortError(error)) throw error;
          // Fall through to the plain reader; one failed scrape should not
          // discard an otherwise useful search result.
        }
      }

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
