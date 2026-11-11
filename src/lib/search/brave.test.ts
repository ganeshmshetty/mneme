import { describe, expect, it } from "vitest";
import { parseBraveResults } from "./brave";

const HTML = `
<main>
  <div class="snippet " data-type="web" data-pos="1">
    <a href="https://neon.com/pricing" class="result-link">Neon</a>
    <div class="title search-snippet-title ">Neon pricing &amp; plans</div>
    <div class="content ">Compare the <strong>Launch</strong> plan and usage pricing.</div>
    <cite class="snippet-url ">neon.com › pricing</cite>
  </div>
  <div class="snippet" data-type="web" data-pos="2">
    <a href="https://neon.com/docs/introduction/plans">Neon docs</a>
    <div class="title search-snippet-title">Neon plans</div>
    <div class="content">Plans, limits and usage.</div>
  </div>
  <div class="snippet" data-type="news" data-pos="3">
    <a href="https://example.com/news">Ignored news result</a>
    <div class="title search-snippet-title">Ignored</div>
    <div class="content">Not a web result.</div>
  </div>
  <div class="snippet" data-type="web" data-pos="4">
    <a href="https://neon.com/pricing/#launch">Duplicate</a>
    <div class="title search-snippet-title">Duplicate pricing</div>
    <div class="content">Same canonical URL.</div>
  </div>
</main>`;

describe("parseBraveResults", () => {
  it("parses web snippet containers, titles, URLs, and descriptions", () => {
    const results = parseBraveResults(HTML);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      url: "https://neon.com/pricing",
      title: "Neon pricing & plans",
      snippet: "Compare the Launch plan and usage pricing.",
      domain: "neon.com",
    });
    expect(results[1]).toMatchObject({
      url: "https://neon.com/docs/introduction/plans",
      title: "Neon plans",
      snippet: "Plans, limits and usage.",
    });
  });

  it("ignores non-web data types and dedupes canonical URLs", () => {
    const results = parseBraveResults(HTML);
    expect(results.some((result) => result.title === "Ignored")).toBe(false);
    expect(results.filter((result) => result.title.includes("pricing"))).toHaveLength(1);
  });

  it("caps the parsed results", () => {
    expect(parseBraveResults(HTML, 1)).toHaveLength(1);
  });

  it("returns nothing for a challenge page", () => {
    expect(parseBraveResults("<html><body>Verify you are human</body></html>")).toEqual([]);
  });
});
