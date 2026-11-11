import type { MemoryClaim, MemoryEpisode, Source } from "../events";
import type { PageContent } from "../../search/types";
import type { ResolvedTimeRange } from "../steps/resolve-time";

export function clip(text: string | undefined, max: number): string {
  if (!text) return "";
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

export function sanitizeTagText(text: string): string {
  return text.replace(
    /<\s*\/?\s*(sources|memory|working_memory|conversation|standalone_question|answer|earlier_claims|current_message|question)\b/gi,
    "‹$1",
  );
}

export function formatDayLabel(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}

export function formatNowLabel(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
  } catch {
    return now.toISOString();
  }
}

export function formatRangeContext(range: ResolvedTimeRange | undefined): string {
  if (!range) return "Resolved time: none. Recall searched all of memory.";
  return [
    `Resolved time: ${range.label} (${range.timezone}).`,
    `UTC range: ${range.from} to ${range.to}${range.ambiguous ? " (the year was assumed from today)" : ""}.`,
  ].join(" ");
}

export function formatWorkingMemory(
  episodes: MemoryEpisode[],
  timeZone: string,
): string {
  if (episodes.length === 0) return "";

  const lines: string[] = [
    "<working_memory>",
    "The last few turns of this chat, oldest first. The last entry is the most recent. These turns are newer than any recalled memory below. For questions about \"last time\", \"most recent\", \"just now\", \"it\", or \"that\", use these turns first.",
  ];
  for (const episode of episodes.slice(-5)) {
    lines.push(
      `- ${formatDayLabel(episode.createdAt, timeZone)} User: "${clip(
        sanitizeTagText(episode.userText),
        600,
      )}"`,
    );
    lines.push(
      `  Assistant: "${clip(sanitizeTagText(episode.answerText), 900)}"`,
    );
  }
  lines.push("</working_memory>");
  return lines.join("\n");
}

export function formatMemory(
  episodes: MemoryEpisode[],
  claims: MemoryClaim[],
  timeZone: string,
): string {
  const lines: string[] = ["<memory>"];

  if (episodes.length === 0) {
    lines.push("Earlier episodes from memory: none matched.");
  } else {
    lines.push("Earlier episodes from memory (possibly other chats):");
    for (const episode of episodes.slice(0, 6)) {
      lines.push(
        `- ${formatDayLabel(episode.createdAt, timeZone)}: the user asked "${clip(
          sanitizeTagText(episode.userText),
          320,
        )}" and the assistant answered "${clip(sanitizeTagText(episode.answerText), 420)}"`,
      );
    }
  }

  if (claims.length === 0) {
    lines.push("Earlier claims from memory: none matched.");
  } else {
    lines.push("Earlier claims from memory (possibly other chats):");
    for (const claim of claims.slice(0, 8)) {
      const validity = [
        claim.assertedAt ? `asserted ${formatDayLabel(claim.assertedAt, timeZone)}` : "",
        claim.validFrom ? `valid from ${claim.validFrom}` : "",
        claim.validTo ? `valid to ${claim.validTo}` : "",
        claim.isLatest ? "latest" : "superseded",
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(
        `- [${claim.id}] (${validity}) ${clip(sanitizeTagText(claim.text), 400)} Source: ${claim.sourceUrl}`,
      );
    }
  }

  lines.push("</memory>");
  return lines.join("\n");
}

export function formatSourcesBlock(
  sources: Source[],
  pages: PageContent[],
): string {
  if (sources.length === 0) {
    return "<sources>\nNo web sources were returned.\n</sources>";
  }

  const pageByUrl = new Map(pages.map((page) => [page.url, page]));
  const lines: string[] = ["<sources>"];
  let remaining = 9_000;

  for (const [index, source] of sources.entries()) {
    if (remaining <= 0) break;
    const header = [
      `[${index + 1}] ${clip(sanitizeTagText(source.title), 220)}`,
      source.url,
      source.publishedAt ? `published ${source.publishedAt}` : "publish date unknown",
    ].join(" — ");
    lines.push(header);

    if (source.snippet) {
      const snippet = clip(sanitizeTagText(source.snippet), 700);
      lines.push(`Snippet: ${snippet}`);
      remaining -= snippet.length;
    }

    const page = pageByUrl.get(source.url);
    if (page?.text) {
      const text = clip(sanitizeTagText(page.text), Math.min(4_500, Math.max(0, remaining)));
      if (text) {
        lines.push(`Page excerpt: ${text}`);
        remaining -= text.length;
      }
    }
    lines.push("");
  }

  lines.push("</sources>");
  return lines.join("\n");
}

export function formatSourceList(sources: Source[]): string {
  if (sources.length === 0) return "No sources.";
  return sources
    .map(
      (source, index) =>
        `[${index + 1}] ${clip(sanitizeTagText(source.title), 220)} — ${source.url}${
          source.publishedAt ? ` (published ${source.publishedAt})` : ""
        }`,
    )
    .join("\n");
}
