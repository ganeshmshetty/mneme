"use client";

import { useRef, type ReactNode } from "react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { MicButton } from "@/components/chat/mic-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";

export function Composer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  streaming,
  placeholder = "Ask anything…",
  modelPicker,
  hint,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  streaming: boolean;
  placeholder?: string;
  modelPicker?: ReactNode;
  hint?: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const voiceBaseRef = useRef("");

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        if (!streaming) onSubmit();
      }}
      className="w-full"
    >
      <div
        className={cn(
          "flex flex-col rounded-[1.65rem] border border-border/80 bg-card p-1.5 pl-4",
          "shadow-[0_1px_0_rgba(0,0,0,0.02),0_18px_50px_-30px_rgba(0,0,0,0.35)]",
          "transition-[border-color,box-shadow] duration-200",
          "focus-within:border-ring/40 focus-within:ring-2 focus-within:ring-ring/10",
        )}
      >
        <Textarea
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!streaming) formRef.current?.requestSubmit();
            }
          }}
          placeholder={placeholder}
          aria-label="Message"
          rows={1}
          className="min-h-[3.5rem] max-h-44 flex-1 resize-none border-0 bg-transparent px-0 py-2.5 text-[0.98rem] leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center justify-between gap-2 pr-0.5 pb-0.5">
          <div className="min-w-0 pl-0.5">{modelPicker}</div>
          <div className="flex shrink-0 items-center gap-1">
            <MicButton
              onStart={() => {
                voiceBaseRef.current = value;
              }}
              onTranscript={(text) => {
                onValueChange(
                  voiceBaseRef.current
                    ? `${voiceBaseRef.current} ${text}`
                    : text,
                );
              }}
            />
            {streaming ? (
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={onStop}
                className="size-9 shrink-0 rounded-full"
                aria-label="Stop"
              >
                <SquareIcon className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!value.trim()}
                className="size-9 shrink-0 rounded-full"
                aria-label="Send"
              >
                <ArrowUpIcon className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      {hint ? (
        <div className="mt-2 flex justify-center text-[11px] leading-5 text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </form>
  );
}
