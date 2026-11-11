import type { MemoryClaim, Source } from "./events";
import { canonicalUrl } from "../search/common";

export interface ExtractedClaimCandidate {
  text: string;
  sourceUrl: string;
  sourceTitle?: string;
  sourcePublishedAt?: string;
  validFrom?: string;
  supersedesClaimId?: string;
}

export interface RememberOutcome {
  status: "done" | "error";
  label: string;
  detail: string;
}

/**
 * Zero extracted claims is a successful memory-only turn, not a failed save.
 * Only a real extraction failure is shown as an error.
 */
export function rememberStepOutcome(input: {
  extractionFailed: boolean;
  savedClaimCount: number;
}): RememberOutcome {
  if (input.extractionFailed) {
    // The turn is already saved; a failed extraction is not a save failure.
    return {
      status: "done",
      label: "Saved to memory",
      detail: "No new facts",
    };
  }
  return {
    status: "done",
    label: "Saved to memory",
    detail:
      input.savedClaimCount === 0
        ? "No new facts"
        : `${input.savedClaimCount} ${input.savedClaimCount === 1 ? "fact" : "facts"}`,
  };
}

export interface NormalizedClaim {
  text: string;
  sourceUrl: string;
  sourceTitle?: string;
  sourcePublishedAt?: string;
  assertedAt: string;
  validFrom?: string;
  validTo?: string;
  supersedesClaimId?: string;
  isLatest: boolean;
}

/**
 * Code-level guard for the remember step: a claim exists only when its URL is
 * one of the sources the answer actually used, and a supersession link exists
 * only when it names a claim recall returned.
 */
export function normalizeExtractedClaims(
  extracted: ExtractedClaimCandidate[],
  sources: Source[],
  recalled: MemoryClaim[],
  assertedAt: string,
): NormalizedClaim[] {
  const sourceByCanonical = new Map<string, Source>();
  for (const source of sources) {
    const canonical = canonicalUrl(source.url);
    if (canonical) sourceByCanonical.set(canonical, source);
  }

  const recalledIds = new Set(recalled.map((claim) => claim.id));
  const seen = new Set<string>();
  const claims: NormalizedClaim[] = [];

  for (const candidate of extracted) {
    const canonical = canonicalUrl(candidate.sourceUrl);
    const source = canonical ? sourceByCanonical.get(canonical) : undefined;
    if (!source) continue;

    const text = candidate.text.trim();
    if (!text) continue;
    const dedupeKey = `${text.toLowerCase()}::${canonical}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const sourcePublishedAt = candidate.sourcePublishedAt ?? source.publishedAt;
    claims.push({
      text,
      sourceUrl: source.url,
      sourceTitle: candidate.sourceTitle ?? source.title,
      sourcePublishedAt,
      assertedAt,
      validFrom: candidate.validFrom ?? sourcePublishedAt,
      supersedesClaimId:
        candidate.supersedesClaimId && recalledIds.has(candidate.supersedesClaimId)
          ? candidate.supersedesClaimId
          : undefined,
      isLatest: true,
    });

    if (claims.length >= 6) break;
  }

  return claims;
}
