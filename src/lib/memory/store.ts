import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import type { MemoryClaim, MemoryEpisode, Source } from "@/lib/agent/events";
import { closeDatabase, getDatabase, migrate, openDatabase } from "@/lib/db";
import type {
  ChatRecord,
  ClaimRecord,
  EpisodeRecord,
  MemoryStore,
  MessageRecord,
  NewClaim,
  RecallInput,
  RecallResult,
  SaveTurnInput,
} from "@/lib/memory/types";

const DEFAULT_EPISODE_LIMIT = 5;
const DEFAULT_CLAIM_LIMIT = 8;
const MAX_RECALL_LIMIT = 50;
const MAX_QUERY_TOKENS = 12;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "she",
  "should",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

const sourceSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  domain: z.string().optional(),
  publishedAt: z.string().optional(),
  snippet: z.string().optional(),
});

const sourcesSchema = z.array(sourceSchema);

interface ChatRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  model_id: string | null;
  route: "direct" | "opencode" | null;
  format: "markdown" | "openui" | null;
  sources_json: string | null;
}

interface EpisodeRow {
  id: string;
  chat_id: string;
  user_message_id: string;
  assistant_message_id: string;
  user_text: string;
  answer_text: string;
  created_at: string;
  resolved_from: string | null;
  resolved_to: string | null;
  timezone: string | null;
  score?: number;
}

interface ClaimRow {
  id: string;
  chat_id: string;
  episode_id: string;
  text: string;
  source_url: string;
  source_title: string | null;
  source_published_at: string | null;
  asserted_at: string;
  valid_from: string | null;
  valid_to: string | null;
  supersedes_claim_id: string | null;
  is_latest: number;
  score: number;
}

type IdPrefix = "chat" | "msg" | "ep" | "claim";

function makeId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function timestamp(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${field} must be a valid ISO date or timestamp`);
  }
  return new Date(parsed).toISOString();
}

/**
 * Validity boundaries and publish dates can be calendar dates, while actual
 * event timestamps must be ISO UTC. Keep a date-only value as written and
 * normalize anything with a time (including offsets) to UTC.
 */
function boundary(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (DATE_ONLY.test(trimmed)) {
    if (Number.isNaN(Date.parse(`${trimmed}T00:00:00.000Z`))) {
      throw new Error(`${field} must be a valid date or timestamp`);
    }
    return trimmed;
  }
  return timestamp(trimmed, field);
}

function rangeBoundary(
  value: string | undefined,
  edge: "start" | "end",
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (DATE_ONLY.test(trimmed)) {
    return `${trimmed}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`;
  }
  return timestamp(trimmed, "recall date range");
}

function tokenize(query: string): string[] {
  const tokens = new Set<string>();
  const matches = query.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu);

  for (const match of matches) {
    const token = match[0];
    if (token.length < 2 || STOP_WORDS.has(token)) continue;
    tokens.add(token.slice(0, 64));
    if (tokens.size >= MAX_QUERY_TOKENS) break;
  }

  return [...tokens];
}

function limitFor(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_RECALL_LIMIT);
}

function serializeSources(sources: Source[] | undefined): string | null {
  if (sources === undefined) return null;
  return JSON.stringify(sourcesSchema.parse(sources));
}

function parseSources(raw: string | null): Source[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = sourcesSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function mapChat(row: ChatRow): ChatRecord {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    modelId: row.model_id ?? undefined,
    route: row.route ?? undefined,
    format: row.format ?? undefined,
    sources: parseSources(row.sources_json),
  };
}

function mapEpisode(row: EpisodeRow): EpisodeRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    userText: row.user_text,
    answerText: row.answer_text,
    createdAt: row.created_at,
    resolvedFrom: row.resolved_from ?? undefined,
    resolvedTo: row.resolved_to ?? undefined,
    timezone: row.timezone ?? undefined,
  };
}

function toMemoryEpisode(episode: EpisodeRecord): MemoryEpisode {
  return {
    id: episode.id,
    userText: episode.userText,
    answerText: episode.answerText,
    createdAt: episode.createdAt,
    resolvedFrom: episode.resolvedFrom,
    resolvedTo: episode.resolvedTo,
  };
}

function mapClaim(row: ClaimRow): ClaimRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    episodeId: row.episode_id,
    text: row.text,
    sourceUrl: row.source_url,
    sourceTitle: row.source_title ?? undefined,
    sourcePublishedAt: row.source_published_at ?? undefined,
    assertedAt: row.asserted_at,
    validFrom: row.valid_from ?? undefined,
    validTo: row.valid_to ?? undefined,
    supersedesClaimId: row.supersedes_claim_id ?? undefined,
    isLatest: row.is_latest === 1,
  };
}

function toMemoryClaim(claim: ClaimRecord): MemoryClaim {
  return {
    id: claim.id,
    text: claim.text,
    sourceUrl: claim.sourceUrl,
    sourceTitle: claim.sourceTitle,
    assertedAt: claim.assertedAt,
    validFrom: claim.validFrom,
    validTo: claim.validTo,
    supersedesClaimId: claim.supersedesClaimId,
    isLatest: claim.isLatest,
  };
}

/** Kept for callers that want the events-shaped projection. */
export function claimToMemoryClaim(claim: ClaimRecord): MemoryClaim {
  return toMemoryClaim(claim);
}

/** Kept for callers that want the events-shaped projection. */
export function episodeToMemoryEpisode(episode: EpisodeRecord): MemoryEpisode {
  return toMemoryEpisode(episode);
}

function scoreExpression(columns: readonly string[], tokenCount: number): string {
  if (tokenCount === 0) return "0";

  const parts: string[] = [];
  for (let index = 0; index < tokenCount; index += 1) {
    const cases = columns.map(
      (column) =>
        `(CASE WHEN instr(lower(${column}), ?) > 0 THEN 1 ELSE 0 END)`,
    );
    parts.push(`(${cases.join(" + ")})`);
  }
  return parts.join(" + ");
}

export interface CreateMemoryStoreOptions {
  /** Use an existing connection, for example an in-memory database in tests. */
  db?: DatabaseSync;
  /** Open a new connection at this path. Ignored when `db` is provided. */
  path?: string;
}

export class SqliteMemoryStore implements MemoryStore {
  constructor(private readonly db: DatabaseSync) {
    // Cascades are part of the store's contract. `openDatabase` enables this,
    // but a caller-supplied handle must not be able to quietly skip it.
    if (this.db.isOpen) {
      this.db.exec("PRAGMA foreign_keys = ON");
      // Also makes a raw `new DatabaseSync(...)` usable in tests.
      migrate(this.db);
    }
  }

  get isOpen(): boolean {
    return this.db.isOpen;
  }

  private transaction<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the error that caused the rollback.
      }
      throw error;
    }
  }

  private assertChatExists(chatId: string): void {
    const row = this.db
      .prepare("SELECT id FROM chats WHERE id = ?")
      .get(chatId) as unknown as { id: string } | undefined;
    if (!row) throw new Error(`Chat not found: ${chatId}`);
  }

  private assertEpisodeBelongsToChat(episodeId: string, chatId: string): void {
    const row = this.db
      .prepare("SELECT chat_id FROM episodes WHERE id = ?")
      .get(episodeId) as unknown as { chat_id: string } | undefined;
    if (!row) throw new Error(`Episode not found: ${episodeId}`);
    if (row.chat_id !== chatId) {
      throw new Error(`Episode ${episodeId} does not belong to chat ${chatId}`);
    }
  }

  private touchChat(chatId: string): void {
    this.db
      .prepare("UPDATE chats SET updated_at = ? WHERE id = ?")
      .run(nowIso(), chatId);
  }

  private insertMessage(
    input: Omit<MessageRecord, "chatId"> & { chatId: string },
  ): MessageRecord {
    const createdAt = timestamp(input.createdAt, "message created_at");
    const sourcesJson = serializeSources(input.sources);

    this.db
      .prepare(
        `INSERT INTO messages
          (id, chat_id, role, content, created_at, model_id, route, format, sources_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.chatId,
        input.role,
        input.content,
        createdAt,
        input.modelId ?? null,
        input.route ?? null,
        input.format ?? null,
        sourcesJson,
      );

    return {
      id: input.id,
      chatId: input.chatId,
      role: input.role,
      content: input.content,
      createdAt,
      modelId: input.modelId,
      route: input.route,
      format: input.format,
      sources: input.sources,
    };
  }

  private insertEpisode(episode: EpisodeRecord): void {
    this.db
      .prepare(
        `INSERT INTO episodes
          (id, chat_id, user_message_id, assistant_message_id, user_text,
           answer_text, created_at, resolved_from, resolved_to, timezone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        episode.id,
        episode.chatId,
        episode.userMessageId,
        episode.assistantMessageId,
        episode.userText,
        episode.answerText,
        episode.createdAt,
        episode.resolvedFrom ?? null,
        episode.resolvedTo ?? null,
        episode.timezone ?? null,
      );
  }

  private insertClaims(claims: readonly NewClaim[]): ClaimRecord[] {
    if (claims.length === 0) return [];

    const inserted: ClaimRecord[] = [];

    for (const claim of claims) {
      const text = claim.text.trim();
      if (!text) throw new Error("Claim text is required");

      const sourceUrl = claim.sourceUrl.trim();
      if (!sourceUrl) throw new Error("Claim source URL is required");

      this.assertChatExists(claim.chatId);
      this.assertEpisodeBelongsToChat(claim.episodeId, claim.chatId);

      const assertedAt = timestamp(claim.assertedAt, "claim asserted_at");
      const validFrom = boundary(claim.validFrom, "claim valid_from");
      const validTo = boundary(claim.validTo, "claim valid_to");
      const sourcePublishedAt = boundary(
        claim.sourcePublishedAt,
        "claim source_published_at",
      );
      const supersedesClaimId = claim.supersedesClaimId?.trim() || undefined;

      if (supersedesClaimId) {
        const superseded = this.db
          .prepare("SELECT id FROM claims WHERE id = ?")
          .get(supersedesClaimId) as unknown as { id: string } | undefined;

        if (!superseded) {
          throw new Error(`Superseded claim not found: ${supersedesClaimId}`);
        }

        // A newer claim closes the old one's validity at the moment the new
        // fact became true, falling back to when it was asserted.
        this.db
          .prepare(
            "UPDATE claims SET valid_to = ?, is_latest = 0 WHERE id = ?",
          )
          .run(validFrom ?? assertedAt, supersedesClaimId);
      }

      const id = makeId("claim");
      const isLatest = claim.isLatest === false ? 0 : 1;

      this.db
        .prepare(
          `INSERT INTO claims
            (id, chat_id, episode_id, text, source_url, source_title,
             source_published_at, asserted_at, valid_from, valid_to,
             supersedes_claim_id, is_latest)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          claim.chatId,
          claim.episodeId,
          text,
          sourceUrl,
          claim.sourceTitle ?? null,
          sourcePublishedAt ?? null,
          assertedAt,
          validFrom ?? null,
          validTo ?? null,
          supersedesClaimId ?? null,
          isLatest,
        );

      inserted.push({
        id,
        chatId: claim.chatId,
        episodeId: claim.episodeId,
        text,
        sourceUrl,
        sourceTitle: claim.sourceTitle,
        sourcePublishedAt,
        assertedAt,
        validFrom,
        validTo,
        supersedesClaimId,
        isLatest: isLatest === 1,
      });
    }

    return inserted;
  }

  async createChat(title?: string): Promise<ChatRecord> {
    const id = makeId("chat");
    const createdAt = nowIso();
    const normalizedTitle = title?.trim() || "New chat";

    this.db
      .prepare(
        "INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, normalizedTitle, createdAt, createdAt);

    return {
      id,
      title: normalizedTitle,
      createdAt,
      updatedAt: createdAt,
    };
  }

  async getChat(id: string): Promise<ChatRecord | null> {
    const row = this.db
      .prepare(
        "SELECT id, title, created_at, updated_at FROM chats WHERE id = ?",
      )
      .get(id) as unknown as ChatRow | undefined;

    return row ? mapChat(row) : null;
  }

  async listChats(): Promise<ChatRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT id, title, created_at, updated_at
         FROM chats
         ORDER BY updated_at DESC, created_at DESC, rowid DESC`,
      )
      .all() as unknown as ChatRow[];

    return rows.map(mapChat);
  }

  async renameChat(id: string, title: string): Promise<void> {
    const normalizedTitle = title.trim() || "New chat";
    this.db
      .prepare("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?")
      .run(normalizedTitle, nowIso(), id);
  }

  async deleteChat(id: string): Promise<void> {
    this.db.prepare("DELETE FROM chats WHERE id = ?").run(id);
  }

  async addMessage(
    input: Omit<MessageRecord, "chatId"> & { chatId: string },
  ): Promise<MessageRecord> {
    this.assertChatExists(input.chatId);

    return this.transaction(() => {
      const record = this.insertMessage(input);
      this.touchChat(input.chatId);
      return record;
    });
  }

  async getMessages(chatId: string): Promise<MessageRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.chat_id, m.role, m.content, m.created_at, m.model_id,
                m.route, m.format, m.sources_json
         FROM messages m
         JOIN chats ch ON ch.id = m.chat_id
         WHERE m.chat_id = ?
         ORDER BY m.created_at ASC, m.rowid ASC`,
      )
      .all(chatId) as unknown as MessageRow[];

    return rows.map(mapMessage);
  }

  async getRecentEpisodes(
    chatId: string,
    limit = 3,
  ): Promise<EpisodeRecord[]> {
    const capped = limitFor(limit, 3);
    const rows = this.db
      .prepare(
        `SELECT e.id, e.chat_id, e.user_message_id, e.assistant_message_id,
                e.user_text, e.answer_text, e.created_at, e.resolved_from,
                e.resolved_to, e.timezone
         FROM episodes e
         JOIN chats ch ON ch.id = e.chat_id
         WHERE e.chat_id = ?
         ORDER BY e.created_at DESC, e.rowid DESC
         LIMIT ?`,
      )
      .all(chatId, capped) as unknown as EpisodeRow[];

    return rows.map(mapEpisode).reverse();
  }

  async recall(input: RecallInput): Promise<RecallResult> {
    const tokens = tokenize(input.query);
    const from = rangeBoundary(input.from, "start");
    const to = rangeBoundary(input.to, "end");

    if (from && to && from > to) {
      throw new Error("Recall date range starts after it ends");
    }

    const episodeLimit = limitFor(input.limit, DEFAULT_EPISODE_LIMIT);
    const claimLimit = limitFor(input.limit, DEFAULT_CLAIM_LIMIT);
    const includeUnmatched = Boolean(from || to);

    return {
      episodes: this.recallEpisodes(
        tokens,
        input.chatId,
        from,
        to,
        includeUnmatched,
        episodeLimit,
      ),
      claims: this.recallClaims(
        tokens,
        input.chatId,
        from,
        to,
        includeUnmatched,
        claimLimit,
      ),
    };
  }

  private recallEpisodes(
    tokens: readonly string[],
    chatId: string | undefined,
    from: string | undefined,
    to: string | undefined,
    includeUnmatched: boolean,
    limit: number,
  ): EpisodeRecord[] {
    const params: Array<string | number | null> = [];

    const expression = scoreExpression(
      ["e.user_text", "e.answer_text"],
      tokens.length,
    );
    for (const token of tokens) params.push(token, token);

    const conditions: string[] = [];
    if (chatId) {
      conditions.push("e.chat_id = ?");
      params.push(chatId);
    }
    if (from) {
      conditions.push("e.created_at >= ?");
      params.push(from);
    }
    if (to) {
      conditions.push("e.created_at <= ?");
      params.push(to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(includeUnmatched ? 1 : 0, limit);

    const rows = this.db
      .prepare(
        `WITH ranked AS (
           SELECT e.id, e.chat_id, e.user_message_id, e.assistant_message_id,
                  e.user_text, e.answer_text, e.created_at, e.resolved_from,
                  e.resolved_to, e.timezone, e.rowid AS row_id,
                  (${expression}) AS score
           FROM episodes e
           JOIN chats ch ON ch.id = e.chat_id
           ${where}
         )
         SELECT * FROM ranked
         WHERE ? = 1 OR score > 0
         ORDER BY score DESC, created_at DESC, row_id DESC
         LIMIT ?`,
      )
      .all(...params) as unknown as EpisodeRow[];

    return rows.map(mapEpisode);
  }

  private recallClaims(
    tokens: readonly string[],
    chatId: string | undefined,
    from: string | undefined,
    to: string | undefined,
    includeUnmatched: boolean,
    limit: number,
  ): ClaimRecord[] {
    const params: Array<string | number | null> = [];

    const expression = scoreExpression(["c.text"], tokens.length);
    for (const token of tokens) params.push(token);

    const conditions: string[] = [];
    if (chatId) {
      conditions.push("c.chat_id = ?");
      params.push(chatId);
    }
    if (from) {
      conditions.push("c.asserted_at >= ?");
      params.push(from);
    }
    if (to) {
      conditions.push("c.asserted_at <= ?");
      params.push(to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(includeUnmatched ? 1 : 0, limit);

    const rows = this.db
      .prepare(
        `WITH ranked AS (
           SELECT c.id, c.chat_id, c.episode_id, c.text, c.source_url,
                  c.source_title, c.source_published_at, c.asserted_at,
                  c.valid_from, c.valid_to, c.supersedes_claim_id, c.is_latest,
                  c.rowid AS row_id, (${expression}) AS score
           FROM claims c
           JOIN chats ch ON ch.id = c.chat_id
           JOIN episodes ep ON ep.id = c.episode_id
           ${where}
         )
         SELECT * FROM ranked
         WHERE ? = 1 OR score > 0
         ORDER BY score DESC, asserted_at DESC, row_id DESC
         LIMIT ?`,
      )
      .all(...params) as unknown as ClaimRow[];

    return rows.map(mapClaim);
  }

  async saveClaims(claims: NewClaim[]): Promise<ClaimRecord[]> {
    return this.transaction(() => this.insertClaims(claims));
  }

  async saveTurn(
    input: SaveTurnInput,
  ): Promise<{ episode: EpisodeRecord; claims: ClaimRecord[] }> {
    return this.transaction(() => {
      this.assertChatExists(input.chatId);

      this.insertMessage({ ...input.userMessage, chatId: input.chatId });
      this.insertMessage({ ...input.assistantMessage, chatId: input.chatId });

      const episode: EpisodeRecord = {
        id: input.episode.id ?? makeId("ep"),
        chatId: input.chatId,
        userMessageId: input.episode.userMessageId,
        assistantMessageId: input.episode.assistantMessageId,
        userText: input.episode.userText,
        answerText: input.episode.answerText,
        createdAt: timestamp(input.episode.createdAt, "episode created_at"),
        resolvedFrom: boundary(
          input.episode.resolvedFrom,
          "episode resolved_from",
        ),
        resolvedTo: boundary(input.episode.resolvedTo, "episode resolved_to"),
        timezone: input.episode.timezone,
      };

      this.insertEpisode(episode);

      const claims = this.insertClaims(
        input.claims.map((claim) => ({
          ...claim,
          chatId: input.chatId,
          episodeId: episode.id,
        })),
      );

      this.touchChat(input.chatId);

      return { episode, claims };
    });
  }

  async reset(): Promise<void> {
    this.transaction(() => {
      this.db.exec("DELETE FROM claims");
      this.db.exec("DELETE FROM episodes");
      this.db.exec("DELETE FROM messages");
      this.db.exec("DELETE FROM chats");
    });
  }

  close(): void {
    const globalWithStore = globalThis as typeof globalThis & {
      __mnemeMemoryStore?: SqliteMemoryStore;
    };
    if (globalWithStore.__mnemeMemoryStore === this) {
      globalWithStore.__mnemeMemoryStore = undefined;
    }
    closeDatabase(this.db);
  }
}

export function createMemoryStore(
  options: CreateMemoryStoreOptions | string = {},
): SqliteMemoryStore {
  const config = typeof options === "string" ? { path: options } : options;
  return new SqliteMemoryStore(config.db ?? openDatabase(config.path));
}

/**
 * Process-wide store for the app and pipeline. Tests should build their own
 * store with `createMemoryStore` so their database stays isolated.
 */
export function getMemoryStore(): SqliteMemoryStore {
  const globalWithStore = globalThis as typeof globalThis & {
    __mnemeMemoryStore?: SqliteMemoryStore;
  };

  const existing = globalWithStore.__mnemeMemoryStore;
  if (existing?.isOpen) return existing;

  const store = new SqliteMemoryStore(getDatabase());
  globalWithStore.__mnemeMemoryStore = store;
  return store;
}

export default SqliteMemoryStore;
