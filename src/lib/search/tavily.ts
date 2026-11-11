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
} from "./common";

const SEARCH_URL = "https://api.tavily.com/search";
const EXTRACT_URL = "https://api.tavily.com/extract";

const resultSchema = z.object({
  title: z.string().nullish(),
  url: z.string(),
  content: z.string().nullish(),
  raw_content: z.string().nullish(),
  published_date: z.string().nullish(),
});

const searchResponseSchema = z.object({
  results: z.array(resultSchema).default([]),
  error: z.string().nullish(),
});

const extractResponseSchema = z.object({
  results: z
    .array(
      z.object({
        url: z.string(),
        raw_content: z.string().nullish(),
      }),
    )
    .default([]),
  failed_results: z.array(z.object({ url: z.string(), error: z.string().nullish() })).default([]),
  error: z.string().nullish(),
});

export function createTavilyProvider(apiKey: string): SearchProvider {
  const key = apiKey.trim();

  async function searchOne(
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const json = await fetchJson(
      SEARCH_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          api_key: key,
          query,
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
          max_results: limit,
        }),
      },
      signal,
    );

    const parsed = searchResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new SearchError("Tavily returned an unexpected response.", { retryable: true });
    }
    if (parsed.data.error && parsed.data.results.length === 0) {
      throw new SearchError(cleanText(parsed.data.error, 300) ?? "Tavily search failed.", {
        retryable: false,
      });
    }

    return parsed.data.results.map((result) => ({
      url: result.url,
      title: result.title ?? result.url,
      snippet: result.content ?? result.raw_content ?? undefined,
      publishedAt: parsePublishedAt(result.published_date),
    }));
  }

  return {
    name: "tavily",

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
      if (groups.length === 0) throw firstError ?? new SearchError("Tavily search failed.");
      return mergeResultGroups(groups, limit);
    },

    async openPage(url: string, options?: SearchOptions): Promise<PageContent> {
      try {
        const json = await fetchJson(
          EXTRACT_URL,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({ api_key: key, urls: [url], extract_depth: "basic" }),
          },
          options?.signal,
        );
        const parsed = extractResponseSchema.safeParse(json);
        const extracted = parsed.success ? parsed.data.results[0] : undefined;
        const text = cleanText(extracted?.raw_content, 8000);
        if (text) {
          return {
            url,
            title: new URL(url).hostname.replace(/^www\./, ""),
            text,
          };
        }
      } catch (error) {
        if (isAbortError(error)) throw error;
        // Fall through to the plain reader if extraction fails.
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
