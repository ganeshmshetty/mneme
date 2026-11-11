import { getKey } from "@/lib/keys";
import type { SearchProvider } from "./types";
import { createFirecrawlProvider } from "./firecrawl";
import { createTavilyProvider } from "./tavily";
import { createBraveProvider } from "./brave";
import { createBingProvider } from "./bing";
import { withKeylessFallback } from "./keyless-fallback";
import { createMockSearchProvider } from "./mock";

export type { SearchProvider, SearchResult, PageContent, SearchOptions } from "./types";

/**
 * Default search is Firecrawl Keyless. A Firecrawl key raises limits; a Tavily
 * key switches providers. When keyless Firecrawl is blocked, Brave's HTML page
 * is tried first and Bing's HTML page is the last resort. A configured key
 * never uses either fallback.
 */
export async function createSearchProvider(): Promise<SearchProvider> {
  const requested = process.env.SEARCH_PROVIDER?.trim().toLowerCase();

  if (requested === "mock") return createMockSearchProvider();

  if (requested === "tavily") {
    const tavilyKey = await getKey("TAVILY_API_KEY");
    if (tavilyKey) return createTavilyProvider(tavilyKey);
  }

  const firecrawlKey = await getKey("FIRECRAWL_API_KEY");
  if (firecrawlKey) return createFirecrawlProvider(firecrawlKey);

  return withKeylessFallback(
    createFirecrawlProvider(),
    createBraveProvider(),
    createBingProvider(),
  );
}

export {
  createFirecrawlProvider,
  createTavilyProvider,
  createBraveProvider,
  createBingProvider,
  createMockSearchProvider,
  withKeylessFallback,
};
