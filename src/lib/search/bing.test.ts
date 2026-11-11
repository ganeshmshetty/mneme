import { describe, expect, it } from "vitest";
import { parseBingResults } from "./bing";

const HTML = `
<ol id="b_results">
  <li class="b_algo">
    <h2><a href="https://example.com/first">First &amp; best result</a></h2>
    <div class="b_caption"><p>First <strong>snippet</strong>.</p></div>
  </li>
  <li class="b_algo" data-id="second">
    <h2><a href="https://example.com/second">Second result</a></h2>
    <p>Second snippet.</p>
  </li>
  <li class="b_ans">Not a web result</li>
</ol>`;

describe("parseBingResults", () => {
  it("parses b_algo blocks, titles, URLs, and snippets", () => {
    const results = parseBingResults(HTML);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      url: "https://example.com/first",
      title: "First & best result",
      snippet: "First snippet.",
      domain: "example.com",
    });
    expect(results[1]).toMatchObject({
      url: "https://example.com/second",
      title: "Second result",
      snippet: "Second snippet.",
    });
  });

  it("caps the parsed results", () => {
    expect(parseBingResults(HTML, 1)).toHaveLength(1);
  });

  it("returns nothing for a challenge page", () => {
    expect(parseBingResults("<html><body>Verify you are human</body></html>")).toEqual([]);
  });
});
