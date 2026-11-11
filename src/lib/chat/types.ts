import type { AnswerFormat, AgentStep, Source, StepStatus } from "@/lib/agent/events";

export interface ActivityStep {
  step: AgentStep;
  label: string;
  status: StepStatus;
  at: string;
  detail?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: "pending" | "streaming" | "done" | "error";
  format?: AnswerFormat;
  sources?: Source[];
  steps?: ActivityStep[];
  recheck?: boolean;
  dryRun?: boolean;
  error?: string;
}

export interface ChatState {
  chatId: string | null;
  activeAssistantId: string | null;
  messages: ChatMessage[];
  status: "idle" | "streaming" | "error";
  error: string | null;
}

export type ChatAction =
  | { type: "send"; user: ChatMessage; assistant: ChatMessage }
  | { type: "retry"; assistantId: string; assistant: ChatMessage }
  | { type: "event"; event: import("@/lib/agent/events").AgentEvent }
  | { type: "hydrate"; chatId: string; messages: ChatMessage[] }
  | { type: "error"; error: string }
  | { type: "stop" }
  | { type: "reset" };
