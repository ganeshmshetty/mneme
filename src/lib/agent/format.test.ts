import { describe, expect, it } from "vitest";
import { createAnswerStreamParser, parseAnswerFormat } from "./format";

describe("parseAnswerFormat", () => {
  it("strips the markdown token", () => {
    expect(parseAnswerFormat("[[markdown]]\nHello there.")).toEqual({
      format: "markdown",
      text: "Hello there.",
    });
  });

  it("strips the token case-insensitively and tolerates spaces", () => {
    expect(parseAnswerFormat("[[ OPENUI ]]\nroot = Answer([intro])\nintro = Paragraph(\"Hi\")")).toEqual({
      format: "openui",
      text: 'root = Answer([intro])\nintro = Paragraph("Hi")',
    });
  });

  it("strips a code fence around an OpenUI program", () => {
    expect(
      parseAnswerFormat('[[openui]]\n```openui\nroot = Answer([intro])\nintro = Paragraph("Hi")\n```'),
    ).toEqual({
      format: "openui",
      text: 'root = Answer([intro])\nintro = Paragraph("Hi")',
    });
  });

  it("falls back to markdown when an OpenUI token has no program", () => {
    expect(parseAnswerFormat("[[openui]]\nJust a sentence.")).toEqual({
      format: "markdown",
      text: "Just a sentence.",
    });
  });

  it("detects an untagged OpenUI program", () => {
    expect(parseAnswerFormat('root = Answer([intro])\nintro = Paragraph("Hi")')).toEqual({
      format: "openui",
      text: 'root = Answer([intro])\nintro = Paragraph("Hi")',
    });
  });

  it("defaults to markdown when there is no token", () => {
    expect(parseAnswerFormat("Plain answer.")).toEqual({
      format: "markdown",
      text: "Plain answer.",
    });
  });

  it("keeps markdown fences in a markdown answer", () => {
    const answer = "[[markdown]]\n```ts\nconst x = 1;\n```";
    expect(parseAnswerFormat(answer)).toEqual({
      format: "markdown",
      text: "```ts\nconst x = 1;\n```",
    });
  });
});

function stream(chunks: string[]) {
  const events: Array<["format" | "delta", string]> = [];
  const parser = createAnswerStreamParser(
    (format) => events.push(["format", format]),
    (text) => events.push(["delta", text]),
  );
  for (const chunk of chunks) parser.push(chunk);
  return { events, result: parser.finish() };
}

describe("createAnswerStreamParser", () => {
  it("holds a split token back, then emits format before the first delta", () => {
    const { events, result } = stream(["[[mark", "down]]\nHel", "lo"]);
    expect(events).toEqual([
      ["format", "markdown"],
      ["delta", "Hel"],
      ["delta", "lo"],
    ]);
    expect(result).toEqual({ type: "answer", format: "markdown", text: "Hello" });
  });

  it("streams an OpenUI program after the token", () => {
    const { events, result } = stream([
      "[[openui]]\nroot = Answer([intro])\n",
      'intro = Paragraph("Hi")',
    ]);
    expect(events[0]).toEqual(["format", "openui"]);
    expect(result).toEqual({
      type: "answer",
      format: "openui",
      text: 'root = Answer([intro])\nintro = Paragraph("Hi")',
    });
  });

  it("defaults to markdown when the model omits the token", () => {
    const { events, result } = stream(["Hello ", "there, ", "friend."]);
    expect(events[0]).toEqual(["format", "markdown"]);
    expect(result).toEqual({
      type: "answer",
      format: "markdown",
      text: "Hello there, friend.",
    });
  });

  it("can return an empty answer when only the token arrived", () => {
    const { events, result } = stream(["[[markdown]]"]);
    expect(events).toEqual([]);
    expect(result).toEqual({ type: "answer", format: "markdown", text: "" });
  });

  it("flushes a short final buffer at finish", () => {
    const { events, result } = stream(["Hi"]);
    expect(events).toEqual([
      ["format", "markdown"],
      ["delta", "Hi"],
    ]);
    expect(result).toEqual({ type: "answer", format: "markdown", text: "Hi" });
  });

  it("parses a recall control without emitting answer text", () => {
    const { events, result } = stream(["[[recall]]"]);
    expect(events).toEqual([]);
    expect(result).toEqual({ type: "recall", query: undefined });
  });

  it("parses a recall query", () => {
    const { events, result } = stream([
      '[[recall]] {"query":"laptop MacBook Air travel"}',
    ]);
    expect(events).toEqual([]);
    expect(result).toEqual({
      type: "recall",
      query: "laptop MacBook Air travel",
    });
  });

  it("parses a search control split across chunks", () => {
    const { events, result } = stream([
      "[[search]] {",
      '"queries":["neon pricing","supabase pricing"],',
      '"openPages":false,"recall":true,"recheck":false}',
    ]);
    expect(events).toEqual([]);
    expect(result).toEqual({
      type: "search",
      queries: ["neon pricing", "supabase pricing"],
      openPages: false,
      recall: true,
      recheck: false,
    });
  });

  it("keeps the first four search queries when the model returns more", () => {
    const { result } = stream([
      '[[search]] {"queries":["hubspot pricing","pipedrive pricing","close pricing","attio pricing","folk pricing"],"openPages":true,"recall":true,"recheck":true}',
    ]);
    expect(result).toEqual({
      type: "search",
      queries: ["hubspot pricing", "pipedrive pricing", "close pricing", "attio pricing"],
      openPages: true,
      recall: true,
      recheck: true,
    });
  });

  it("accepts one query as a string and ignores a repeated control", () => {
    const { result } = stream([
      '[[search]] {"queries":"hubspot pricing"}',
      '\n[[search]] {"queries":["pipedrive pricing"]}',
    ]);
    expect(result).toEqual({
      type: "search",
      queries: ["hubspot pricing"],
      openPages: false,
      recall: false,
      recheck: false,
    });
  });
});
