import type {
  AgentEvent,
  AgentStep,
  AnswerFormat,
  MemoryClaim,
  MemoryEpisode,
  Source,
} from "./events";
import type { MemoryStore, RecallResult, SaveTurnInput } from "@/lib/memory/types";
import type { PageContent, SearchProvider, SearchResult } from "@/lib/search/types";
import { createSearchProvider } from "@/lib/search";
import { domainOf } from "@/lib/search/common";
import {
  AgentAbortedError,
  EmptyModelOutputError,
  generateJsonWithRetry,
  isAbortError,
  ModelOutputError,
  type ModelRuntime,
} from "./model-call";
import { ModelKeyError, resolveModel } from "./models";
import { streamAnswerWithRetry } from "./answer-stream";
import { normalizeExtractedClaims, rememberStepOutcome } from "./claims";
import { toMemoryClaim, toMemoryEpisode } from "./format";
import { buildAnswerPrompt, buildClaimPrompt, buildRewritePrompt } from "./prompts";
import { extractedClaimsSchema, standaloneQuestionSchema } from "./schemas";
import {
  normalizeTimeZone,
  resolveTimeRange,
  type ResolvedTimeRange,
} from "./steps/resolve-time";

export interface RunAgentOptions {
  memory: MemoryStore;
  message: string;
  chatId?: string;
  modelId?: string;
  timeZone?: string;
  signal?: AbortSignal;
  now?: Date;
  /** May also be passed as the second argument to runAgent. */
  onEvent?: (event: AgentEvent) => void;
  /** Injectable for tests; the registry builds one from env and keys otherwise. */
  searchProvider?: SearchProvider;
  runId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
}

export interface RunAgentResult {
  chatId: string;
  runId: string;
  userMessageId: string;
  assistantMessageId: string;
  answer: string;
  format: AnswerFormat;
  sources: Source[];
  claims: MemoryClaim[];
  error?: string;
}

const STEP_ERROR_LABEL: Record<AgentStep, string> = {
  "resolve-time": "Could not work out the time",
  recall: "Could not check memory",
  plan: "Could not plan the turn",
  search: "Search failed",
  answer: "Could not write the answer",
  remember: "Could not save to memory",
};

const RESULT_LIMIT = 6;
const MAX_PAGES = 3;
const WORKING_TURNS = 5;
const MAX_ACTIONS = 3;

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function titleFor(message: string): string {
  const trimmed = message.replace(/\s+/g, " ").trim();
  return trimmed.length <= 60 ? trimmed : `${trimmed.slice(0, 57).trimEnd()}…`;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AgentAbortedError();
}

function mapSources(results: SearchResult[]): Source[] {
  return results.slice(0, RESULT_LIMIT).map((result, index) => ({
    id: `src_${index + 1}`,
    url: result.url,
    title: result.title || domainOf(result.url) || result.url,
    domain: result.domain ?? domainOf(result.url),
    publishedAt: result.publishedAt,
    snippet: result.snippet,
  }));
}

async function openNeededPages(
  provider: SearchProvider,
  sources: Source[],
  openPages: boolean,
  signal: AbortSignal | undefined,
): Promise<{ sources: Source[]; pages: PageContent[] }> {
  if (!provider.openPage || sources.length === 0) return { sources, pages: [] };

  // Snippets come first. A page is opened only when the plan asked for it or a
  // snippet is too thin to contain the fact, and never more than three pages.
  const needsPages =
    openPages || sources.some((source) => !source.snippet || source.snippet.length < 180);
  if (!needsPages) return { sources, pages: [] };

  const ranked = [...sources].sort((left, right) => {
    const leftRank = left.snippet ? 1 : 0;
    const rightRank = right.snippet ? 1 : 0;
    return leftRank - rightRank;
  });
  const chosen = ranked.slice(0, MAX_PAGES);

  const settled = await Promise.allSettled(
    chosen.map(async (source) => ({
      source,
      page: await provider.openPage!(source.url, { signal }),
    })),
  );

  const pages: PageContent[] = [];
  const updated = sources.map((source) => ({ ...source }));
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const { source, page } = result.value;
    if (!page.text?.trim()) continue;
    const target = updated.find((item) => item.url === source.url);
    if (target) {
      target.publishedAt = target.publishedAt ?? page.publishedAt;
      if (!target.title || target.title === target.url) target.title = page.title;
    }
    pages.push({ ...page, url: target?.url ?? source.url });
  }

  return { sources: updated, pages };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AgentAbortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AgentAbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A successful answer must not show a red save error just because a claim was
 * rejected. Retry a transient failure once with the same payload, then once
 * without claims so the episode is still remembered. Only a real DB failure
 * that also blocks the episode is reported to the user.
 */
async function saveTurnWithFallback(
  memory: MemoryStore,
  input: SaveTurnInput,
  signal: AbortSignal | undefined,
): Promise<{
  saved: Awaited<ReturnType<MemoryStore["saveTurn"]>>;
  droppedClaims: boolean;
}> {
  try {
    return { saved: await memory.saveTurn(input), droppedClaims: false };
  } catch (firstError) {
    if (isAbortError(firstError) || signal?.aborted) throw new AgentAbortedError();
    if (process.env.NODE_ENV !== "production") {
      console.error("[mneme] remember save attempt 1 failed", firstError);
    }
  }

  await wait(250, signal);
  try {
    return { saved: await memory.saveTurn(input), droppedClaims: false };
  } catch (secondError) {
    if (isAbortError(secondError) || signal?.aborted) throw new AgentAbortedError();
    if (process.env.NODE_ENV !== "production") {
      console.error("[mneme] remember save attempt 2 failed", secondError);
    }
  }

  if (input.claims.length === 0) {
    throw new Error("The turn could not be saved.");
  }

  // The message/episode write is independent of the claim rows. Preserve the
  // answered turn even when a claim is the reason the transaction failed.
  return {
    saved: await memory.saveTurn({ ...input, claims: [] }),
    droppedClaims: true,
  };
}

function mergeById<T extends { id: string }>(first: T[], second: T[], limit: number): T[] {
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const item of [...first, ...second]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
    if (merged.length >= limit) break;
  }
  return merged;
}

function mergeSources(
  current: Source[],
  next: Source[],
  limit = RESULT_LIMIT,
): Source[] {
  const byUrl = new Map<string, Source>();
  for (const source of [...current, ...next]) {
    if (byUrl.has(source.url)) continue;
    byUrl.set(source.url, source);
    if (byUrl.size >= limit) break;
  }
  return [...byUrl.values()].map((source, index) => ({
    ...source,
    id: `src_${index + 1}`,
  }));
}

function mergePages(current: PageContent[], next: PageContent[]): PageContent[] {
  const byUrl = new Map(current.map((page) => [page.url, page]));
  for (const page of next) byUrl.set(page.url, page);
  return [...byUrl.values()];
}

export async function runAgent(
  options: RunAgentOptions,
  onEventArg?: (event: AgentEvent) => void,
): Promise<RunAgentResult> {
  const { memory, message, signal } = options;
  const onEvent = options.onEvent ?? onEventArg;
  if (!onEvent) throw new Error("runAgent requires an onEvent callback.");
  const runId = options.runId ?? id("run");
  const userMessageId = options.userMessageId ?? id("msg");
  const assistantMessageId = options.assistantMessageId ?? id("msg");
  const startedAt = options.now ?? new Date();
  const timeZone = normalizeTimeZone(options.timeZone);
  const clock = () => (options.now ? new Date(options.now) : new Date());

  let chatId = options.chatId?.trim() ?? "";
  let currentStep: AgentStep | null = null;
  let answer = "";
  let format: AnswerFormat = "markdown";
  let sources: Source[] = [];
  let savedClaims: MemoryClaim[] = [];

  const emit = (event: AgentEvent) => {
    if (signal?.aborted) return;
    try {
      onEvent(event);
    } catch {
      // The stream may already be closed after a stop; memory still finishes.
    }
  };

  const stepStart = (step: AgentStep, label: string, detail?: string) => {
    currentStep = step;
    emit({ type: "step", step, status: "start", label, detail, at: clock().toISOString() });
  };
  const stepDone = (step: AgentStep, label: string, detail?: string) => {
    currentStep = null;
    emit({ type: "step", step, status: "done", label, detail, at: clock().toISOString() });
  };
  const stepError = (step: AgentStep, label: string, detail?: string) => {
    currentStep = null;
    emit({ type: "step", step, status: "error", label, detail, at: clock().toISOString() });
  };

  try {
    // A chat id can arrive from a deleted chat, a reset database, or a stale
    // client. saveTurn would fail with "Chat not found", so recover by creating
    // a fresh chat and letting run_start carry its id back to the UI.
    if (!chatId || !(await memory.getChat(chatId))) {
      const chat = await memory.createChat(titleFor(message));
      chatId = chat.id;
    }

    const resolved = await resolveModel({ modelId: options.modelId, sessionId: chatId });
    const runtime: ModelRuntime = {
      model: resolved.model,
      reasoning: resolved.reasoning,
      provider: resolved.option.provider,
      label: resolved.label,
      providerOptions: resolved.providerOptions,
    };

    emit({
      type: "run_start",
      runId,
      chatId,
      userMessageId,
      assistantMessageId,
      modelId: resolved.modelId,
      route: resolved.route,
      at: clock().toISOString(),
    });

    // Time resolution is code, not a model step. It never appears in the trace.
    const range = resolveTimeRange(message, timeZone, startedAt);
    assertNotAborted(signal);

    let recentEpisodes: MemoryEpisode[] = [];
    try {
      // The last few turns of this chat are working memory. Include them
      // whether or not keyword recall matched them, so follow-ups like "what
      // about the other one?" still have their antecedent.
      recentEpisodes = (
        await memory.getRecentEpisodes(chatId, WORKING_TURNS)
      ).map(toMemoryEpisode);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw new AgentAbortedError();
      // Working memory is best-effort; the answer can proceed without it.
    }

    let episodes: MemoryEpisode[] = [];
    let claims: MemoryClaim[] = [];
    let recallPerformed = false;
    let recallFailed = false;
    let pages: PageContent[] = [];
    let searchPerformed = false;
    let searchFailed = false;
    let recheck = false;
    let actionsUsed = 0;
    let provider: SearchProvider | undefined;

    // Standard conversational-retrieval step: resolve references and omissions
    // into a standalone question before recall/search. Skip it on the first
    // turn, where there is nothing to resolve.
    let standaloneQuestion = message;
    let followUpResolved = false;
    if (recentEpisodes.length > 0) {
      try {
        const rewrite = await generateJsonWithRetry(
          runtime,
          buildRewritePrompt({ question: message, recentEpisodes }),
          standaloneQuestionSchema,
          { maxOutputTokens: 200, temperature: 0, signal, disableThinking: true },
        );
        const next = rewrite.question.trim();
        if (next && next.toLowerCase() !== message.trim().toLowerCase()) {
          standaloneQuestion = next;
          followUpResolved = true;
        }
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw new AgentAbortedError();
        // A rewrite failure falls back to the raw message; never block a turn.
      }
    }

    const getSearchProvider = async (): Promise<SearchProvider> => {
      provider ??= options.searchProvider ?? (await createSearchProvider());
      return provider;
    };

    const runRecall = async (query?: string) => {
      stepStart("recall", "Checking memory");
      try {
        const bounded = await memory.recall({
          query: standaloneQuestion,
          from: range?.from,
          to: range?.to,
          limit: 8,
        });
        let nextEpisodes = bounded.episodes.map(toMemoryEpisode);
        let nextClaims = bounded.claims.map(toMemoryClaim);

        if (
          query &&
          query.trim() &&
          query.trim().toLowerCase() !== standaloneQuestion.trim().toLowerCase()
        ) {
          // The model's query is a synonym/entity lookup. Run it unbounded so
          // it can find the same fact under different words or another date.
          const expanded = await memory.recall({ query: query.trim(), limit: 8 });
          nextEpisodes = mergeById(
            expanded.episodes.map(toMemoryEpisode),
            nextEpisodes,
            8,
          );
          nextClaims = mergeById(
            expanded.claims.map(toMemoryClaim),
            nextClaims,
            8,
          );
        }

        episodes = mergeById(nextEpisodes, episodes, 8);
        claims = mergeById(nextClaims, claims, 8);
        recallPerformed = true;
        recallFailed = false;
        emit({ type: "recall", episodes, claims });
        stepDone(
          "recall",
          "Checked memory",
          episodes.length === 0 && claims.length === 0
            ? "No matching memory"
            : `${episodes.length} ${episodes.length === 1 ? "episode" : "episodes"}, ${claims.length} ${claims.length === 1 ? "claim" : "claims"}`,
        );
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw new AgentAbortedError();
        recallPerformed = true;
        recallFailed = true;
        stepError("recall", "Could not check memory", "Continuing without earlier chats.");
      }
    };

    const runSearch = async (queries: string[], openPages: boolean) => {
      const seen = new Set<string>();
      const cleaned = queries
        .map((query) => query.trim())
        .filter((query) => {
          const key = query.toLowerCase();
          if (!query || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 4);
      const finalQueries = cleaned.length > 0 ? cleaned : [message];

      stepStart("search", "Searching the web");
      searchPerformed = true;
      try {
        const search = await getSearchProvider();
        const results = await search.search(finalQueries, {
          limit: RESULT_LIMIT,
          signal,
        });
        const mapped = mapSources(results);
        const opened = await openNeededPages(search, mapped, openPages, signal);
        sources = mergeSources(sources, opened.sources);
        pages = mergePages(pages, opened.pages);
        searchFailed = false;
        emit({ type: "sources", sources });
        stepDone(
          "search",
          "Searched the web",
          sources.length === 0
            ? "No results"
            : `${sources.length} ${sources.length === 1 ? "source" : "sources"}`,
        );
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw new AgentAbortedError();
        searchFailed = true;
        emit({ type: "sources", sources });
        stepError("search", "Search failed", "Continuing without new sources.");
      }
    };

    let answerStreaming = false;
    while (!answerStreaming) {
      const remainingActions = MAX_ACTIONS - actionsUsed;
      stepStart("plan", "Thinking");

      let thoughtClosed = false;
      const closeThought = (detail: string) => {
        if (thoughtClosed) return;
        thoughtClosed = true;
        stepDone(
          "plan",
          "Thought",
          followUpResolved ? `Resolved follow-up · ${detail}` : detail,
        );
      };

      const prompts = buildAnswerPrompt({
        question: message,
        standaloneQuestion,
        now: startedAt,
        timeZone: range?.timezone ?? timeZone,
        range: range ?? undefined,
        episodes,
        recentEpisodes,
        claims,
        sources,
        pages,
        recheck,
        memoryLookupPerformed: recallPerformed,
        memoryFailed: recallFailed,
        searchPerformed,
        searchFailed,
        remainingActions,
      });

      const result = await streamAnswerWithRetry(
        runtime,
        prompts.prompt,
        { system: prompts.system, maxOutputTokens: 6_000, signal },
        {
          onFormat: (nextFormat) => {
            closeThought(
              searchPerformed
                ? "Answered with sources"
                : recallPerformed
                  ? "Answered from memory"
                  : "Answered directly",
            );
            format = nextFormat;
            emit({ type: "answer_format", format: nextFormat });
          },
          onDelta: (text) => {
            answer += text;
            emit({ type: "answer_delta", text });
          },
        },
      );

      if (result.type === "answer") {
        closeThought("Answered");
        answer = result.text;
        format = result.format;
        answerStreaming = true;
        break;
      }

      closeThought(
        result.type === "recall" ? "Checking memory" : "Searching the web",
      );
      if (remainingActions <= 0) {
        throw new ModelOutputError("The model kept requesting steps after the limit.");
      }
      actionsUsed += 1;

      if (result.type === "recall") {
        await runRecall(result.query);
        continue;
      }

      recheck = recheck || result.recheck;
      if (result.recall || (result.recheck && !recallPerformed)) {
        await runRecall();
      }
      await runSearch(result.queries, result.openPages);
    }

    emit({ type: "answer_done", text: answer });
    assertNotAborted(signal);

    // 6. remember — claims are only extracted when the answer used web sources.
    // The transcript is always saved so the next turn has working memory.
    let rememberStarted = false;
    let extracted: Array<{
      text: string;
      sourceUrl: string;
      sourceTitle?: string;
      sourcePublishedAt?: string;
      validFrom?: string;
      supersedesClaimId?: string;
    }> = [];
    let claimExtractionFailed = false;

    if (sources.length > 0) {
      rememberStarted = true;
      stepStart("remember", "Remembering");
      try {
        const result = await generateJsonWithRetry(
          runtime,
          buildClaimPrompt({
            question: message,
            answer,
            now: startedAt,
            timeZone: range?.timezone ?? timeZone,
            range: range ?? undefined,
            sources,
            pages,
            existingClaims: claims,
          }),
          extractedClaimsSchema,
          { maxOutputTokens: 3_000, signal, disableThinking: true },
        );
        extracted = result.claims;
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw new AgentAbortedError();
        claimExtractionFailed = true;
        if (process.env.NODE_ENV !== "production") {
          console.error("[mneme] claim extraction failed", error);
        }
      }
    }

    const completedAt = clock().toISOString();
    const newClaims = normalizeExtractedClaims(extracted, sources, claims, completedAt);
    if (
      process.env.NODE_ENV !== "production" &&
      extracted.length > 0 &&
      newClaims.length === 0
    ) {
      console.warn("[mneme] remember dropped every extracted claim", {
        extracted: extracted.length,
        sources: sources.map((source) => source.url),
      });
    }

    try {
      const saveInput: SaveTurnInput = {
        chatId,
        userMessage: {
          id: userMessageId,
          role: "user",
          content: message,
          createdAt: startedAt.toISOString(),
          modelId: resolved.modelId,
          route: resolved.route,
        },
        assistantMessage: {
          id: assistantMessageId,
          role: "assistant",
          content: answer,
          createdAt: completedAt,
          modelId: resolved.modelId,
          route: resolved.route,
          format,
          sources,
        },
        episode: {
          userText: message,
          answerText: answer,
          createdAt: completedAt,
          resolvedFrom: range?.from,
          resolvedTo: range?.to,
          timezone: range?.timezone ?? timeZone,
          userMessageId,
          assistantMessageId,
        },
        claims: newClaims,
      };

      const { saved, droppedClaims } = await saveTurnWithFallback(
        memory,
        saveInput,
        signal,
      );
      savedClaims = saved.claims.map(toMemoryClaim);
      emit({ type: "claims_saved", claims: savedClaims });

      if (rememberStarted) {
        const outcome = rememberStepOutcome({
          extractionFailed: claimExtractionFailed || droppedClaims,
          savedClaimCount: savedClaims.length,
        });
        if (outcome.status === "error") {
          stepError("remember", outcome.label, outcome.detail);
        } else {
          stepDone("remember", outcome.label, outcome.detail);
        }
      }
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw new AgentAbortedError();
      if (process.env.NODE_ENV !== "production") {
        console.error("[mneme] remember save failed", {
          chatId,
          runId,
          claims: newClaims.length,
          sources: sources.length,
          error,
        });
      }
      stepError("remember", "Could not save to memory", "The answer is still on screen.");
    }

    emit({ type: "run_done", messageId: assistantMessageId, at: clock().toISOString() });

    return {
      chatId,
      runId,
      userMessageId,
      assistantMessageId,
      answer,
      format,
      sources,
      claims: savedClaims,
    };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw new AgentAbortedError();

    const step = currentStep;
    if (step) {
      stepError(step, STEP_ERROR_LABEL[step]);
    }

    const messageText = userFacingError(error, step);
    emit({ type: "run_error", message: messageText, retryable: !(error instanceof ModelKeyError) });

    return {
      chatId,
      runId,
      userMessageId,
      assistantMessageId,
      answer,
      format,
      sources,
      claims: savedClaims,
      error: messageText,
    };
  }
}

function userFacingError(error: unknown, step: AgentStep | null): string {
  if (error instanceof ModelKeyError) return error.message;
  if (error instanceof EmptyModelOutputError) {
    return "The model returned an empty answer. Try again.";
  }
  if (error instanceof ModelOutputError) {
    return "The model returned an unreadable response. Try again.";
  }
  if (step === "plan" || step === "answer") {
    return "The model call failed. Try again.";
  }
  return "Something went wrong while answering. Try again.";
}

export type { ResolvedTimeRange };
