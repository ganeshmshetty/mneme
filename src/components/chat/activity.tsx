"use client";

import { useEffect, useState } from "react";
import {
  BookmarkIcon,
  BrainIcon,
  CheckIcon,
  CircleAlertIcon,
  DatabaseIcon,
  SearchIcon,
} from "lucide-react";
import { Orb } from "@/components/orb";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { ActivityStep } from "@/lib/chat/types";

function StepIcon({ step }: { step: ActivityStep }) {
  if (step.status === "start") return <Orb step={step.step} size={20} />;
  if (step.status === "error") {
    return <CircleAlertIcon className="size-3.5 text-destructive" />;
  }
  const className = "size-3.5 text-muted-foreground";

  switch (step.step) {
    case "plan":
      return <BrainIcon className={className} />;
    case "recall":
      return <DatabaseIcon className={className} />;
    case "search":
      return <SearchIcon className={className} />;
    case "remember":
      return <BookmarkIcon className={className} />;
    default:
      return <CheckIcon className={className} />;
  }
}

export function Activity({
  steps,
  streaming,
  dryRun = false,
}: {
  steps: ActivityStep[] | undefined;
  streaming: boolean;
  dryRun?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const list = steps ?? [];
  const active = [...list].reverse().find((step) => step.status === "start");

  useEffect(() => {
    if (!streaming) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [streaming, active?.step]);

  if (list.length === 0) return null;

  const activeSeconds = active
    ? Math.max(0, Math.floor((now - Date.parse(active.at)) / 1_000))
    : 0;

  const summary = dryRun
    ? streaming
      ? "Dry run"
      : "Prerecorded dry run"
    : streaming
      ? active?.label ?? "Writing"
      : `Worked through ${list.length} ${list.length === 1 ? "step" : "steps"}`;

  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={streaming ? "running" : undefined}>
            {streaming ? (
              <TraceIcon className="size-5">
                {!open && active ? (
                  <Orb step={active.step} size={20} />
                ) : (
                  <span className="size-1.5 rounded-full bg-muted-foreground/60" />
                )}
              </TraceIcon>
            ) : null}
            <TraceTitle>{summary}</TraceTitle>
            {streaming ? (
              <TraceDescription>
                {activeSeconds > 0 ? `${activeSeconds}s` : "now"}
              </TraceDescription>
            ) : null}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex flex-col gap-1.5">
            {list.map((step) => (
              <TraceLine
                key={step.step}
                status={step.status === "start" ? "running" : step.status === "error" ? "error" : undefined}
                className="items-start"
              >
                <TraceIcon className="mt-0.5 size-5">
                  <StepIcon step={step} />
                </TraceIcon>
                <TraceTitle className="whitespace-normal">{step.label}</TraceTitle>
                {step.detail ? (
                  <TraceDescription className="max-w-[15rem] truncate" title={step.detail}>
                    {step.detail}
                  </TraceDescription>
                ) : null}
              </TraceLine>
            ))}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
