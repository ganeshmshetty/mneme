"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Streamdown, type Components, type ExtraProps } from "streamdown";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

type CodeProps = React.ComponentProps<"code"> &
  ExtraProps & { "data-block"?: string };

const LANGUAGE = /language-([^\s]+)/;

function textOf(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(children)) {
    return textOf(children.props.children);
  }
  return "";
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? "Copied" : "Copy code"}
      className="text-muted-foreground hover:text-foreground"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

function NativeCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const lines = useHighlightedCode(code, language);

  return (
    <figure
      data-slot="native-code-block"
      className="not-prose group/code my-4 w-full min-w-0 overflow-hidden rounded-xl border border-border/70 bg-muted/35"
    >
      <figcaption className="flex h-9 items-center justify-between gap-3 border-b border-border/60 px-3">
        <span className="font-mono text-[11px] lowercase tracking-[0.02em] text-muted-foreground">
          {language || "code"}
        </span>
        <CopyButton value={code} />
      </figcaption>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-6">
        <code className="block w-max min-w-full">
          {lines.map((line, index) => (
            <span key={index} className="block min-h-6">
              {React.Children.count(line) > 0 ? line : "\n"}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}

function MarkdownCode({
  className,
  children,
  node: _node,
  "data-block": block,
  ...props
}: CodeProps) {
  if (!block) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  const raw = textOf(children);
  const code = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  const language = className?.match(LANGUAGE)?.[1]?.toLowerCase() ?? "";

  return <NativeCodeBlock code={code} language={language} />;
}

const components: Components = { code: MarkdownCode };

export function Markdown({
  children,
  className,
  streaming = false,
}: {
  children: string;
  className?: string;
  streaming?: boolean;
}) {
  return (
    <Streamdown
      mode={streaming ? "streaming" : "static"}
      className={cn("answer-prose min-w-0", className)}
      components={components}
    >
      {children}
    </Streamdown>
  );
}
