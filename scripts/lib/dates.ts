/**
 * Small civil-date helpers for the seed script.
 *
 * Seed dates are authored in a local time zone (Asia/Kolkata by default) and
 * stored as UTC ISO strings, matching the rule in AGENTS.md. These helpers are
 * deliberately narrow: weekday math for relative fixtures, and local-midnight
 * ranges for recalled days. Natural-language date parsing still belongs to the
 * agent's resolve-time step, not here.
 */

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

const DAY_MS = 86_400_000;
const FRIDAY = 5;

function part(parts: Intl.DateTimeFormatPart[], type: string): number {
  const value = parts.find((item) => item.type === type)?.value;
  if (!value) throw new Error(`Could not read ${type} from a formatted date.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${type} value: ${value}`);
  return parsed;
}

function zonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  return {
    year: part(parts, "year"),
    month: part(parts, "month"),
    day: part(parts, "day"),
    hour: part(parts, "hour"),
    minute: part(parts, "minute"),
    second: part(parts, "second"),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  // Intl's formatted parts only resolve to the second. Compare against a
  // whole-second timestamp so a .999 millisecond boundary does not leak into
  // the offset and shift the result by almost a second.
  const wholeSecond = Math.floor(date.getTime() / 1000) * 1000;
  const parts = zonedParts(new Date(wholeSecond), timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - wholeSecond;
}

export function todayInZone(timeZone: string, now = new Date()): CivilDate {
  const parts = zonedParts(now, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** 0 = Sunday, 1 = Monday, ... 5 = Friday, 6 = Saturday. */
export function weekday(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function compareCivil(a: CivilDate, b: CivilDate): number {
  return Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
}

export function isSameCivil(a: CivilDate, b: CivilDate): boolean {
  return compareCivil(a, b) === 0;
}

export function formatCivil(date: CivilDate): string {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}

/** The most recent occurrence of a weekday. Today counts when it matches. */
export function mostRecentWeekday(today: CivilDate, target: number): CivilDate {
  const delta = (weekday(today) - target + 7) % 7;
  return addDays(today, -delta);
}

/**
 * The occurrence of a weekday in the previous calendar week (weeks start on
 * Monday). "Last Tuesday" on Wednesday 11 November therefore means 3 November,
 * not yesterday, which is the reading the README examples use.
 */
export function lastWeekWeekday(today: CivilDate, target: number): CivilDate {
  const recent = mostRecentWeekday(today, target);
  const monday = mostRecentWeekday(today, 1);
  return compareCivil(recent, monday) >= 0 ? addDays(recent, -7) : recent;
}

/** Go back N days, skipping Fridays. The seed history has no Friday chats. */
export function recentNonFriday(today: CivilDate, daysBack: number): CivilDate {
  let date = addDays(today, -daysBack);
  while (weekday(date) === FRIDAY) {
    date = addDays(date, -1);
  }
  return date;
}

/** Interpret a wall-clock time in `timeZone` and return the corresponding UTC instant. */
export function zonedTimeToUtc(
  date: CivilDate,
  hour: number,
  minute: number,
  timeZone: string,
  second = 0,
  millisecond = 0,
): Date {
  const guess = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    hour,
    minute,
    second,
    millisecond,
  );
  let timestamp = guess - timeZoneOffsetMs(new Date(guess), timeZone);
  // A second pass settles dates that fall near a DST transition.
  timestamp = guess - timeZoneOffsetMs(new Date(timestamp), timeZone);
  return new Date(timestamp);
}

export function startOfLocalDay(date: CivilDate, timeZone: string): Date {
  return zonedTimeToUtc(date, 0, 0, timeZone);
}

export function endOfLocalDay(date: CivilDate, timeZone: string): Date {
  return zonedTimeToUtc(date, 23, 59, timeZone, 59, 999);
}

/**
 * A timestamp at the given local wall-clock time, clamped so a same-day fixture
 * is never in the future when the seed runs early in the morning.
 */
export function atLocalTime(
  date: CivilDate,
  hour: number,
  minute: number,
  timeZone: string,
  now: Date,
): Date {
  const nominal = zonedTimeToUtc(date, hour, minute, timeZone);
  const dayStart = startOfLocalDay(date, timeZone);
  const latest = Math.max(dayStart.getTime(), now.getTime() - 5 * 60_000);
  return new Date(Math.min(nominal.getTime(), latest));
}

export function isoDayRange(date: CivilDate, timeZone: string): { from: string; to: string } {
  return {
    from: startOfLocalDay(date, timeZone).toISOString(),
    to: endOfLocalDay(date, timeZone).toISOString(),
  };
}

/**
 * Most recent Monday, used for "On Monday we shortlisted..." so the example
 * works whenever the seed is run.
 */
export function mostRecentMonday(today: CivilDate): CivilDate {
  return mostRecentWeekday(today, 1);
}

export function mostRecentTuesday(today: CivilDate): CivilDate {
  return mostRecentWeekday(today, 2);
}

export function mostRecentThursday(today: CivilDate): CivilDate {
  return mostRecentWeekday(today, 4);
}

export function mostRecentSaturday(today: CivilDate): CivilDate {
  return mostRecentWeekday(today, 6);
}

export function mostRecentSunday(today: CivilDate): CivilDate {
  return mostRecentWeekday(today, 0);
}

export { DAY_MS };
