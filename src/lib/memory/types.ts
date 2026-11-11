import type {
  AnswerFormat,
  MemoryClaim,
  MemoryEpisode,
  ModelRoute,
  Source,
} from "@/lib/agent/events";

export interface ChatRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  modelId?: string;
  route?: ModelRoute;
  format?: AnswerFormat;
  sources?: Source[];
}

export interface EpisodeRecord extends MemoryEpisode {
  chatId: string;
  userMessageId: string;
  assistantMessageId: string;
  timezone?: string;
}

export type ClaimRecord = MemoryClaim & {
  chatId: string;
  episodeId: string;
  sourcePublishedAt?: string;
};

export interface NewClaim {
  chatId: string;
  episodeId: string;
  text: string;
  sourceUrl: string;
  sourceTitle?: string;
  sourcePublishedAt?: string;
  assertedAt: string;
  validFrom?: string;
  validTo?: string;
  supersedesClaimId?: string;
  isLatest?: boolean;
}

export interface RecallInput {
  query: string;
  chatId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface RecallResult {
  episodes: EpisodeRecord[];
  claims: ClaimRecord[];
}

export interface SaveTurnInput {
  chatId: string;
  userMessage: Omit<MessageRecord, "chatId">;
  assistantMessage: Omit<MessageRecord, "chatId">;
  episode: Omit<EpisodeRecord, "id" | "chatId"> & { id?: string };
  claims: Omit<NewClaim, "chatId" | "episodeId">[];
}

export interface MemoryStore {
  createChat(title?: string): Promise<ChatRecord>;
  getChat(id: string): Promise<ChatRecord | null>;
  listChats(): Promise<ChatRecord[]>;
  renameChat(id: string, title: string): Promise<void>;
  deleteChat(id: string): Promise<void>;
  addMessage(input: Omit<MessageRecord, "chatId"> & { chatId: string }): Promise<MessageRecord>;
  getMessages(chatId: string): Promise<MessageRecord[]>;
  /** The last few completed turns of one chat, oldest first. */
  getRecentEpisodes(chatId: string, limit?: number): Promise<EpisodeRecord[]>;
  recall(input: RecallInput): Promise<RecallResult>;
  saveClaims(claims: NewClaim[]): Promise<ClaimRecord[]>;
  saveTurn(input: SaveTurnInput): Promise<{ episode: EpisodeRecord; claims: ClaimRecord[] }>;
  reset(): Promise<void>;
  close(): void;
}
