import { describe, expect, it } from "vitest";
import {
  renderAnswerPrompt,
  renderAnswerSystemPrompt,
  renderAnswerUserPrompt,
  type AnswerPromptInput,
} from "./answer-core";
import { buildClaimPrompt } from "./claims";
import { buildRewritePrompt } from "./rewrite";

const NOW = new Date("2026-11-11T00:30:00.000Z");
const QUESTION = "What did I ask on 3 November?";

const answerInput: AnswerPromptInput = {
  question: QUESTION,
  standaloneQuestion: QUESTION,
  now: NOW,
  timeZone: "Asia/Kolkata",
  episodes: [
    {
      id: "ep_1",
      userText: "What did I ask on 3 November?",
      answerText: "You compared Neon, Supabase and Crunchy Bridge.",
      createdAt: "2026-11-03T10:00:00.000Z",
    },
  ],
  claims: [],
  sources: [],
  pages: [],
  recheck: false,
  searchPerformed: false,
  searchFailed: false,
  memoryLookupPerformed: false,
  memoryFailed: false,
  remainingActions: 3,
  recentEpisodes: [],
};

describe("answer prompt", () => {
  it("includes the user's current message verbatim", () => {
    const prompt = renderAnswerPrompt(answerInput, "OPENUI STUB");
    expect(prompt).toContain("User's current message");
    expect(prompt).toContain(QUESTION);
    expect(prompt).toContain("<current_message>");
    expect(prompt).toContain("OPENUI STUB");
  });

  it("keeps stable instructions in the system message and context in the user message", () => {
    const system = renderAnswerSystemPrompt(answerInput, "OPENUI STUB");
    const user = renderAnswerUserPrompt(answerInput);
    expect(system).toContain("# Identity");
    expect(system).toContain("# Output format");
    expect(system).not.toContain(QUESTION);
    expect(user).toContain(QUESTION);
    expect(user).toContain("<current_message>");
    expect(user).not.toContain("# Identity");
  });

  it("lets the model answer or request recall/search dynamically", () => {
    const prompt = renderAnswerPrompt(answerInput, "OPENUI STUB");
    expect(prompt).toContain("You may answer now, or ask for one step first");
    expect(prompt).toContain("[[recall]]");
    expect(prompt).toContain("[[search]]");
    expect(prompt).toContain("Do not write an answer and a control token");
    expect(prompt).toContain("Answer now for a greeting, small talk, or stable general knowledge");
    expect(prompt).not.toContain("No web search was run.");
  });

  it("forces an answer when no actions are left", () => {
    const prompt = renderAnswerPrompt(
      { ...answerInput, remainingActions: 0 },
      "OPENUI STUB",
    );
    expect(prompt).toContain("You have used all memory and search steps");
    expect(prompt).toContain("Do not request another step.");
    expect(prompt).not.toContain("[[recall]]");
    expect(prompt).not.toContain("[[search]]");
  });

  it("marks recall as optional context and forbids answering from it", () => {
    const prompt = renderAnswerPrompt(
      { ...answerInput, memoryLookupPerformed: true },
      "OPENUI STUB",
    );
    expect(prompt).toContain("may be unrelated");
    expect(prompt).toContain("Do not answer by reciting or summarizing recalled memory");
    expect(prompt).toContain("ignore all recalled context");
  });

  it("requires false premises to be corrected with the real record and date", () => {
    const prompt = renderAnswerPrompt(
      { ...answerInput, memoryLookupPerformed: true },
      "OPENUI STUB",
    );
    expect(prompt).toContain("correct the premise");
    expect(prompt).toContain("never made");
    expect(prompt).toContain("state what memory actually records and when");
  });

  it("adds the last turns of this chat as working memory for follow-ups", () => {
    const prompt = renderAnswerPrompt(
      {
        ...answerInput,
        question: "What about the other one?",
        standaloneQuestion: "What about the other Postgres host?",
        recentEpisodes: [
          {
            id: "ep_recent",
            userText: "Compare Neon and Supabase for Postgres hosting.",
            answerText: "Neon is cheaper at low usage; Supabase bundles more.",
            createdAt: "2026-11-10T10:00:00.000Z",
          },
        ],
      },
      "OPENUI STUB",
    );

    expect(prompt).toContain("<working_memory>");
    expect(prompt).toContain("Compare Neon and Supabase for Postgres hosting.");
    expect(prompt).toContain("Neon is cheaper at low usage");
    expect(prompt).toContain("Resolve follow-ups like");
    expect(prompt).toContain("the other one");
    expect(prompt).toContain("<standalone_question>");
    expect(prompt).toContain("What about the other Postgres host?");
  });

  it("does not repeat a working-memory turn in the optional recall block", () => {
    const recent = {
      id: "ep_recent",
      userText: "Compare Neon and Supabase.",
      answerText: "The quick answer is Neon.",
      createdAt: "2026-11-10T10:00:00.000Z",
    };
    const prompt = renderAnswerPrompt(
      {
        ...answerInput,
        episodes: [recent],
        recentEpisodes: [recent],
        memoryLookupPerformed: true,
      },
      "OPENUI STUB",
    );

    expect(prompt.match(/The quick answer is Neon\./g)).toHaveLength(1);
  });

  it("omits the working-memory block on the first turn", () => {
    const prompt = renderAnswerPrompt(answerInput, "OPENUI STUB");
    expect(prompt).not.toContain("<working_memory>");
    expect(prompt).not.toContain("Resolve follow-ups like");
  });
});

describe("rewrite prompt", () => {
  it("asks for a standalone question and forbids answering", () => {
    const prompt = buildRewritePrompt({
      question: "When did we last check?",
      recentEpisodes: [
        {
          id: "ep_1",
          userText: "What is the latest price of the iPhone 17?",
          answerText: "The iPhone 17 starts at ₹99,900.",
          createdAt: "2026-11-11T10:00:00.000Z",
        },
      ],
    });

    expect(prompt).toContain("standalone question");
    expect(prompt).toContain("When did we last check?");
    expect(prompt).toContain("What is the latest price of the iPhone 17?");
    expect(prompt).toContain("Do not answer the question");
    expect(prompt).toContain('{"isFollowUp":true,"question":"the standalone question"}');
  });
});

describe("claim prompt", () => {
  it("includes the question, the answer, and the source URL", () => {
    const prompt = buildClaimPrompt({
      question: QUESTION,
      answer: "You compared Neon and Supabase.",
      now: NOW,
      timeZone: "Asia/Kolkata",
      sources: [
        {
          id: "src_1",
          url: "https://example.com/pricing",
          title: "Pricing",
          publishedAt: "2026-11-10",
        },
      ],
      pages: [],
      existingClaims: [],
    });
    expect(prompt).toContain(QUESTION);
    expect(prompt).toContain("You compared Neon and Supabase.");
    expect(prompt).toContain("https://example.com/pricing");
    expect(prompt).toContain("OpenUI Lang");
    expect(prompt).toContain("Compare");
  });
});
