import type { PageContent, SearchOptions, SearchProvider, SearchResult } from "./types";
import { isAbortError, SearchError, SearchUnavailableError } from "./common";

/**
 * Wraps the keyless primary (Firecrawl) with named HTML fallbacks in order,
 * currently Brave and then Bing. A fallback is only used when the previous
 * provider returns no results or cannot serve the request. When every provider
 * fails, this throws SearchUnavailableError rather than returning invented
 * results.
 */
export function withKeylessFallback(
  primary: SearchProvider,
  ...fallbacks: SearchProvider[]
): SearchProvider {
  const providers = [primary, ...fallbacks];

  return {
    name: providers.map((provider) => provider.name).join("+"),

    async search(queries: string[], options?: SearchOptions): Promise<SearchResult[]> {
      let lastError: unknown;
      let anySucceeded = false;

      for (const provider of providers) {
        try {
          const results = await provider.search(queries, options);
          anySucceeded = true;
          if (results.length > 0) return results;
        } catch (error) {
          if (isAbortError(error)) throw error;
          lastError = error;
        }
      }

      if (anySucceeded) return [];
      const detail =
        lastError instanceof Error
          ? lastError.message
          : "No keyless search provider is available.";
      throw new SearchUnavailableError(detail);
    },

    async openPage(url: string, options?: SearchOptions): Promise<PageContent> {
      let lastError: unknown;
      for (const provider of providers) {
        if (!provider.openPage) continue;
        try {
          return await provider.openPage(url, options);
        } catch (error) {
          if (isAbortError(error)) throw error;
          lastError = error;
        }
      }
      throw lastError instanceof SearchError
        ? lastError
        : new SearchUnavailableError("No keyless search provider could open that page.");
    },
  };
}
