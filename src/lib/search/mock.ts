import type { SearchOptions, SearchProvider, SearchResult } from "./types";
import { clampLimit, mergeResultGroups } from "./common";

/**
 * Local-only provider for development and tests. It is selected explicitly with
 * SEARCH_PROVIDER=mock and never pretends to be live search.
 */
export function createMockSearchProvider(): SearchProvider {
  return {
    name: "mock",

    async search(queries: string[], options?: SearchOptions): Promise<SearchResult[]> {
      const limit = clampLimit(options?.limit);
      const groups = queries
        .map((query) => query.trim())
        .filter(Boolean)
        .slice(0, 4)
        .map<SearchResult[]>((query, index) => [
          {
            url: `https://example.com/mock/${index + 1}?q=${encodeURIComponent(query)}`,
            title: `Mock result for "${query}"`,
            domain: "example.com",
            publishedAt: new Date().toISOString().slice(0, 10),
            snippet:
              "Local mock search result. Set SEARCH_PROVIDER=firecrawl or tavily for live web results.",
          },
        ]);
      return mergeResultGroups(groups, limit);
    },

    async openPage(url: string): Promise<{ url: string; title: string; text: string }> {
      return {
        url,
        title: "Mock page",
        text: "This is a local mock page. No live web content was fetched.",
      };
    },
  };
}
