import { ArrowUpRightIcon, ChevronDownIcon } from "lucide-react";
import type { Source } from "@/lib/agent/events";

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function shortDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(date);
}

export function SourceList({ sources }: { sources: Source[] | undefined }) {
  if (!sources || sources.length === 0) return null;

  return (
    <details className="group border-t border-border/70 pt-2.5">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        Sources
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
          {sources.length}
        </span>
        <ChevronDownIcon className="size-3 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-2 space-y-1.5">
        {sources.map((source) => (
          <li key={source.id}>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="group flex min-w-0 items-baseline gap-2 text-sm text-foreground/80 underline-offset-4 hover:text-foreground hover:underline"
            >
              <span className="truncate">{source.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{hostname(source.url)}</span>
              {shortDate(source.publishedAt) ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  · {shortDate(source.publishedAt)}
                </span>
              ) : null}
              <ArrowUpRightIcon className="size-3 shrink-0 opacity-30 transition-opacity group-hover:opacity-100" />
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
