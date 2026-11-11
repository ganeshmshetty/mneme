import { describe, expect, it } from "vitest";
import { normalizeTimeZone, resolveTimeRange } from "./resolve-time";

const IST = "Asia/Kolkata";
// 00:30 on 11 November in IST, while UTC is still 10 November.
const IST_LATE_NIGHT = new Date("2026-11-10T19:00:00.000Z");

function resolve(message: string, timeZone = IST, now = IST_LATE_NIGHT) {
  return resolveTimeRange(message, timeZone, now);
}

describe("resolveTimeRange", () => {
  it("returns null when the message has no date phrase", () => {
    expect(resolve("What did I ask you about Postgres?")).toBeNull();
  });

  it("uses the request time zone, not the UTC date, for today", () => {
    expect(resolve("today")).toMatchObject({
      from: "2026-11-10T18:30:00.000Z",
      to: "2026-11-11T18:29:59.999Z",
      timezone: IST,
      label: "11 Nov 2026",
      ambiguous: false,
    });
  });

  it("resolves yesterday across the UTC date boundary", () => {
    expect(resolve("yesterday")).toMatchObject({
      from: "2026-11-09T18:30:00.000Z",
      to: "2026-11-10T18:29:59.999Z",
      label: "10 Nov 2026",
    });
  });

  it("resolves an absolute day in IST late at night", () => {
    expect(resolve("on 3 November")).toMatchObject({
      from: "2026-11-02T18:30:00.000Z",
      to: "2026-11-03T18:29:59.999Z",
      label: "3 Nov 2026",
      ambiguous: true,
    });
  });

  it("resolves last Tuesday relative to the local weekday", () => {
    expect(resolve("last Tuesday")).toMatchObject({
      from: "2026-11-09T18:30:00.000Z",
      to: "2026-11-10T18:29:59.999Z",
      label: "10 Nov 2026",
      ambiguous: false,
    });
  });

  it("resolves last Friday even when memory has nothing for it", () => {
    expect(resolve("What did I ask you last Friday?")).toMatchObject({
      from: "2026-11-05T18:30:00.000Z",
      to: "2026-11-06T18:29:59.999Z",
      label: "6 Nov 2026",
    });
  });

  it("resolves a bare weekday and flags the assumed date", () => {
    expect(resolve("What did I ask on Monday?")).toMatchObject({
      from: "2026-11-08T18:30:00.000Z",
      to: "2026-11-09T18:29:59.999Z",
      label: "9 Nov 2026",
      ambiguous: true,
    });
  });

  it("resolves the previous calendar week with a Monday start", () => {
    expect(resolve("last week")).toMatchObject({
      from: "2026-11-01T18:30:00.000Z",
      to: "2026-11-08T18:29:59.999Z",
      label: "2–8 Nov 2026",
    });
  });

  it("resolves the current calendar week", () => {
    expect(resolve("this week")).toMatchObject({
      from: "2026-11-08T18:30:00.000Z",
      to: "2026-11-15T18:29:59.999Z",
      label: "9–15 Nov 2026",
    });
  });

  it("resolves the week containing a date", () => {
    expect(resolve("the week of 3 November")).toMatchObject({
      from: "2026-11-01T18:30:00.000Z",
      to: "2026-11-08T18:29:59.999Z",
      label: "2–8 Nov 2026",
      ambiguous: true,
    });
  });

  it("resolves a month with an implied year", () => {
    expect(resolve("what did we discuss in November")).toMatchObject({
      from: "2026-10-31T18:30:00.000Z",
      to: "2026-11-30T18:29:59.999Z",
      label: "Nov 2026",
      ambiguous: true,
    });
  });

  it("resolves a month with an explicit year", () => {
    expect(resolve("November 2026")).toMatchObject({
      from: "2026-10-31T18:30:00.000Z",
      to: "2026-11-30T18:29:59.999Z",
      label: "Nov 2026",
      ambiguous: false,
    });
  });

  it("resolves last month", () => {
    expect(resolve("last month")).toMatchObject({
      from: "2026-09-30T18:30:00.000Z",
      to: "2026-10-31T18:29:59.999Z",
      label: "Oct 2026",
    });
  });

  it("resolves last year", () => {
    expect(resolve("last year")).toMatchObject({
      from: "2024-12-31T18:30:00.000Z",
      to: "2025-12-31T18:29:59.999Z",
      label: "2025",
    });
  });

  it("resolves an inclusive multi-day range", () => {
    expect(resolve("3 Nov to 10 Nov")).toMatchObject({
      from: "2026-11-02T18:30:00.000Z",
      to: "2026-11-10T18:29:59.999Z",
      label: "3–10 Nov 2026",
    });
  });

  it("resolves a trailing range that includes today", () => {
    expect(resolve("past 3 days")).toMatchObject({
      from: "2026-11-08T18:30:00.000Z",
      to: "2026-11-11T18:29:59.999Z",
      label: "Past 3 days",
    });
  });

  it("resolves since a date through the end of today", () => {
    expect(resolve("since 3 November")).toMatchObject({
      from: "2026-11-02T18:30:00.000Z",
      to: "2026-11-11T18:29:59.999Z",
      label: "Since 3 Nov 2026",
      ambiguous: true,
    });
  });

  it("gives an explicit clock time an hour window", () => {
    expect(resolve("3 November at 3pm")).toMatchObject({
      from: "2026-11-03T09:30:00.000Z",
      to: "2026-11-03T10:29:59.999Z",
      label: "3 Nov 2026 15:00–15:59",
    });
  });

  it("gives an explicit clock minute a minute window", () => {
    expect(resolve("3 November at 15:30")).toMatchObject({
      from: "2026-11-03T10:00:00.000Z",
      to: "2026-11-03T10:00:59.999Z",
    });
  });

  it("uses the local date when UTC is still on the previous day", () => {
    const now = new Date("2026-11-11T23:30:00.000Z");
    expect(resolveTimeRange("today", IST, now)).toMatchObject({
      from: "2026-11-11T18:30:00.000Z",
      to: "2026-11-12T18:29:59.999Z",
      label: "12 Nov 2026",
    });
  });

  it("handles a 23-hour DST day", () => {
    const now = new Date("2026-03-08T12:00:00.000Z");
    expect(resolveTimeRange("today", "America/New_York", now)).toMatchObject({
      from: "2026-03-08T05:00:00.000Z",
      to: "2026-03-09T03:59:59.999Z",
      label: "8 Mar 2026",
    });
  });

  it("falls back to UTC for an unknown time zone", () => {
    expect(normalizeTimeZone("Not/AZone")).toBe("UTC");
    const now = new Date("2026-11-11T23:30:00.000Z");
    expect(resolveTimeRange("today", "Not/AZone", now)).toMatchObject({
      from: "2026-11-11T00:00:00.000Z",
      to: "2026-11-11T23:59:59.999Z",
    });
  });
});
