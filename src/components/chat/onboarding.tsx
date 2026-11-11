"use client";

import * as React from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
import { BotAvatar } from "@/components/bot-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { KeyStatus } from "@/lib/models";
import { cn } from "cn";

const MODEL_PROVIDERS = [
  {
    id: "opencode",
    label: "OpenCode",
    key: "OPENCODE_API_KEY",
    hint: "OpenCode API key",
    url: "https://opencode.ai",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    key: "ANTHROPIC_API_KEY",
    hint: "Anthropic API key",
    url: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    key: "OPENAI_API_KEY",
    hint: "OpenAI API key",
    url: "https://platform.openai.com/api-keys",
  },
  {
    id: "google",
    label: "Google",
    key: "GOOGLE_GENERATIVE_AI_API_KEY",
    hint: "Google AI API key",
    url: "https://aistudio.google.com/apikey",
  },
] as const;

type Step = "welcome" | "model" | "search" | "done";

type SearchProvider = "firecrawl" | "tavily";

const SEARCH_PROVIDERS = [
  {
    id: "firecrawl",
    label: "Firecrawl",
    key: "FIRECRAWL_API_KEY",
    hint: "Firecrawl API key",
    placeholder: "fc-…",
    status: "Raises search limits",
  },
  {
    id: "tavily",
    label: "Tavily",
    key: "TAVILY_API_KEY",
    hint: "Tavily API key",
    placeholder: "tvly-…",
    status: "Used with SEARCH_PROVIDER=tavily",
  },
] as const;

export type OnboardingStart = "welcome" | "model";

async function saveKey(name: string, key: string) {
  const response = await fetch("/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, key }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "Could not save the key.");
  }
}

function Dots({ step }: { step: Step }) {
  const index = step === "model" ? 0 : step === "search" ? 1 : 2;
  const complete = step === "done";

  return (
    <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className={cn(
            "h-1.5 rounded-full",
            complete
              ? "w-1.5 bg-foreground/50"
              : dot === index
                ? "w-4 bg-foreground/70"
                : "w-1.5 bg-border",
          )}
        />
      ))}
    </div>
  );
}

export function Onboarding({
  open,
  initialStep = "welcome",
  keys,
  dark,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  initialStep?: OnboardingStart;
  keys: Record<string, KeyStatus>;
  dark: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [step, setStep] = React.useState<Step>(initialStep);
  const [provider, setProvider] =
    React.useState<(typeof MODEL_PROVIDERS)[number]["id"]>("opencode");
  const [searchProvider, setSearchProvider] =
    React.useState<SearchProvider>("firecrawl");
  const [modelKey, setModelKey] = React.useState("");
  const [searchKey, setSearchKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setStep(initialStep);
    setModelKey("");
    setSearchKey("");
    setError(null);
    setSaving(false);
  }, [open, initialStep]);

  const ghostColor = dark ? "#d6d6d6" : "#3a3a3a";
  const option =
    MODEL_PROVIDERS.find((item) => item.id === provider) ?? MODEL_PROVIDERS[0];
  const savedModel = Boolean(keys[option.key]?.configured);
  const searchOption =
    SEARCH_PROVIDERS.find((item) => item.id === searchProvider) ??
    SEARCH_PROVIDERS[0];
  const savedSearch = Boolean(keys[searchOption.key]?.configured);
  const hasModel = MODEL_PROVIDERS.some((item) => keys[item.key]?.configured);

  function close() {
    onOpenChange(false);
  }

  async function submitModel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!modelKey.trim() && savedModel) {
      setStep("search");
      return;
    }
    if (!modelKey.trim()) return;

    setSaving(true);
    setError(null);
    try {
      await saveKey(option.key, modelKey.trim());
      setModelKey("");
      await onChanged();
      setStep("search");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the key.");
    } finally {
      setSaving(false);
    }
  }

  async function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const value = searchKey.trim();

    if (!value) {
      setStep("done");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await saveKey(searchOption.key, value);
      setSearchKey("");
      await onChanged();
      setStep("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the key.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        initialFocus={false}
        className="w-[min(92vw,31rem)] max-w-[31rem] gap-0 overflow-hidden rounded-[1.4rem] p-0 sm:max-w-[31rem]"
      >
        <div className="flex h-10 shrink-0 items-center justify-end px-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Close setup"
            className="rounded-full text-muted-foreground"
            onClick={close}
          >
            <XIcon />
          </Button>
        </div>

        {step === "welcome" ? (
          <div className="px-8 pt-2 pb-8 text-center">
            <div className="mx-auto flex size-24 items-center justify-center">
              <BotAvatar
                type="ghost"
                state="default"
                size={96}
                color={ghostColor}
                theme="auto"
                aria-label="Mneme"
              />
            </div>
            <DialogTitle className="mt-4 text-[1.6rem] leading-tight font-medium tracking-[-0.035em]">
              Hi, I&apos;m Mneme.
            </DialogTitle>
            <DialogDescription className="mx-auto mt-2 max-w-sm text-sm leading-6">
              A chat agent with memory. I search, answer with sources, and
              remember what I found.
            </DialogDescription>
            <div className="mt-7 space-y-1.5">
              <Button
                type="button"
                autoFocus
                className="h-10 w-full rounded-xl"
                onClick={() => setStep("model")}
              >
                Set up Mneme
                <ArrowRightIcon className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-full text-sm text-muted-foreground"
                onClick={close}
              >
                Skip for now
              </Button>
            </div>
          </div>
        ) : null}

        {step === "model" ? (
          <div className="px-8 pt-1 pb-8">
            <div className="flex flex-col items-center text-center">
              <BotAvatar
                type="ghost"
                state={saving ? "working" : "default"}
                size={64}
                color={ghostColor}
                theme="auto"
                aria-label="Mneme"
              />
              <p className="mt-2 text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                Step 1 of 2
              </p>
              <DialogTitle className="mt-1 text-xl font-medium tracking-[-0.03em]">
                Give me a brain.
              </DialogTitle>
              <DialogDescription className="mt-1.5 max-w-sm text-[13px] leading-5">
                Pick a provider and paste a key. It stays on this machine.
              </DialogDescription>
            </div>

            <form onSubmit={submitModel} className="mt-5">
              <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Model provider">
                {MODEL_PROVIDERS.map((item) => {
                  const configured = Boolean(keys[item.key]?.configured);
                  const selected = item.id === provider;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setProvider(item.id);
                        setModelKey("");
                        setError(null);
                      }}
                      className={cn(
                        "flex h-9 items-center justify-between rounded-lg border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
                        selected
                          ? "border-foreground/20 bg-secondary text-foreground"
                          : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {item.label}
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          configured ? "bg-foreground/60" : "bg-border",
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>

              <Input
                autoFocus
                type="password"
                value={modelKey}
                onChange={(event) => setModelKey(event.target.value)}
                placeholder={
                  savedModel
                    ? "Saved — paste a new key to replace it"
                    : `Paste ${option.hint}`
                }
                autoComplete="off"
                spellCheck={false}
                aria-label={option.hint}
                className="mt-2.5 h-10 font-mono text-xs"
              />

              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  {savedModel
                    ? `Saved · ${keys[option.key]?.masked ?? "configured"}`
                    : "Stored on this machine only"}
                </span>
                <a
                  href={option.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
                >
                  Get a key
                  <ExternalLinkIcon className="size-3" />
                </a>
              </div>

              {error ? (
                <p className="mt-2 text-xs text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                disabled={saving || (!modelKey.trim() && !savedModel)}
                className="mt-4 h-10 w-full rounded-xl"
              >
                {saving ? <Loader2Icon className="animate-spin" /> : null}
                {savedModel && !modelKey.trim() ? "Continue" : "Save and continue"}
              </Button>
              <div className="mt-1 flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 px-2 text-sm text-muted-foreground"
                  onClick={() => setStep("welcome")}
                >
                  <ArrowLeftIcon className="size-3.5" />
                  Back
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 px-2 text-sm text-muted-foreground"
                  onClick={() => setStep("search")}
                >
                  Skip this step
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        {step === "search" ? (
          <div className="px-8 pt-1 pb-8">
            <div className="flex flex-col items-center text-center">
              <BotAvatar
                type="ghost"
                state={saving ? "working" : "default"}
                size={64}
                color={ghostColor}
                theme="auto"
                aria-label="Mneme"
              />
              <p className="mt-2 text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                Step 2 of 2 — optional
              </p>
              <DialogTitle className="mt-1 text-xl font-medium tracking-[-0.03em]">
                Search, but better.
              </DialogTitle>
              <DialogDescription className="mt-1.5 max-w-sm text-[13px] leading-5">
                Search works without a key. Add one only if you want higher
                limits or Tavily.
              </DialogDescription>
            </div>

            <form onSubmit={submitSearch} className="mt-5">
              <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Search provider">
                {SEARCH_PROVIDERS.map((item) => {
                  const configured = Boolean(keys[item.key]?.configured);
                  const selected = item.id === searchProvider;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setSearchProvider(item.id);
                        setSearchKey("");
                        setError(null);
                      }}
                      className={cn(
                        "flex h-9 items-center justify-between rounded-lg border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
                        selected
                          ? "border-foreground/20 bg-secondary text-foreground"
                          : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {item.label}
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          configured ? "bg-foreground/60" : "bg-border",
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>

              <Input
                autoFocus
                type="password"
                value={searchKey}
                onChange={(event) => setSearchKey(event.target.value)}
                placeholder={
                  savedSearch
                    ? "Saved — paste a new key to replace it"
                    : `Paste ${searchOption.hint}`
                }
                autoComplete="off"
                spellCheck={false}
                aria-label={searchOption.hint}
                className="mt-2.5 h-10 font-mono text-xs"
              />

              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  {savedSearch
                    ? `Saved · ${keys[searchOption.key]?.masked ?? "configured"}`
                    : searchOption.status}
                </span>
                <span>Optional</span>
              </div>

              {error ? (
                <p className="mt-2 text-xs text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                disabled={saving}
                className="mt-4 h-10 w-full rounded-xl"
              >
                {saving ? <Loader2Icon className="animate-spin" /> : null}
                {searchKey.trim()
                  ? "Save and finish"
                  : savedSearch
                    ? "Continue"
                    : "Finish setup"}
              </Button>
              <div className="mt-1 flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 px-2 text-sm text-muted-foreground"
                  onClick={() => setStep("model")}
                >
                  <ArrowLeftIcon className="size-3.5" />
                  Back
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 px-2 text-sm text-muted-foreground"
                  onClick={() => setStep("done")}
                >
                  Skip for now
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="px-8 pt-2 pb-8 text-center">
            <div className="mx-auto flex size-24 items-center justify-center">
              <BotAvatar
                type="ghost"
                state="default"
                size={96}
                color={ghostColor}
                hat="party"
                theme="auto"
                aria-label="Mneme"
              />
            </div>
            <DialogTitle className="mt-4 text-[1.6rem] leading-tight font-medium tracking-[-0.035em]">
              {hasModel ? "All set." : "All yours."}
            </DialogTitle>
            <DialogDescription className="mx-auto mt-2 max-w-sm text-sm leading-6">
              {hasModel
                ? "Ask me anything. I'll search, answer, and keep the receipts."
                : "Try a dry run now. Add a key whenever you want real answers."}
            </DialogDescription>
            <Button
              type="button"
              autoFocus
              className="mt-7 h-10 w-full rounded-xl"
              onClick={close}
            >
              {hasModel ? "Start chatting" : "Look around"}
              <ArrowRightIcon className="size-4" />
            </Button>
            <div className="mt-5">
              <Dots step="done" />
            </div>
          </div>
        ) : null}

        {step === "model" || step === "search" ? (
          <div className="pb-5">
            <Dots step={step} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
