import { OPENUI_PROMPT } from "@/lib/openui/prompt";
import {
  renderAnswerSystemPrompt,
  renderAnswerUserPrompt,
  type AnswerPromptInput,
} from "./answer-core";

export type { AnswerPromptInput };

export interface AnswerPrompts {
  system: string;
  prompt: string;
}

export function buildAnswerPrompt(input: AnswerPromptInput): AnswerPrompts {
  return {
    system: renderAnswerSystemPrompt(input, OPENUI_PROMPT),
    prompt: renderAnswerUserPrompt(input),
  };
}
