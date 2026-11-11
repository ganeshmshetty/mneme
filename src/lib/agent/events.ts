export type AgentStep =
  | "resolve-time"
  | "recall"
  | "plan"
  | "search"
  | "answer"
  | "remember";

export type StepStatus = "start" | "done" | "error";

export type AnswerFormat = "markdown" | "openui";

export type ModelRoute = "direct" | "opencode";

export interface Source {
  id: string;
  url: string;
  title: string;
  domain?: string;
  publishedAt?: string;
  snippet?: string;
}

export interface MemoryEpisode {
  id: string;
  userText: string;
  answerText: string;
  createdAt: string;
  resolvedFrom?: string;
  resolvedTo?: string;
}

export interface MemoryClaim {
  id: string;
  text: string;
  sourceUrl: string;
  sourceTitle?: string;
  assertedAt: string;
  validFrom?: string;
  validTo?: string;
  supersedesClaimId?: string;
  isLatest: boolean;
}

export type AgentEvent =
  | {
      type: "run_start";
      runId: string;
      chatId: string;
      userMessageId: string;
      assistantMessageId: string;
      modelId: string;
      route: ModelRoute;
      at: string;
    }
  | {
      type: "step";
      step: AgentStep;
      status: StepStatus;
      label: string;
      at: string;
      detail?: string;
    }
  | {
      type: "time_resolved";
      from: string;
      to: string;
      timezone: string;
      label: string;
      ambiguous?: boolean;
    }
  | {
      type: "recall";
      episodes: MemoryEpisode[];
      claims: MemoryClaim[];
    }
  | {
      type: "plan";
      action: "answer" | "search";
      queries: string[];
      reason: string;
      recheck?: boolean;
    }
  | {
      type: "sources";
      sources: Source[];
    }
  | {
      type: "answer_format";
      format: AnswerFormat;
    }
  | {
      type: "answer_delta";
      text: string;
    }
  | {
      type: "answer_done";
      text: string;
    }
  | {
      type: "claims_saved";
      claims: MemoryClaim[];
    }
  | {
      type: "run_done";
      messageId: string;
      at: string;
    }
  | {
      type: "run_error";
      message: string;
      retryable: boolean;
    };

export interface ChatRequestBody {
  chatId?: string;
  message: string;
  modelId?: string;
  timeZone?: string;
}
