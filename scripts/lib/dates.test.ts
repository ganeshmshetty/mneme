import { describe, expect, it } from "vitest";
import {
  endOfLocalDay,
  formatCivil,
  lastWeekWeekday,
  mostRecentMonday,
  recentNonFriday,
  startOfLocalDay,
  todayInZone,
  weekday,
  zonedTimeToUtc,
} from "./dates";
import { buildSeedPlan } from "../seed";

const IST = "Asia/Kolkata";

describe("seed date helpers", () => {
  it("resolves last Tuesday to the previous week, not yesterday", () => {
    const wednesday = { year: 2026, month: 11, day: 11 };
    expect(formatCivil(lastWeekWeekday(wednesday, 2))).toBe("2026-11-03");
    expect(formatCivil(mostRecentMonday(wednesday))).toBe("2026-11-09");
  });

  it("converts IST midnight and end-of-day to UTC", () => {
    const date = { year: 2026, month: 11, day: 3 };
    expect(startOfLocalDay(date, IST).toISOString()).toBe("2026-11-02T18:30:00.000Z");
    expect(endOfLocalDay(date, IST).toISOString()).toBe("2026-11-03T18:29:59.999Z");
    expect(zonedTimeToUtc(date, 10, 12, IST).toISOString()).toBe("2026-11-03T04:42:00.000Z");
  });

  it("skips Fridays when finding a recent day", () => {
    const saturday = { year: 2026, month: 11, day: 14 };
    const recent = recentNonFriday(saturday, 1);
    expect(formatCivil(recent)).toBe("2026-11-12");
    expect(weekday(recent)).not.toBe(5);
  });

  it("plans two weeks of history with no Friday chat", () => {
    const now = new Date("2026-11-11T06:00:00.000Z"); // 11:30 IST
    const plan = buildSeedPlan({ now, timeZone: IST });
    const dates = plan.chats.flatMap((chat) =>
      chat.turns.map((turn) => todayInZone(IST, turn.at)),
    );

    expect(dates).toHaveLength(11);
    expect(dates.some((date) => formatCivil(date) === "2026-11-03")).toBe(true);
    expect(dates.every((date) => weekday(date) !== 5)).toBe(true);
    expect(dates.every((date) => todayInZone(IST, now).year === date.year)).toBe(true);
  });
});
