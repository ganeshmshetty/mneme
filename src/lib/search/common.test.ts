import { describe, expect, it } from "vitest";
import {
  canonicalUrl,
  dedupeResults,
  mergeResultGroups,
  parsePublishedAt,
} from "./common";

describe("canonicalUrl", () => {
  it("normalizes the host, fragment, and trailing slash", () => {
    expect(canonicalUrl("HTTPS://WWW.Example.com/Pricing/#plans")).toBe(
      "https://www.example.com/Pricing",
    );
  });

  it("rejects non-http URLs", () => {
    expect(canonicalUrl("mailto:hello@example.com")).toBeNull();
    expect(canonicalUrl("not a url")).toBeNull();
  });
});

describe("dedupeResults", () => {
  it("dedupes by canonical URL and keeps the first title", () => {
    const results = dedupeResults([
      { url: "https://example.com/a/", title: "First" },
      { url: "https://example.com/a#section", title: "Second" },
      { url: "https://example.com/b", title: "Other" },
    ]);
    expect(results.map((result) => result.title)).toEqual(["First", "Other"]);
  });

  it("caps the number of results", () => {
    const results = dedupeResults(
      Array.from({ length: 10 }, (_, index) => ({
        url: `https://example.com/${index}`,
        title: `Result ${index}`,
      })),
      3,
    );
    expect(results).toHaveLength(3);
  });

  it("puts dated results first and keeps provider order for ties", () => {
    const results = dedupeResults([
      { url: "https://example.com/a", title: "A" },
      { url: "https://example.com/b", title: "B", publishedAt: "2026-11-01" },
      { url: "https://example.com/c", title: "C", publishedAt: "2026-11-10" },
    ]);
    expect(results.map((result) => result.title)).toEqual(["C", "B", "A"]);
  });

  it("cleans snippets and fills in the domain", () => {
    const [result] = dedupeResults([
      {
        url: "https://www.example.com/a",
        title: "A",
        snippet: "<p>Hello&nbsp;<b>world</b></p>",
      },
    ]);
    expect(result.domain).toBe("example.com");
    expect(result.snippet).toBe("Hello world");
  });
});

describe("mergeResultGroups", () => {
  it("interleaves queries before capping", () => {
    const merged = mergeResultGroups(
      [
        [
          { url: "https://example.com/a1", title: "A1" },
          { url: "https://example.com/a2", title: "A2" },
        ],
        [{ url: "https://example.com/b1", title: "B1" }],
      ],
      3,
    );
    expect(merged.map((result) => result.title)).toEqual(["A1", "B1", "A2"]);
  });
});

describe("parsePublishedAt", () => {
  it("keeps a date-only value", () => {
    expect(parsePublishedAt("2026-11-10")).toBe("2026-11-10");
  });

  it("turns a timestamp into a UTC date", () => {
    expect(parsePublishedAt("2026-11-10T23:30:00+05:30")).toBe("2026-11-10");
  });

  it("drops relative dates instead of guessing", () => {
    expect(parsePublishedAt("3 months ago")).toBeUndefined();
    expect(parsePublishedAt("yesterday")).toBeUndefined();
  });

  it("ignores empty and non-string values", () => {
    expect(parsePublishedAt("")).toBeUndefined();
    expect(parsePublishedAt(null)).toBeUndefined();
    expect(parsePublishedAt(42)).toBeUndefined();
  });
});
