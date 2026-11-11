import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Source } from "@/lib/agent/events";
import {
  MIGRATIONS,
  getSchemaVersion,
  openDatabase,
  resolveDatabasePath,
} from "@/lib/db";
import { SqliteMemoryStore } from "@/lib/memory/store";
import type { NewClaim, SaveTurnInput } from "@/lib/memory/types";

type TurnClaim = Omit<NewClaim, "chatId" | "episodeId">;

let db: DatabaseSync;
let store: SqliteMemoryStore;
let sequence = 0;

function claimInput(overrides: Partial<TurnClaim> = {}): TurnClaim {
  return {
    text: "Neon's Launch plan costs $19/month.",
    sourceUrl: "https://neon.tech/pricing",
    sourceTitle: "Pricing — Neon",
    assertedAt: "2026-11-03T10:12:00.000Z",
    ...overrides,
  };
}

function turnInput(params: {
  chatId: string;
  userText: string;
  answerText: string;
  createdAt: string;
  resolvedFrom?: string;
  resolvedTo?: string;
  claims?: TurnClaim[];
}): SaveTurnInput {
  sequence += 1;
  const suffix = String(sequence);
  const userMessageId = `msg_user_${suffix}`;
  const assistantMessageId = `msg_assistant_${suffix}`;

  return {
    chatId: params.chatId,
    userMessage: {
      id: userMessageId,
      role: "user",
      content: params.userText,
      createdAt: params.createdAt,
    },
    assistantMessage: {
      id: assistantMessageId,
      role: "assistant",
      content: params.answerText,
      createdAt: params.createdAt,
      modelId: "test-model",
      route: "direct",
      format: "markdown",
      sources: [],
    },
    episode: {
      userMessageId,
      assistantMessageId,
      userText: params.userText,
      answerText: params.answerText,
      createdAt: params.createdAt,
      resolvedFrom: params.resolvedFrom,
      resolvedTo: params.resolvedTo,
      timezone: "Asia/Kolkata",
    },
    claims: params.claims ?? [],
  };
}

function countRows(table: "messages" | "episodes" | "claims"): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as unknown as { count: number };
  return row.count;
}

beforeEach(() => {
  sequence = 0;
  db = openDatabase(":memory:");
  store = new SqliteMemoryStore(db);
});

afterEach(() => {
  store.close();
});

describe("chats and messages", () => {
  it("creates, reads, lists and renames chats", async () => {
    const chat = await store.createChat("  Postgres hosting  ");
    expect(chat.id).toMatch(/^chat_/);
    expect(chat.title).toBe("Postgres hosting");
    expect(chat.createdAt).toBe(chat.updatedAt);

    expect(await store.getChat(chat.id)).toEqual(chat);
    expect(await store.getChat("chat_missing")).toBeNull();

    const second = await store.createChat();
    expect(second.title).toBe("New chat");

    const chats = await store.listChats();
    expect(chats.map((item) => item.id).sort()).toEqual(
      [chat.id, second.id].sort(),
    );

    await store.renameChat(chat.id, "Neon pricing");
    const renamed = await store.getChat(chat.id);
    expect(renamed?.title).toBe("Neon pricing");
    expect(renamed?.createdAt).toBe(chat.createdAt);

    await store.deleteChat(second.id);
    expect(await store.getChat(second.id)).toBeNull();
    // Deleting a chat that is already gone is a no-op.
    await expect(store.deleteChat(second.id)).resolves.toBeUndefined();
  });

  it("round-trips messages, sources and assistant metadata", async () => {
    const chat = await store.createChat("Pricing");
    const sources: Source[] = [
      {
        id: "src_neon",
        url: "https://neon.tech/pricing",
        title: "Pricing — Neon",
        domain: "neon.tech",
        publishedAt: "2026-11-10",
        snippet: "Launch plan $25/month",
      },
    ];

    const user = await store.addMessage({
      id: "msg_user_1",
      chatId: chat.id,
      role: "user",
      content: "What does Neon cost?",
      createdAt: "2026-11-03T15:42:00+05:30",
    });

    const assistant = await store.addMessage({
      id: "msg_assistant_1",
      chatId: chat.id,
      role: "assistant",
      content: "Neon's Launch plan costs $19/month.",
      createdAt: "2026-11-03T10:12:05.000Z",
      modelId: "anthropic/claude-sonnet",
      route: "opencode",
      format: "markdown",
      sources,
    });

    expect(user.createdAt).toBe("2026-11-03T10:12:00.000Z");

    const messages = await store.getMessages(chat.id);
    expect(messages).toEqual([user, assistant]);
    expect(messages[1]?.modelId).toBe("anthropic/claude-sonnet");
    expect(messages[1]?.route).toBe("opencode");
    expect(messages[1]?.format).toBe("markdown");
    expect(messages[1]?.sources).toEqual(sources);
    expect(await store.getMessages("chat_missing")).toEqual([]);
  });

  it("rejects messages for a missing chat", async () => {
    await expect(
      store.addMessage({
        id: "msg_orphan",
        chatId: "chat_missing",
        role: "user",
        content: "Hello",
        createdAt: "2026-11-03T10:00:00.000Z",
      }),
    ).rejects.toThrow(/Chat not found/);
  });

  it("returns the latest episodes of one chat, oldest first", async () => {
    const chat = await store.createChat("Follow-ups");
    const other = await store.createChat("Other");

    for (let index = 1; index <= 4; index += 1) {
      await store.saveTurn(
        turnInput({
          chatId: chat.id,
          userText: `turn ${index}`,
          answerText: `answer ${index}`,
          createdAt: `2026-11-0${index}T10:00:00.000Z`,
        }),
      );
    }
    await store.saveTurn(
      turnInput({
        chatId: other.id,
        userText: "other chat",
        answerText: "other answer",
        createdAt: "2026-11-05T10:00:00.000Z",
      }),
    );

    const recent = await store.getRecentEpisodes(chat.id, 3);
    expect(recent.map((episode) => episode.userText)).toEqual([
      "turn 2",
      "turn 3",
      "turn 4",
    ]);
    expect(await store.getRecentEpisodes(chat.id, 1)).toHaveLength(1);
    expect(await store.getRecentEpisodes("chat_missing")).toEqual([]);
  });
});

describe("saveTurn", () => {
  it("writes the messages, episode and claims in one call", async () => {
    const chat = await store.createChat("Postgres");

    const result = await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "What does Neon cost?",
        answerText: "Neon's Launch plan costs $19/month.",
        createdAt: "2026-11-03T10:12:00.000Z",
        resolvedFrom: "2026-11-03T00:00:00.000Z",
        resolvedTo: "2026-11-03T23:59:59.999Z",
        claims: [
          claimInput({ sourcePublishedAt: "2026-11-01" }),
          claimInput({
            text: "Neon's Launch plan includes 100 GB of storage.",
            assertedAt: "2026-11-03T10:12:01.000Z",
          }),
        ],
      }),
    );

    expect(result.episode.id).toMatch(/^ep_/);
    expect(result.episode.chatId).toBe(chat.id);
    expect(result.episode.timezone).toBe("Asia/Kolkata");
    expect(result.claims).toHaveLength(2);
    expect(result.claims[0]?.episodeId).toBe(result.episode.id);
    expect(result.claims[0]?.isLatest).toBe(true);
    expect(result.claims[0]?.assertedAt).toBe("2026-11-03T10:12:00.000Z");
    expect(result.claims[0]?.sourceTitle).toBe("Pricing — Neon");
    expect(result.claims[0]?.sourcePublishedAt).toBe("2026-11-01");

    const messages = await store.getMessages(chat.id);
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);

    const recalled = await store.recall({ query: "Neon", chatId: chat.id });
    expect(recalled.episodes.map((episode) => episode.id)).toEqual([
      result.episode.id,
    ]);
    expect(recalled.episodes[0]?.resolvedFrom).toBe(
      "2026-11-03T00:00:00.000Z",
    );
    expect(recalled.claims.map((claim) => claim.id).sort()).toEqual(
      result.claims.map((claim) => claim.id).sort(),
    );
  });

  it("rolls back messages and the episode when a claim is invalid", async () => {
    const chat = await store.createChat("Atomic");

    const input = turnInput({
      chatId: chat.id,
      userText: "What does Neon cost?",
      answerText: "Neon's Launch plan costs $19/month.",
      createdAt: "2026-11-03T10:12:00.000Z",
      claims: [
        claimInput(),
        claimInput({
          text: "A claim that points at a missing predecessor.",
          supersedesClaimId: "claim_missing",
        }),
      ],
    });

    await expect(store.saveTurn(input)).rejects.toThrow(
      /Superseded claim not found/,
    );

    expect(await store.getMessages(chat.id)).toEqual([]);
    expect(countRows("messages")).toBe(0);
    expect(countRows("episodes")).toBe(0);
    expect(countRows("claims")).toBe(0);
  });

  it("rejects a turn for a missing chat without writing anything", async () => {
    await expect(
      store.saveTurn(
        turnInput({
          chatId: "chat_missing",
          userText: "Hello",
          answerText: "Hi",
          createdAt: "2026-11-03T10:12:00.000Z",
        }),
      ),
    ).rejects.toThrow(/Chat not found/);

    expect(countRows("messages")).toBe(0);
    expect(countRows("episodes")).toBe(0);
  });
});

describe("claims and supersession", () => {
  it("closes the old claim at the new claim's valid_from and keeps both", async () => {
    const chat = await store.createChat("Pricing");
    const first = await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "What does Neon cost?",
        answerText: "Neon's Launch plan costs $19/month.",
        createdAt: "2026-11-03T10:12:00.000Z",
        claims: [
          claimInput({
            text: "Neon's Launch plan costs $19/month.",
            assertedAt: "2026-11-03T10:12:00.000Z",
            validFrom: "2026-11-03",
          }),
        ],
      }),
    );

    const oldClaim = first.claims[0];
    expect(oldClaim).toBeDefined();
    if (!oldClaim) throw new Error("expected a saved claim");

    const [newClaim] = await store.saveClaims([
      {
        chatId: chat.id,
        episodeId: first.episode.id,
        text: "Neon's Launch plan costs $25/month.",
        sourceUrl: "https://neon.tech/pricing",
        sourceTitle: "Pricing — Neon",
        assertedAt: "2026-11-10T09:04:00.000Z",
        validFrom: "2026-11-10",
        supersedesClaimId: oldClaim.id,
      },
    ]);

    expect(newClaim).toBeDefined();
    if (!newClaim) throw new Error("expected a new claim");
    expect(newClaim.isLatest).toBe(true);
    expect(newClaim.supersedesClaimId).toBe(oldClaim.id);
    expect(newClaim.validFrom).toBe("2026-11-10");

    const recalled = await store.recall({ query: "Neon", limit: 20 });
    const closed = recalled.claims.find((claim) => claim.id === oldClaim.id);
    expect(closed).toBeDefined();
    expect(closed?.isLatest).toBe(false);
    expect(closed?.validTo).toBe("2026-11-10");
    expect(recalled.claims.filter((claim) => claim.id === oldClaim.id)).toHaveLength(
      1,
    );
    expect(recalled.claims.some((claim) => claim.id === newClaim.id)).toBe(true);
  });

  it("falls back to asserted_at when the new claim has no valid_from", async () => {
    const chat = await store.createChat("Pricing");
    const first = await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "What does Neon cost?",
        answerText: "Neon's Launch plan costs $19/month.",
        createdAt: "2026-11-03T10:12:00.000Z",
        claims: [claimInput()],
      }),
    );

    const oldClaim = first.claims[0];
    if (!oldClaim) throw new Error("expected a saved claim");

    const [newClaim] = await store.saveClaims([
      {
        chatId: chat.id,
        episodeId: first.episode.id,
        text: "Neon's Launch plan costs $25/month.",
        sourceUrl: "https://neon.tech/pricing",
        assertedAt: "2026-11-12T12:00:00+05:30",
        supersedesClaimId: oldClaim.id,
      },
    ]);

    expect(newClaim?.assertedAt).toBe("2026-11-12T06:30:00.000Z");

    const recalled = await store.recall({ query: "Neon", limit: 20 });
    const old = recalled.claims.find((claim) => claim.id === oldClaim.id);
    expect(old?.validTo).toBe("2026-11-12T06:30:00.000Z");
    expect(old?.isLatest).toBe(false);
  });

  it("rolls back the whole batch when a superseded claim does not exist", async () => {
    const chat = await store.createChat("Pricing");
    const first = await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "What does Neon cost?",
        answerText: "Neon's Launch plan costs $19/month.",
        createdAt: "2026-11-03T10:12:00.000Z",
        claims: [claimInput()],
      }),
    );

    const oldClaim = first.claims[0];
    if (!oldClaim) throw new Error("expected a saved claim");

    await expect(
      store.saveClaims([
        {
          chatId: chat.id,
          episodeId: first.episode.id,
          text: "A valid claim in the same batch.",
          sourceUrl: "https://example.com/valid",
          assertedAt: "2026-11-10T09:00:00.000Z",
        },
        {
          chatId: chat.id,
          episodeId: first.episode.id,
          text: "A claim with a bad predecessor.",
          sourceUrl: "https://example.com/bad",
          assertedAt: "2026-11-10T09:01:00.000Z",
          supersedesClaimId: "claim_missing",
        },
      ]),
    ).rejects.toThrow(/Superseded claim not found/);

    const recalled = await store.recall({ query: "Neon", limit: 20 });
    expect(recalled.claims.map((claim) => claim.id)).toEqual([oldClaim.id]);
    expect(countRows("claims")).toBe(1);
  });

  it("keeps a superseding claim when the old claim's chat is deleted", async () => {
    const oldChat = await store.createChat("Old answer");
    const first = await store.saveTurn(
      turnInput({
        chatId: oldChat.id,
        userText: "What does Neon cost?",
        answerText: "Neon's Launch plan costs $19/month.",
        createdAt: "2026-11-03T10:12:00.000Z",
        claims: [claimInput()],
      }),
    );
    const oldClaim = first.claims[0];
    if (!oldClaim) throw new Error("expected a saved claim");

    const newChat = await store.createChat("Re-check");
    const second = await store.saveTurn(
      turnInput({
        chatId: newChat.id,
        userText: "Has Neon's price changed?",
        answerText: "Neon's Launch plan now costs $25/month.",
        createdAt: "2026-11-10T09:04:00.000Z",
        claims: [
          claimInput({
            text: "Neon's Launch plan costs $25/month.",
            assertedAt: "2026-11-10T09:04:00.000Z",
          }),
        ],
      }),
    );
    const newClaim = second.claims[0];
    if (!newClaim) throw new Error("expected a new claim");

    await store.saveClaims([
      {
        chatId: newChat.id,
        episodeId: second.episode.id,
        text: "Neon's Launch plan costs $25/month.",
        sourceUrl: "https://neon.tech/pricing",
        assertedAt: "2026-11-10T09:05:00.000Z",
        validFrom: "2026-11-10",
        supersedesClaimId: oldClaim.id,
      },
    ]);

    await store.deleteChat(oldChat.id);

    const recalled = await store.recall({
      query: "Neon",
      chatId: newChat.id,
      limit: 20,
    });
    expect(recalled.claims).toHaveLength(2);
    expect(
      recalled.claims.filter((claim) => claim.id === oldClaim.id),
    ).toEqual([]);
  });

  it("validates episode ownership, text and source URL", async () => {
    const chat = await store.createChat("Pricing");
    const turn = await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "What does Neon cost?",
        answerText: "Neon's Launch plan costs $19/month.",
        createdAt: "2026-11-03T10:12:00.000Z",
      }),
    );

    await expect(
      store.saveClaims([
        {
          chatId: chat.id,
          episodeId: "ep_missing",
          text: "Orphan claim",
          sourceUrl: "https://example.com",
          assertedAt: "2026-11-03T10:12:00.000Z",
        },
      ]),
    ).rejects.toThrow(/Episode not found/);

    await expect(
      store.saveClaims([
        {
          chatId: chat.id,
          episodeId: turn.episode.id,
          text: "   ",
          sourceUrl: "https://example.com",
          assertedAt: "2026-11-03T10:12:00.000Z",
        },
      ]),
    ).rejects.toThrow(/Claim text is required/);

    await expect(
      store.saveClaims([
        {
          chatId: chat.id,
          episodeId: turn.episode.id,
          text: "A claim without a source.",
          sourceUrl: "   ",
          assertedAt: "2026-11-03T10:12:00.000Z",
        },
      ]),
    ).rejects.toThrow(/Claim source URL is required/);

    expect(countRows("claims")).toBe(0);
  });
});

describe("recall", () => {
  it("ranks by keyword matches, then recency", async () => {
    const chat = await store.createChat("History");
    await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "Neon pricing",
        answerText: "Neon costs nineteen dollars.",
        createdAt: "2026-11-01T10:00:00.000Z",
        claims: [
          claimInput({
            text: "Neon pricing is 19 dollars.",
            assertedAt: "2026-11-01T10:00:00.000Z",
          }),
        ],
      }),
    );
    await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "Postgres support",
        answerText: "Postgres support is paid.",
        createdAt: "2026-11-02T10:00:00.000Z",
        claims: [
          claimInput({
            text: "Postgres support is paid.",
            assertedAt: "2026-11-02T10:00:00.000Z",
          }),
        ],
      }),
    );
    const third = await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "Neon pricing history",
        answerText: "Neon pricing changed to 25 dollars.",
        createdAt: "2026-11-03T10:00:00.000Z",
        claims: [
          claimInput({
            text: "Neon pricing is 25 dollars.",
            assertedAt: "2026-11-03T10:00:00.000Z",
          }),
        ],
      }),
    );
    await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "Neon",
        answerText: "A generic answer.",
        createdAt: "2026-11-04T10:00:00.000Z",
      }),
    );

    const recalled = await store.recall({ query: "Neon pricing" });
    expect(recalled.episodes.map((episode) => episode.userText)).toEqual([
      "Neon pricing history",
      "Neon pricing",
      "Neon",
    ]);
    expect(recalled.claims.map((claim) => claim.text)).toEqual([
      "Neon pricing is 25 dollars.",
      "Neon pricing is 19 dollars.",
    ]);

    const capped = await store.recall({ query: "Neon pricing", limit: 1 });
    expect(capped.episodes).toHaveLength(1);
    expect(capped.episodes[0]?.id).toBe(third.episode.id);
    expect(capped.claims).toHaveLength(1);
    expect(capped.claims[0]?.text).toBe("Neon pricing is 25 dollars.");

    const postgres = await store.recall({ query: "Postgres" });
    expect(postgres.episodes).toHaveLength(1);
    expect(postgres.episodes[0]?.userText).toBe("Postgres support");
    expect(postgres.claims).toHaveLength(1);

    await expect(store.recall({ query: "kubernetes" })).resolves.toEqual({
      episodes: [],
      claims: [],
    });
  });

  it("bounds results by a UTC date range, inclusive of date-only ends", async () => {
    const chat = await store.createChat("Dates");
    const inRange = await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "A question at the end of the day",
        answerText: "An answer about alpha.",
        createdAt: "2026-11-03T23:30:00.000Z",
        claims: [
          claimInput({
            text: "Alpha was announced on 3 November.",
            assertedAt: "2026-11-03T23:30:00.000Z",
          }),
        ],
      }),
    );
    await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "A question after midnight",
        answerText: "An answer about beta.",
        createdAt: "2026-11-04T00:30:00.000Z",
        claims: [
          claimInput({
            text: "Beta was announced on 4 November.",
            assertedAt: "2026-11-04T00:30:00.000Z",
          }),
        ],
      }),
    );
    await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "A question last month",
        answerText: "An answer about gamma.",
        createdAt: "2026-10-30T12:00:00.000Z",
        claims: [
          claimInput({
            text: "Gamma was announced in October.",
            assertedAt: "2026-10-30T12:00:00.000Z",
          }),
        ],
      }),
    );

    const onThird = await store.recall({
      query: "nothing matches this",
      from: "2026-11-03",
      to: "2026-11-03",
    });
    expect(onThird.episodes.map((episode) => episode.id)).toEqual([
      inRange.episode.id,
    ]);
    expect(onThird.claims.map((claim) => claim.text)).toEqual([
      "Alpha was announced on 3 November.",
    ]);

    // Without a date range a non-matching keyword returns nothing. Inside a
    // range, every row in the range is a candidate, ranked by keyword, so a
    // query about an old date can still surface episodes whose text does not
    // repeat the date.
    const fromFourth = await store.recall({
      query: "alpha",
      from: "2026-11-04T00:00:00.000Z",
    });
    expect(fromFourth.episodes.map((episode) => episode.userText)).toEqual([
      "A question after midnight",
    ]);
    expect(fromFourth.claims.map((claim) => claim.text)).toEqual([
      "Beta was announced on 4 November.",
    ]);

    const emptyRange = await store.recall({
      query: "anything",
      from: "2026-11-20",
      to: "2026-11-21",
    });
    expect(emptyRange).toEqual({ episodes: [], claims: [] });

    await expect(
      store.recall({
        query: "anything",
        from: "2026-11-05",
        to: "2026-11-01",
      }),
    ).rejects.toThrow(/starts after/);
  });

  it("can restrict recall to one chat", async () => {
    const firstChat = await store.createChat("First");
    await store.saveTurn(
      turnInput({
        chatId: firstChat.id,
        userText: "Question from the first chat",
        answerText: "Answer from the first chat.",
        createdAt: "2026-11-03T10:00:00.000Z",
        claims: [
          claimInput({
            text: "Claim from the first chat.",
            assertedAt: "2026-11-03T10:00:00.000Z",
          }),
        ],
      }),
    );

    const secondChat = await store.createChat("Second");
    await store.saveTurn(
      turnInput({
        chatId: secondChat.id,
        userText: "Question from the second chat",
        answerText: "Answer from the second chat.",
        createdAt: "2026-11-03T11:00:00.000Z",
        claims: [
          claimInput({
            text: "Claim from the second chat.",
            assertedAt: "2026-11-03T11:00:00.000Z",
          }),
        ],
      }),
    );

    const scoped = await store.recall({
      query: "nothing matches this",
      chatId: firstChat.id,
      from: "2026-11-03",
      to: "2026-11-03",
    });
    expect(scoped.episodes).toHaveLength(1);
    expect(scoped.episodes[0]?.userText).toBe(
      "Question from the first chat",
    );
    expect(scoped.claims).toHaveLength(1);
    expect(scoped.claims[0]?.text).toBe("Claim from the first chat.");

    const acrossChats = await store.recall({
      query: "nothing matches this",
      from: "2026-11-03",
      to: "2026-11-03",
    });
    expect(acrossChats.episodes).toHaveLength(2);
    expect(acrossChats.claims).toHaveLength(2);
  });
});

describe("deletion and reset", () => {
  it("cascades a chat delete to messages, episodes and claims", async () => {
    const chat = await store.createChat("Delete me");
    await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "What does Neon cost?",
        answerText: "Neon's Launch plan costs $19/month.",
        createdAt: "2026-11-03T10:12:00.000Z",
        claims: [claimInput()],
      }),
    );

    expect(countRows("messages")).toBe(2);
    expect(countRows("episodes")).toBe(1);
    expect(countRows("claims")).toBe(1);

    await store.deleteChat(chat.id);

    expect(await store.getChat(chat.id)).toBeNull();
    expect(await store.getMessages(chat.id)).toEqual([]);
    expect(countRows("messages")).toBe(0);
    expect(countRows("episodes")).toBe(0);
    expect(countRows("claims")).toBe(0);

    const recalled = await store.recall({
      query: "Neon",
      from: "2026-11-03",
      to: "2026-11-03",
    });
    expect(recalled).toEqual({ episodes: [], claims: [] });
  });

  it("reset clears every row but keeps the schema", async () => {
    const chat = await store.createChat("Reset me");
    await store.saveTurn(
      turnInput({
        chatId: chat.id,
        userText: "What does Neon cost?",
        answerText: "Neon's Launch plan costs $19/month.",
        createdAt: "2026-11-03T10:12:00.000Z",
        claims: [claimInput()],
      }),
    );

    await store.reset();

    expect(await store.listChats()).toEqual([]);
    expect(countRows("messages")).toBe(0);
    expect(countRows("episodes")).toBe(0);
    expect(countRows("claims")).toBe(0);
    expect(getSchemaVersion(db)).toBe(MIGRATIONS.at(-1)?.version);

    const fresh = await store.createChat("Still works");
    await store.addMessage({
      id: "msg_after_reset",
      chatId: fresh.id,
      role: "user",
      content: "Hello again",
      createdAt: "2026-11-05T10:00:00.000Z",
    });
    expect(await store.getMessages(fresh.id)).toHaveLength(1);
  });
});

describe("database setup", () => {
  it("uses WAL, foreign keys and the latest user_version for a file database", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mneme-db-"));
    const file = path.join(dir, "mneme.sqlite");

    try {
      const fileDb = openDatabase(file);
      const journal = fileDb.prepare("PRAGMA journal_mode").get() as unknown as {
        journal_mode: string;
      };
      const foreignKeys = fileDb
        .prepare("PRAGMA foreign_keys")
        .get() as unknown as { foreign_keys: number };

      expect(journal.journal_mode).toBe("wal");
      expect(foreignKeys.foreign_keys).toBe(1);
      expect(getSchemaVersion(fileDb)).toBe(MIGRATIONS.at(-1)?.version);
      fileDb.close();

      const reopened = openDatabase(file);
      expect(getSchemaVersion(reopened)).toBe(MIGRATIONS.at(-1)?.version);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates and enables cascades on a caller-supplied connection", async () => {
    const raw = new DatabaseSync(":memory:");
    const rawStore = new SqliteMemoryStore(raw);

    try {
      const chat = await rawStore.createChat("Raw connection");
      await rawStore.saveTurn(
        turnInput({
          chatId: chat.id,
          userText: "What does Neon cost?",
          answerText: "Neon's Launch plan costs $19/month.",
          createdAt: "2026-11-03T10:12:00.000Z",
          claims: [claimInput()],
        }),
      );

      expect(getSchemaVersion(raw)).toBe(MIGRATIONS.at(-1)?.version);

      await rawStore.deleteChat(chat.id);
      expect(await rawStore.getMessages(chat.id)).toEqual([]);
      const claims = raw
        .prepare("SELECT COUNT(*) AS count FROM claims")
        .get() as unknown as { count: number };
      expect(claims.count).toBe(0);
    } finally {
      rawStore.close();
    }
  });

  it("resolves MNEME_DB_PATH over the default location", () => {
    const original = process.env.MNEME_DB_PATH;
    try {
      process.env.MNEME_DB_PATH = "./tmp/mneme-test.sqlite";
      expect(resolveDatabasePath()).toBe(
        path.resolve("./tmp/mneme-test.sqlite"),
      );

      process.env.MNEME_DB_PATH = ":memory:";
      expect(resolveDatabasePath()).toBe(":memory:");

      const memoryDb = openDatabase();
      expect(memoryDb.isOpen).toBe(true);
      expect(getSchemaVersion(memoryDb)).toBe(MIGRATIONS.at(-1)?.version);
      memoryDb.close();
    } finally {
      if (original === undefined) delete process.env.MNEME_DB_PATH;
      else process.env.MNEME_DB_PATH = original;
    }
  });
});
