"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownIcon, CheckIcon, CopyIcon, RotateCwIcon } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { OpenUIAnswer } from "@/components/openui/answer-renderer";
import { Button } from "@/components/ui/button";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import { Activity } from "@/components/chat/activity";
import { SourceList } from "@/components/chat/sources";
import { Orb } from "@/components/orb";
import type { ChatMessage } from "@/lib/chat/types";

function AssistantMessage({
  message,
  streaming,
  onRetry,
}: {
  message: ChatMessage;
  streaming: boolean;
  onRetry: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isOpenUI = message.format === "openui";
  const canCopy =
    message.status === "done" && message.content.length > 0 && !isOpenUI;

  async function copy() {
    if (!canCopy) return;
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Message>
      <MessageContent className="gap-4">
        <Activity
          steps={message.steps}
          streaming={streaming}
          dryRun={message.dryRun}
        />

        {message.content ? (
          isOpenUI ? (
            <OpenUIAnswer text={message.content} isStreaming={streaming} />
          ) : (
            <Markdown streaming={streaming}>{message.content}</Markdown>
          )
        ) : streaming && !message.steps?.length ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Orb size={20} />
            Thinking…
          </div>
        ) : null}

        {message.recheck && !isOpenUI && message.status === "done" ? (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <RotateCwIcon className="size-3" />
            Re-checked against current sources
          </div>
        ) : null}

        {!isOpenUI && message.status !== "streaming" ? (
          <SourceList sources={message.sources} />
        ) : null}

        {message.status === "error" ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <span>{message.error ?? "Something went wrong."}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onRetry(message.id)}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {canCopy ? (
          <MessageFooter className="gap-1 px-0">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={copy}
              aria-label={copied ? "Copied" : "Copy answer"}
              className="text-muted-foreground sm:opacity-0 sm:transition-opacity sm:group-hover/message:opacity-100"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
}

export function MessageList({
  messages,
  streaming,
  onRetry,
  bottomInset = 0,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  onRetry: (assistantId: string) => void;
  bottomInset?: number;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const last = messages[messages.length - 1];

  useEffect(() => {
    if (last?.role === "user") pinnedRef.current = true;
    if (!pinnedRef.current) return;
    const node = endRef.current;
    if (!node) return;
    const frame = requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: streaming ? "auto" : "smooth", block: "end" });
    });
    return () => cancelAnimationFrame(frame);
  }, [last?.content, last?.status, messages.length, streaming]);

  // The OpenUI renderer grows after its text arrives. Keep the bottom pinned
  // through that late layout change instead of leaving the answer under the composer.
  useEffect(() => {
    const content = contentRef.current;
    const scroller = scrollerRef.current;
    if (!content || !scroller) return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
      });
    });
    observer.observe(content);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  function onScroll() {
    const node = scrollerRef.current;
    if (!node) return;
    const pinned = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
    pinnedRef.current = pinned;
    setShowScrollButton(!pinned);
  }

  function scrollToLatest() {
    pinnedRef.current = true;
    setShowScrollButton(false);
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  return (
    <div className="relative h-full">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain scrollbar-thin"
      >
        <div
          ref={contentRef}
          className="mx-auto flex w-full max-w-3xl flex-col gap-9 px-4 pt-8 pb-36 sm:px-6"
          style={
            bottomInset > 0
              ? { paddingBottom: bottomInset + 24 }
              : undefined
          }
        >
          {messages.map((message) =>
            message.role === "user" ? (
              <Message key={message.id} align="end">
                <MessageContent className="gap-1">
                  <Bubble align="end" variant="muted" className="max-w-[85%]">
                    <BubbleContent className="rounded-2xl px-4 py-2.5 text-[0.95rem] leading-6">
                      {message.content}
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            ) : (
              <AssistantMessage
                key={message.id}
                message={message}
                streaming={streaming && message.status === "streaming"}
                onRetry={onRetry}
              />
            ),
          )}
          <div ref={endRef} aria-hidden="true" className="h-px w-full" />
        </div>
      </div>

      {showScrollButton ? (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          onClick={scrollToLatest}
          aria-label="Scroll to latest"
          className="absolute bottom-36 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border/70 shadow-sm"
          style={bottomInset > 0 ? { bottom: bottomInset + 16 } : undefined}
        >
          <ArrowDownIcon />
        </Button>
      ) : null}
    </div>
  );
}
