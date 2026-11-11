"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { AppMenu } from "@/components/chat/app-menu";
import { Composer } from "@/components/chat/composer";
import { ConfirmDialog } from "@/components/chat/confirm-dialog";
import { EmptyState } from "@/components/chat/empty-state";
import { MessageList } from "@/components/chat/message-list";
import { ModelPicker } from "@/components/chat/model-picker";
import { Onboarding, type OnboardingStart } from "@/components/chat/onboarding";
import { Button } from "@/components/ui/button";
import type { AgentEvent, AgentStep } from "@/lib/agent/events";
import { chatReducer, initialChatState } from "@/lib/chat/reducer";
import { streamChat } from "@/lib/chat/client";
import type { ChatMessage } from "@/lib/chat/types";
import type { ModelsResponse } from "@/lib/models";
import { DEFAULT_MODEL_ID, MODELS, PROVIDERS } from "@/lib/models";
import { cn } from "cn";

const MODEL_KEYS = [
  "OPENCODE_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;

const DRY_STEPS: { step: AgentStep; label: string }[] = [
  { step: "plan", label: "Thought" },
  { step: "recall", label: "Checked memory" },
  { step: "search", label: "Searched the web" },
  { step: "remember", label: "Remembered the facts" },
];

const FALLBACK: ModelsResponse = {
  providers: PROVIDERS,
  models: MODELS,
  keys: Object.fromEntries(
    PROVIDERS.map((provider) => [provider.keyEnv, { configured: true }]),
  ),
  opencode: true,
  opencodePlan: "go",
};

function nowIso() {
  return new Date().toISOString();
}

export function ChatShell() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [draft, setDraft] = useState("");
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [modelsData, setModelsData] = useState<ModelsResponse | null>(null);
  const [onboarding, setOnboarding] = useState<{
    open: boolean;
    start: OnboardingStart;
  }>({ open: false, start: "welcome" });
  const [confirmAction, setConfirmAction] = useState<"delete" | "reset" | null>(null);
  const [dark, setDark] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoOpenedRef = useRef(false);
  const dryRunRef = useRef<{ cancelled: boolean } | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);

  const hasChat = state.messages.length > 0;
  const streaming = state.status === "streaming";
  const keys = modelsData?.keys ?? {};
  const models = modelsData?.models ?? MODELS;
  const opencode = modelsData?.opencode ?? true;
  const hasModel = modelsData
    ? MODEL_KEYS.some((name) => Boolean(modelsData.keys[name]?.configured))
    : true;

  const loadModels = useCallback(async () => {
    try {
      const response = await fetch("/api/models", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load models.");
      const data = (await response.json()) as ModelsResponse;
      setModelsData(data);
      return data;
    } catch {
      setModelsData(FALLBACK);
      return FALLBACK;
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  // The composer floats over the conversation. Keep the last message above it
  // as it grows with a multi-line draft.
  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setComposerHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // First run, with no model key: open setup once. Skipping is remembered.
  useEffect(() => {
    if (!modelsData || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    if (hasModel) return;
    if (localStorage.getItem("mneme-onboarded") === "1") return;
    localStorage.setItem("mneme-onboarded", "1");
    setOnboarding({ open: true, start: "welcome" });
  }, [hasModel, modelsData]);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    const storedModel = localStorage.getItem("mneme-model");
    if (storedModel) setModelId(storedModel);
  }, []);

  useEffect(() => {
    localStorage.setItem("mneme-model", modelId);
  }, [modelId]);

  useEffect(() => {
    if (!modelsData) return;
    const available = (model: (typeof modelsData.models)[number]) =>
      Boolean(modelsData.keys[model.keyEnv]?.configured) ||
      (modelsData.opencode &&
        (modelsData.opencodePlan !== "go" || Boolean(model.go)));
    if (!modelsData.models.some((model) => model.id === modelId && available(model))) {
      const firstAvailable = modelsData.models.find(available);
      setModelId(firstAvailable?.id ?? DEFAULT_MODEL_ID);
    }
  }, [modelId, modelsData]);

  const run = useCallback(
    async (text: string, retryId?: string) => {
      const trimmed = text.trim();
      if (!trimmed || state.status === "streaming") return;

      const assistant: ChatMessage = {
        id: `msg_${crypto.randomUUID()}`,
        role: "assistant",
        content: "",
        createdAt: nowIso(),
        status: "streaming",
        format: "markdown",
        steps: [],
        sources: [],
      };

      if (retryId) {
        dispatch({ type: "retry", assistantId: retryId, assistant });
      } else {
        const user: ChatMessage = {
          id: `msg_${crypto.randomUUID()}`,
          role: "user",
          content: trimmed,
          createdAt: nowIso(),
          status: "done",
        };
        dispatch({ type: "send", user, assistant });
        setDraft("");
      }

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamChat(
          {
            chatId: state.chatId ?? undefined,
            message: trimmed,
            modelId,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          (event) => dispatch({ type: "event", event }),
          controller.signal,
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          dispatch({
            type: "event",
            event: {
              type: "run_error",
              message: error instanceof Error ? error.message : "Something went wrong.",
              retryable: true,
            },
          });
        }
      } finally {
        if (!controller.signal.aborted) dispatch({ type: "stop" });
        abortRef.current = null;
      }
    },
    [modelId, state.chatId, state.status],
  );

  const runDryRun = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || dryRunRef.current) return;

    const session = { cancelled: false };
    dryRunRef.current = session;

    const user: ChatMessage = {
      id: `msg_${crypto.randomUUID()}`,
      role: "user",
      content: trimmed,
      createdAt: nowIso(),
      status: "done",
    };
    const assistant: ChatMessage = {
      id: `msg_${crypto.randomUUID()}`,
      role: "assistant",
      content: "",
      createdAt: nowIso(),
      status: "streaming",
      format: "markdown",
      steps: [],
      sources: [],
      dryRun: true,
    };

    dispatch({ type: "send", user, assistant });
    setDraft("");

    const at = () => new Date().toISOString();
    const wait = (ms: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    const emit = (event: AgentEvent) => {
      if (!session.cancelled) dispatch({ type: "event", event });
    };

    try {
      for (const entry of DRY_STEPS) {
        emit({
          type: "step",
          step: entry.step,
          status: "start",
          label: entry.label,
          detail: "Prerecorded",
          at: at(),
        });
        await wait(150);
        if (session.cancelled) return;
        emit({
          type: "step",
          step: entry.step,
          status: "done",
          label: entry.label,
          detail: "Prerecorded",
          at: at(),
        });
        await wait(60);
        if (session.cancelled) return;
      }

      const quoted = trimmed
        .replace(/\s+/g, " ")
        .slice(0, 140)
        .replace(/([*_`\\])/g, "\\$1");
      const parts = [
        "**Dry run.** No model key yet, so this turn is prerecorded.\n\n",
        `You asked: “${quoted}”\n\n`,
        "A live turn would search the web, answer with sources, and remember the facts. Set up Mneme below to make it real.",
      ];
      const answer = parts.join("");

      for (const part of parts) {
        emit({ type: "answer_delta", text: part });
        await wait(180);
        if (session.cancelled) return;
      }

      emit({ type: "answer_done", text: answer });
      emit({ type: "run_done", messageId: assistant.id, at: at() });
    } finally {
      if (dryRunRef.current === session) dryRunRef.current = null;
    }
  }, []);

  function send(text: string) {
    if (state.status === "streaming") return;
    if (!hasModel) {
      void runDryRun(text);
      return;
    }
    void run(text);
  }

  function openSetup(start: OnboardingStart = "model") {
    setOnboarding({ open: true, start });
  }

  function stop() {
    if (dryRunRef.current) dryRunRef.current.cancelled = true;
    dryRunRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "stop" });
  }

  function retry(assistantId: string) {
    const index = state.messages.findIndex((message) => message.id === assistantId);
    const previousUser = [...state.messages.slice(0, Math.max(0, index))]
      .reverse()
      .find((message) => message.role === "user");
    if (previousUser) void run(previousUser.content, assistantId);
  }

  function newChat() {
    if (dryRunRef.current) dryRunRef.current.cancelled = true;
    dryRunRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "reset" });
    setDraft("");
  }

  async function deleteChat() {
    const chatId = state.chatId;
    newChat();
    if (!chatId) return;
    await fetch(`/api/chats/${chatId}`, { method: "DELETE" }).catch(() => undefined);
  }

  async function resetMemory() {
    newChat();
    await fetch("/api/reset", { method: "POST" }).catch(() => undefined);
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    localStorage.setItem("mneme-theme", next ? "dark" : "light");
  }

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <header
        className="relative z-30 flex h-14 shrink-0 items-center justify-between border-b border-border/40 px-4 sm:px-6"
      >
        <span className="text-base font-semibold tracking-[-0.03em]">Mneme</span>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={newChat}
          >
            <PlusIcon />
            New chat
          </Button>
          <AppMenu
            dark={dark}
            onToggleTheme={toggleTheme}
            onNewChat={newChat}
            onAddKey={() => openSetup("model")}
            onDeleteChat={hasChat ? () => setConfirmAction("delete") : undefined}
            onResetMemory={() => setConfirmAction("reset")}
          />
        </div>
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        {hasChat ? (
          <MessageList
            messages={state.messages}
            streaming={streaming}
            onRetry={retry}
            bottomInset={composerHeight}
          />
        ) : (
          <EmptyState dark={dark} onSuggestion={send} />
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-36 bg-gradient-to-t from-background via-background/90 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-3">
          <div
            ref={composerRef}
            className={cn(
              "mx-auto w-full max-w-2xl transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              hasChat
                ? "translate-y-0"
                : "translate-y-[calc(-34vh+50%+0.75rem)]",
            )}
          >
            <Composer
              value={draft}
              onValueChange={setDraft}
              onSubmit={() => send(draft)}
              onStop={stop}
              streaming={streaming}
              placeholder={hasChat ? "Ask a follow-up…" : "Ask anything…"}
              hint={
                modelsData && !hasModel ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                      Dry run
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 rounded-full px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => openSetup("model")}
                    >
                      <KeyRoundIcon className="size-3" />
                      Set up Mneme
                    </Button>
                  </span>
                ) : undefined
              }
              modelPicker={
                <ModelPicker
                  value={modelId}
                  onChange={(id) => setModelId(id)}
                  models={models}
                  keys={keys}
                  opencode={opencode}
                  onAddKey={() => openSetup("model")}
                />
              }
            />
          </div>
        </div>
      </main>

      <Onboarding
        open={onboarding.open}
        initialStep={onboarding.start}
        keys={keys}
        dark={dark}
        onOpenChange={(open) => {
          setOnboarding((current) => ({ ...current, open }));
          if (!open) localStorage.setItem("mneme-onboarded", "1");
        }}
        onChanged={() => void loadModels()}
      />

      <ConfirmDialog
        open={confirmAction === "delete"}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title="Delete this chat?"
        description="This removes the chat, its episodes and its claims. Saved keys stay."
        confirmLabel="Delete chat"
        onConfirm={() => {
          setConfirmAction(null);
          void deleteChat();
        }}
      />
      <ConfirmDialog
        open={confirmAction === "reset"}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title="Delete all memory?"
        description="Every chat, episode and claim will be removed. Saved keys stay."
        confirmLabel="Reset memory"
        onConfirm={() => {
          setConfirmAction(null);
          void resetMemory();
        }}
      />
    </div>
  );
}
