export interface SearchResult {
  id?: string;
  url: string;
  title: string;
  domain?: string;
  publishedAt?: string;
  snippet?: string;
}

export interface PageContent {
  url: string;
  title: string;
  text: string;
  publishedAt?: string;
}

export interface SearchOptions {
  limit?: number;
  signal?: AbortSignal;
}

export interface SearchProvider {
  name: string;
  search(queries: string[], options?: SearchOptions): Promise<SearchResult[]>;
  openPage?(url: string, options?: SearchOptions): Promise<PageContent>;
}
