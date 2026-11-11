import type { AgentEvent } from "@/lib/agent/events";
import type { ActivityStep, ChatAction, ChatMessage, ChatState } from "./types";

export const initialChatState: ChatState = {
  chatId: null,
  activeAssistantId: null,
  messages: [],
  status: "idle",
  error: null,
};

function patchMessage(
  messages: ChatMessage[],
  id: string | null,
  patch: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  if (!id) return messages;
  return messages.map((message) => (message.id === id ? patch(message) : message));
}

function upsertStep(steps: ActivityStep[] | undefined, next: ActivityStep): ActivityStep[] {
  const current = steps ?? [];
  const index = current.findIndex((step) => step.step === next.step);
  if (index === -1) return [...current, next];
  const updated = [...current];
  updated[index] = { ...updated[index], ...next };
  return updated;
}

function detailForStep(
  message: ChatMessage,
  step: ActivityStep["step"],
  detail: string,
): ChatMessage {
  if (!message.steps) return message;
  return {
    ...message,
    steps: message.steps.map((item) =>
      item.step === step ? { ...item, detail } : item,
    ),
  };
}

function reduceEvent(state: ChatState, event: AgentEvent): ChatState {
  if (event.type === "run_start") {
    return {
      ...state,
      chatId: event.chatId,
      activeAssistantId: state.activeAssistantId ?? event.assistantMessageId,
      messages: patchMessage(state.messages, state.activeAssistantId, (message) => ({
        ...message,
        status: "streaming",
      })),
    };
  }

  if (event.type === "run_done") {
    return {
      ...state,
      status: "idle",
      activeAssistantId: null,
      messages: patchMessage(state.messages, state.activeAssistantId, (message) => ({
        ...message,
        status: "done",
      })),
    };
  }

  if (event.type === "run_error") {
    return {
      ...state,
      status: "error",
      error: event.message,
      activeAssistantId: null,
      messages: patchMessage(state.messages, state.activeAssistantId, (message) => ({
        ...message,
        status: "error",
        error: event.message,
      })),
    };
  }

  const id = state.activeAssistantId;
  if (!id) return state;

  switch (event.type) {
    case "step":
      return {
        ...state,
        messages: patchMessage(state.messages, id, (message) => ({
          ...message,
          steps: upsertStep(message.steps, {
            step: event.step,
            label: event.label,
            status: event.status,
            at: event.at,
            detail: event.detail,
          }),
        })),
      };
    case "recall":
      return {
        ...state,
        messages: patchMessage(state.messages, id, (message) =>
          detailForStep(
            message,
            "recall",
            `${event.episodes.length} episodes, ${event.claims.length} claims`,
          ),
        ),
      };
    case "plan":
      return {
        ...state,
        messages: patchMessage(state.messages, id, (message) => ({
          ...detailForStep(
            message,
            "plan",
            event.queries.length > 0
              ? event.queries.join(" · ")
              : event.reason,
          ),
          recheck: event.recheck ?? message.recheck,
        })),
      };
    case "sources":
      return {
        ...state,
        messages: patchMessage(state.messages, id, (message) => ({
          ...message,
          sources: event.sources,
        })),
      };
    case "answer_format":
      return {
        ...state,
        messages: patchMessage(state.messages, id, (message) => ({
          ...message,
          format: event.format,
        })),
      };
    case "answer_delta":
      return {
        ...state,
        messages: patchMessage(state.messages, id, (message) => ({
          ...message,
          content: message.content + event.text,
        })),
      };
    case "answer_done":
      return {
        ...state,
        messages: patchMessage(state.messages, id, (message) => ({
          ...message,
          content: event.text.trim().length > 0 ? event.text : message.content,
        })),
      };
    case "claims_saved":
      return {
        ...state,
        messages: patchMessage(state.messages, id, (message) =>
          detailForStep(
            message,
            "remember",
            event.claims.length === 0
              ? "Nothing new to save"
              : `Saved ${event.claims.length} ${event.claims.length === 1 ? "fact" : "facts"}`,
          ),
        ),
      };
    case "time_resolved":
      return {
        ...state,
        messages: patchMessage(state.messages, id, (message) =>
          detailForStep(message, "resolve-time", event.label),
        ),
      };
    default:
      return state;
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      return {
        ...state,
        activeAssistantId: action.assistant.id,
        status: "streaming",
        error: null,
        messages: [...state.messages, action.user, action.assistant],
      };
    case "retry":
      return {
        ...state,
        activeAssistantId: action.assistant.id,
        status: "streaming",
        error: null,
        messages: state.messages.map((message) =>
          message.id === action.assistantId ? action.assistant : message,
        ),
      };
    case "event":
      return reduceEvent(state, action.event);
    case "hydrate":
      return {
        ...state,
        chatId: action.chatId,
        messages: action.messages,
        status: "idle",
        error: null,
        activeAssistantId: null,
      };
    case "error":
      return { ...state, status: "error", error: action.error };
    case "stop":
      return {
        ...state,
        status: "idle",
        activeAssistantId: null,
        messages: patchMessage(state.messages, state.activeAssistantId, (message) => ({
          ...message,
          status: message.content ? "done" : "error",
          error: message.content ? undefined : "Stopped before an answer was written.",
        })),
      };
    case "reset":
      return initialChatState;
    default:
      return state;
  }
}
