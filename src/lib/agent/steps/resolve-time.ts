import * as chrono from "chrono-node";

/**
 * Resolves the date phrase in a user message to an exact UTC interval in the
 * time zone sent with the request. The model never computes dates: chrono-node
 * finds the phrase, and this module turns its calendar components into UTC.
 */
export interface ResolvedTimeRange {
  from: string;
  to: string;
  timezone: string;
  label: string;
  ambiguous: boolean;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

interface WallTime extends CalendarDate {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

export function normalizeTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

export function getWallTime(date: Date, timeZone: string): WallTime {
  const parts: Record<string, string> = {};
  for (const part of wallFormatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    millisecond: date.getMilliseconds(),
  };
}

function wallToUtcMs(wall: WallTime): number {
  return Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
    0,
  );
}

/**
 * Converts a wall-clock time in `timeZone` to a UTC instant. Two passes are
 * enough for every real offset, including DST transitions.
 */
export function wallTimeToUtc(wall: WallTime, timeZone: string): Date {
  const target = wallToUtcMs(wall);
  let guess = target;
  for (let pass = 0; pass < 4; pass += 1) {
    const actual = getWallTime(new Date(guess), timeZone);
    const diff = target - wallToUtcMs(actual);
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function startOfWeek(date: CalendarDate): CalendarDate {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

function formatDay(date: CalendarDate, includeYear = true): string {
  const month = MONTHS[date.month - 1] ?? "";
  return includeYear
    ? `${date.day} ${month} ${date.year}`
    : `${date.day} ${month}`;
}

function formatDayRange(from: CalendarDate, to: CalendarDate): string {
  if (from.year === to.year && from.month === to.month && from.day === to.day) {
    return formatDay(from);
  }
  if (from.year === to.year && from.month === to.month) {
    return `${from.day}–${to.day} ${MONTHS[from.month - 1]} ${from.year}`;
  }
  if (from.year === to.year) {
    return `${formatDay(from, false)} – ${formatDay(to)}`;
  }
  return `${formatDay(from)} – ${formatDay(to)}`;
}

function formatMonth(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

function midnight(date: CalendarDate): WallTime {
  return { ...date, hour: 0, minute: 0, second: 0, millisecond: 0 };
}

function rangeForDays(
  fromDate: CalendarDate,
  toDate: CalendarDate,
  timeZone: string,
  ambiguous: boolean,
  label = formatDayRange(fromDate, toDate),
): ResolvedTimeRange {
  const from = wallTimeToUtc(midnight(fromDate), timeZone);
  const nextDay = addDays(toDate, 1);
  const to = new Date(wallTimeToUtc(midnight(nextDay), timeZone).getTime() - 1);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: timeZone,
    label,
    ambiguous,
  };
}

function monthRange(year: number, month: number, timeZone: string, ambiguous: boolean): ResolvedTimeRange {
  const fromDate: CalendarDate = { year, month, day: 1 };
  const nextDate: CalendarDate =
    month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 };
  const from = wallTimeToUtc(midnight(fromDate), timeZone);
  const to = new Date(wallTimeToUtc(midnight(nextDate), timeZone).getTime() - 1);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: timeZone,
    label: formatMonth(year, month),
    ambiguous,
  };
}

function yearRange(year: number, timeZone: string, ambiguous: boolean): ResolvedTimeRange {
  const from = wallTimeToUtc(midnight({ year, month: 1, day: 1 }), timeZone);
  const to = new Date(
    wallTimeToUtc(midnight({ year: year + 1, month: 1, day: 1 }), timeZone).getTime() - 1,
  );
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: timeZone,
    label: String(year),
    ambiguous,
  };
}

function chronoReference(now: Date, timeZone: string): Date {
  const wall = getWallTime(now, timeZone);
  // The Date is built in the server's local time, but its calendar fields are
  // the user's wall clock, so chrono's relative arithmetic stays in that clock.
  return new Date(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, 0);
}

function parseChrono(text: string, now: Date, timeZone: string): chrono.ParsedResult[] {
  try {
    return chrono.parse(text, chronoReference(now, timeZone), { forwardDate: false });
  } catch {
    return [];
  }
}

function certaintyAmbiguous(
  text: string,
  start: chrono.ParsedComponents,
  end?: chrono.ParsedComponents,
): boolean {
  if (/\b(last|this|next|past|previous|yesterday|today|tomorrow|ago)\b/i.test(text)) {
    return false;
  }
  if (!start.isCertain("year")) return true;
  if (end && !end.isCertain("year")) return true;
  return false;
}

function dateFromParsed(date: Date): CalendarDate {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

function weekOverride(
  text: string,
  now: Date,
  timeZone: string,
): ResolvedTimeRange | null {
  const namedWeek = text.match(/\b(next|last|this|past|previous)\s+week\b/i);
  const wallNow = getWallTime(now, timeZone);

  if (namedWeek) {
    const word = namedWeek[1].toLowerCase();
    if (word === "past") {
      return rangeForDays(
        addDays(wallNow, -6),
        wallNow,
        timeZone,
        false,
        "Past 7 days",
      );
    }
    const offset = word === "next" ? 7 : word === "this" ? 0 : -7;
    const anchor = addDays(wallNow, offset);
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    return rangeForDays(start, end, timeZone, false);
  }

  const weekOf = text.match(/\bweek\s+of\s+(.+)$/i);
  if (weekOf) {
    const parsed = parseChrono(weekOf[1], now, timeZone)[0];
    if (!parsed) return null;
    const anchor = dateFromParsed(parsed.start.date());
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    return rangeForDays(
      start,
      end,
      timeZone,
      certaintyAmbiguous(text, parsed.start),
    );
  }

  return null;
}

const COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseCount(value: string): number | null {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  return COUNT_WORDS[value.toLowerCase()] ?? null;
}

function trailingDaysOverride(
  text: string,
  now: Date,
  timeZone: string,
): ResolvedTimeRange | null {
  const days = text.match(
    /\b(?:past|last|previous)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\b/i,
  );
  if (days) {
    const count = parseCount(days[1]);
    if (count) {
      const wallNow = getWallTime(now, timeZone);
      return rangeForDays(
        addDays(wallNow, -(count - 1)),
        wallNow,
        timeZone,
        false,
        `Past ${count} ${count === 1 ? "day" : "days"}`,
      );
    }
  }

  const weeks = text.match(
    /\b(?:past|last|previous)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+weeks?\b/i,
  );
  if (weeks) {
    const count = parseCount(weeks[1]);
    if (count) {
      const wallNow = getWallTime(now, timeZone);
      return rangeForDays(
        addDays(wallNow, -(count * 7 - 1)),
        wallNow,
        timeZone,
        false,
        `Past ${count} ${count === 1 ? "week" : "weeks"}`,
      );
    }
  }

  return null;
}

function monthOverride(
  text: string,
  now: Date,
  timeZone: string,
): ResolvedTimeRange | null {
  const match = text.match(/\b(this|last|next|previous)\s+month\b/i);
  if (!match) return null;
  const word = match[1].toLowerCase();
  const offset = word === "next" ? 1 : word === "this" ? 0 : -1;
  const wallNow = getWallTime(now, timeZone);
  const monthIndex = wallNow.month - 1 + offset;
  const year = wallNow.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12 + 1;
  return monthRange(year, month, timeZone, false);
}

function yearOverride(
  text: string,
  now: Date,
  timeZone: string,
): ResolvedTimeRange | null {
  const named = text.match(/\b(this|last|next|previous)\s+year\b/i);
  if (named) {
    const word = named[1].toLowerCase();
    const offset = word === "next" ? 1 : word === "this" ? 0 : -1;
    const wallNow = getWallTime(now, timeZone);
    return yearRange(wallNow.year + offset, timeZone, false);
  }
  const bare = text.match(/^\s*(?:in\s+)?(\d{4})\s*$/i);
  if (bare) return yearRange(Number(bare[1]), timeZone, false);
  return null;
}

function sinceOverride(
  text: string,
  parsed: chrono.ParsedResult,
  now: Date,
  timeZone: string,
): ResolvedTimeRange | null {
  if (!/\bsince\b/i.test(text)) return null;
  const start = dateFromParsed(parsed.start.date());
  const wallNow = getWallTime(now, timeZone);
  return rangeForDays(
    start,
    wallNow,
    timeZone,
    certaintyAmbiguous(text, parsed.start),
    `Since ${formatDay(start)}`,
  );
}

function timeWindow(
  parsed: chrono.ParsedResult,
  text: string,
  timeZone: string,
): ResolvedTimeRange | null {
  const start = parsed.start;
  if (!start.isCertain("hour")) return null;

  const date = start.date();
  const wall: WallTime = {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: start.isCertain("second") ? date.getSeconds() : 0,
    millisecond: 0,
  };
  // "3pm" marks the minute as certain even though the user only named an
  // hour, so only an explicit clock value (15:30) gets a minute-sized window.
  const hasExplicitMinutes = /:\d{2}\b/.test(text);
  const spanMs = hasExplicitMinutes ? 60_000 : 3_600_000;
  const from = wallTimeToUtc(wall, timeZone);
  const to = new Date(from.getTime() + spanMs - 1);
  const clock = `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
  const endClock = new Date(to.getTime());
  const endParts = getWallTime(endClock, timeZone);
  const endLabel = `${String(endParts.hour).padStart(2, "0")}:${String(endParts.minute).padStart(2, "0")}`;
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: timeZone,
    label: `${formatDay(wall)} ${clock}–${endLabel}`,
    ambiguous: certaintyAmbiguous(text, start),
  };
}

/**
 * Returns null when the message has no date phrase. The caller then recalls
 * across all of memory instead of a bounded range.
 */
export function resolveTimeRange(
  message: string,
  timeZoneInput: string | undefined,
  now: Date = new Date(),
): ResolvedTimeRange | null {
  const text = message.trim();
  if (!text) return null;

  const timeZone = normalizeTimeZone(timeZoneInput);

  const week = weekOverride(text, now, timeZone);
  if (week) return week;

  const trailing = trailingDaysOverride(text, now, timeZone);
  if (trailing) return trailing;

  const month = monthOverride(text, now, timeZone);
  if (month) return month;

  const year = yearOverride(text, now, timeZone);
  if (year) return year;

  const parsed = parseChrono(text, now, timeZone)[0];
  if (!parsed) return null;

  if (!parsed.start.isCertain("day") && parsed.start.isCertain("month")) {
    const date = parsed.start.date();
    return monthRange(
      date.getFullYear(),
      date.getMonth() + 1,
      timeZone,
      certaintyAmbiguous(text, parsed.start),
    );
  }

  if (!parsed.start.isCertain("month") && parsed.start.isCertain("year")) {
    const date = parsed.start.date();
    return yearRange(
      date.getFullYear(),
      timeZone,
      certaintyAmbiguous(text, parsed.start),
    );
  }

  const since = sinceOverride(text, parsed, now, timeZone);
  if (since) return since;

  if (parsed.end) {
    return rangeForDays(
      dateFromParsed(parsed.start.date()),
      dateFromParsed(parsed.end.date()),
      timeZone,
      certaintyAmbiguous(text, parsed.start, parsed.end),
    );
  }

  const clock = timeWindow(parsed, text, timeZone);
  if (clock) return clock;

  const day = dateFromParsed(parsed.start.date());
  return rangeForDays(
    day,
    day,
    timeZone,
    certaintyAmbiguous(text, parsed.start),
  );
}
