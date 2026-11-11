"use client";

import { ArrowUpRightIcon } from "lucide-react";
import { BotAvatar } from "@/components/bot-avatar";

const SUGGESTIONS = [
  {
    label: "My open loops",
    prompt:
      "What did I ask you to follow up on last week? List the open loops and say which are still unresolved.",
  },
  {
    label: "What did we decide?",
    prompt: "What did I ask you on 3 November? Is your answer still correct today?",
  },
  {
    label: "Re-check the shortlist",
    prompt:
      "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?",
  },
];

export function EmptyState({
  dark,
  onSuggestion,
}: {
  dark: boolean;
  onSuggestion: (text: string) => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-[calc(34vh+6rem)] z-10 flex justify-center px-4">
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        <div className="relative mb-4 flex size-16 items-center justify-center">
          <div
            aria-hidden="true"
            className="absolute -inset-8 rounded-full bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--foreground)_8%,transparent),transparent_70%)] blur-2xl"
          />
          <BotAvatar
            type="ghost"
            state="default"
            size={64}
            color={dark ? "#d6d6d6" : "#3a3a3a"}
            theme="auto"
            aria-label="Mneme"
            className="relative"
          />
        </div>

        <h1 className="text-[1.7rem] leading-[1.15] font-medium tracking-[-0.04em] text-balance sm:text-[1.9rem]">
          Ask me something.
          <br />
          I&apos;ll remember it.
        </h1>

        <p className="mt-2.5 text-sm leading-6 text-muted-foreground text-balance">
          Web search, with a memory you can question.
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              onClick={() => onSuggestion(suggestion.prompt)}
              aria-label={suggestion.prompt}
              className="group inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 py-1.5 pr-3 pl-3.5 text-[12.5px] font-medium text-foreground/85 outline-none transition-colors hover:border-border hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {suggestion.label}
              <ArrowUpRightIcon
                aria-hidden="true"
                className="size-3 text-muted-foreground/50 transition-colors group-hover:text-foreground/70"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
