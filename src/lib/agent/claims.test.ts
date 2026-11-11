import { describe, expect, it } from "vitest";
import { normalizeExtractedClaims, rememberStepOutcome } from "./claims";
import type { MemoryClaim, Source } from "./events";

const SOURCES: Source[] = [
  {
    id: "src_1",
    url: "https://example.com/pricing/",
    title: "Pricing",
    publishedAt: "2026-11-10",
  },
];

const RECALLED: MemoryClaim[] = [
  {
    id: "claim_old",
    text: "The Launch plan costs $19/month.",
    sourceUrl: "https://example.com/pricing",
    assertedAt: "2026-11-03T10:00:00.000Z",
    isLatest: false,
  },
];

describe("normalizeExtractedClaims", () => {
  it("keeps a claim whose URL matches a source after canonicalization", () => {
    const claims = normalizeExtractedClaims(
      [
        {
          text: "The Launch plan costs $25/month.",
          sourceUrl: "https://example.com/pricing",
        },
      ],
      SOURCES,
      RECALLED,
      "2026-11-11T00:00:00.000Z",
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      text: "The Launch plan costs $25/month.",
      sourceUrl: "https://example.com/pricing/",
      sourceTitle: "Pricing",
      sourcePublishedAt: "2026-11-10",
      validFrom: "2026-11-10",
      assertedAt: "2026-11-11T00:00:00.000Z",
      isLatest: true,
    });
  });

  it("drops a claim without a matching source URL", () => {
    const claims = normalizeExtractedClaims(
      [
        {
          text: "Unsupported fact.",
          sourceUrl: "https://invented.example/fact",
        },
      ],
      SOURCES,
      RECALLED,
      "2026-11-11T00:00:00.000Z",
    );
    expect(claims).toEqual([]);
  });

  it("keeps a supersession link only when the id was recalled", () => {
    const [linked] = normalizeExtractedClaims(
      [
        {
          text: "The Launch plan now costs $25/month.",
          sourceUrl: "https://example.com/pricing/",
          supersedesClaimId: "claim_old",
        },
      ],
      SOURCES,
      RECALLED,
      "2026-11-11T00:00:00.000Z",
    );
    expect(linked.supersedesClaimId).toBe("claim_old");

    const [unlinked] = normalizeExtractedClaims(
      [
        {
          text: "The Launch plan now costs $25/month.",
          sourceUrl: "https://example.com/pricing/",
          supersedesClaimId: "claim_not_recalled",
        },
      ],
      SOURCES,
      RECALLED,
      "2026-11-11T00:00:00.000Z",
    );
    expect(unlinked.supersedesClaimId).toBeUndefined();
  });

  it("dedupes identical claims and caps the list", () => {
    const claims = normalizeExtractedClaims(
      Array.from({ length: 10 }, (_, index) => ({
        text: index < 2 ? "Same fact." : `Fact ${index}.`,
        sourceUrl: "https://example.com/pricing/",
      })),
      SOURCES,
      RECALLED,
      "2026-11-11T00:00:00.000Z",
    );
    expect(claims).toHaveLength(6);
    expect(claims.filter((claim) => claim.text === "Same fact.")).toHaveLength(1);
  });
});

describe("rememberStepOutcome", () => {
  it("treats a memory-only answer with no claims as a successful save", () => {
    expect(
      rememberStepOutcome({ extractionFailed: false, savedClaimCount: 0 }),
    ).toEqual({
      status: "done",
      label: "Saved to memory",
      detail: "No new facts",
    });
  });

  it("reports saved facts from a sourced answer as success", () => {
    expect(
      rememberStepOutcome({ extractionFailed: false, savedClaimCount: 1 }),
    ).toEqual({ status: "done", label: "Saved to memory", detail: "1 fact" });
    expect(
      rememberStepOutcome({ extractionFailed: false, savedClaimCount: 2 }),
    ).toMatchObject({ status: "done", detail: "2 facts" });
  });

  it("does not show a save error when only extraction failed", () => {
    expect(
      rememberStepOutcome({ extractionFailed: true, savedClaimCount: 0 }),
    ).toEqual({
      status: "done",
      label: "Saved to memory",
      detail: "No new facts",
    });
  });
});
