import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Source } from "../src/lib/agent/events";
import type { MemoryStore } from "../src/lib/memory/types";
import {
  addDays,
  atLocalTime,
  compareCivil,
  endOfLocalDay,
  formatCivil,
  isSameCivil,
  isoDayRange,
  lastWeekWeekday,
  mostRecentMonday,
  mostRecentSaturday,
  mostRecentSunday,
  mostRecentThursday,
  mostRecentTuesday,
  recentNonFriday,
  todayInZone,
  weekday,
  type CivilDate,
} from "./lib/dates";
import { loadLocalEnv } from "./lib/env";
import { loadMemoryStore } from "./lib/memory";

/**
 * Two weeks of sample history, anchored to the day the seed runs.
 *
 * Fixed: Tuesday 3 November 2026, the Postgres hosting comparison.
 * Relative: Monday's CRM shortlist, last Thursday's espresso follow-up, last
 * weekend's trip and laptop chats, and the latest Postgres/CRM re-checks.
 *
 * No chat is placed on a Friday, so "What did I ask you last Friday?" always
 * has an honest empty answer.
 *
 * Invariants this file relies on:
 * - Timestamps are authored in SEA_TIME_ZONE and stored as UTC.
 * - Every claim has a source URL.
 * - Superseding claims point at the claim they replace; old claims stay.
 */

export type SeedFixtureId =
  | "espresso-original"
  | "espresso-followup"
  | "postgres-original"
  | "postgres-last-tuesday"
  | "postgres-recheck"
  | "crm-shortlist"
  | "crm-recheck"
  | "london-trip"
  | "laptop";

export const SEED_FIXTURE_IDS: SeedFixtureId[] = [
  "espresso-original",
  "espresso-followup",
  "postgres-original",
  "postgres-last-tuesday",
  "postgres-recheck",
  "crm-shortlist",
  "crm-recheck",
  "london-trip",
  "laptop",
];

export const SEED_TIME_ZONE = "Asia/Kolkata";
const FIXED_POSTGRES_DATE: CivilDate = { year: 2026, month: 11, day: 3 };

interface SeedSourceSpec {
  key: string;
  url: string;
  title: string;
  publishedAt?: string;
  snippet?: string;
}

interface SeedClaimSpec {
  key: string;
  text: string;
  sourceKey: string;
  sourcePublishedAt?: string;
  validFrom?: string;
  supersedes?: string;
  isLatest?: boolean;
}

interface SeedTurnSpec {
  at: Date;
  userText: string;
  answerText: string;
  sources: SeedSourceSpec[];
  claims: SeedClaimSpec[];
  resolvedFrom?: string;
  resolvedTo?: string;
}

interface SeedChatSpec {
  fixture: SeedFixtureId;
  title: string;
  turns: SeedTurnSpec[];
}

export interface SeedPlan {
  timeZone: string;
  anchorDate: CivilDate;
  chats: SeedChatSpec[];
}

export interface SeedChatSummary {
  fixture: SeedFixtureId;
  chatId: string;
  title: string;
  dates: string[];
  turns: number;
  claims: number;
}

export interface SeedSummary {
  timeZone: string;
  anchorDate: string;
  chats: SeedChatSummary[];
  totalTurns: number;
  totalClaims: number;
}

export interface SeedOptions {
  now?: Date;
  timeZone?: string;
  /** Reset first so the script is safe to rerun. Defaults to true. */
  reset?: boolean;
}

function source(spec: SeedSourceSpec, fixture: string, turnIndex: number): Source {
  const domain = new URL(spec.url).hostname.replace(/^www\./, "");
  return {
    id: `src_${fixture}_${turnIndex}_${spec.key}`,
    url: spec.url,
    title: spec.title,
    domain,
    publishedAt: spec.publishedAt,
    snippet: spec.snippet,
  };
}

function textSource(
  key: string,
  url: string,
  title: string,
  publishedAt: string,
  snippet: string,
): SeedSourceSpec {
  return { key, url, title, publishedAt, snippet };
}

export function buildSeedPlan(options: SeedOptions = {}): SeedPlan {
  const timeZone = options.timeZone ?? process.env.SEED_TIME_ZONE ?? SEED_TIME_ZONE;
  const now = options.now ?? new Date();
  const today = todayInZone(timeZone, now);

  const lastMonday = mostRecentMonday(today);
  const lastTuesday = lastWeekWeekday(today, 2);
  const lastThursday = mostRecentThursday(today);
  const lastSaturday = mostRecentSaturday(today);
  const lastSunday = mostRecentSunday(today);
  const recheckDay = recentNonFriday(today, 1);
  // resolve-time reads "last Tuesday" as the most recent Tuesday. Put the
  // Postgres re-check there so the README question always has a Postgres chat
  // to find, regardless of how "last Tuesday" is read.
  const postgresRecheckDay = mostRecentTuesday(today);
  const previousThursday = addDays(lastThursday, -7);

  const crmRecheckDay =
    compareCivil(recheckDay, lastMonday) > 0 ? recheckDay : lastMonday;

  const espressoOriginalOne = atLocalTime(previousThursday, 19, 35, timeZone, now);
  const espressoOriginalTwo = atLocalTime(previousThursday, 19, 52, timeZone, now);
  const espressoFollowupAt = atLocalTime(lastThursday, 8, 20, timeZone, now);
  const laptopAt = atLocalTime(lastSaturday, 11, 10, timeZone, now);
  const londonOne = atLocalTime(lastSunday, 16, 20, timeZone, now);
  const londonTwo = atLocalTime(lastSunday, 17, 5, timeZone, now);
  const londonThree = atLocalTime(lastSunday, 17, 22, timeZone, now);
  const crmShortlistAt = atLocalTime(lastMonday, 9, 40, timeZone, now);
  const crmRecheckAt = atLocalTime(crmRecheckDay, 11, 25, timeZone, now);
  const postgresOriginalAt = atLocalTime(FIXED_POSTGRES_DATE, 10, 12, timeZone, now);
  const postgresRecheckAt = atLocalTime(postgresRecheckDay, 9, 4, timeZone, now);

  const previousThursdayRange = isoDayRange(previousThursday, timeZone);
  const postgresRange = isoDayRange(FIXED_POSTGRES_DATE, timeZone);
  const crmRange = {
    from: isoDayRange(lastMonday, timeZone).from,
    to: endOfLocalDay(crmRecheckDay, timeZone).toISOString(),
  };
  const postgresRecheckRange = {
    from: postgresRange.from,
    to: endOfLocalDay(postgresRecheckDay, timeZone).toISOString(),
  };

  const chats: SeedChatSpec[] = [
    {
      fixture: "espresso-original",
      title: "Espresso machine shortlist",
      turns: [
        {
          at: espressoOriginalOne,
          userText:
            "I'm looking at a home espresso machine for under ₹60,000. Is the Breville Bambino Plus a good buy?",
          answerText:
            "Yes, at that budget the Breville Bambino Plus is the usual pick. It has a 54 mm portafilter and reaches brew temperature in about 3 seconds, and it sells for around ₹38,000 in India. Keep the rest of the budget for a burr grinder.",
          sources: [
            textSource(
              "breville-india",
              "https://www.breville.in/products/bambino-plus",
              "Bambino Plus — Breville India",
              "2026-10-20",
              "Bambino Plus with 54 mm portafilter and 3 second heat-up.",
            ),
            textSource(
              "breville-spec",
              "https://www.breville.com/en-us/product/bambino-plus",
              "Bambino Plus — Breville",
              "2026-09-12",
              "54 mm portafilter and fast heat-up.",
            ),
          ],
          claims: [
            {
              key: "bambino-price",
              text: "The Breville Bambino Plus sells for around ₹38,000 in India.",
              sourceKey: "breville-india",
              sourcePublishedAt: "2026-10-20",
              validFrom: "2026-10-20",
            },
            {
              key: "bambino-heat",
              text: "The Breville Bambino Plus reaches brew temperature in about 3 seconds.",
              sourceKey: "breville-spec",
              sourcePublishedAt: "2026-09-12",
              validFrom: "2026-09-12",
            },
          ],
        },
        {
          at: espressoOriginalTwo,
          userText: "Which grinder should I pair with it?",
          answerText:
            "The Baratza Encore ESP. It has 40 grind settings, with the finer half aimed at espresso, and it costs about ₹20,000 in India. Machine plus grinder comes to roughly ₹58,000, so you stay inside the ₹60,000 budget before tax.",
          sources: [
            textSource(
              "encore",
              "https://baratza.com/grinder/encore-esp/",
              "Encore ESP — Baratza",
              "2026-09-30",
              "40 grind settings, designed for espresso.",
            ),
          ],
          claims: [
            {
              key: "encore-settings",
              text: "The Baratza Encore ESP has 40 grind settings.",
              sourceKey: "encore",
              sourcePublishedAt: "2026-09-30",
              validFrom: "2026-09-30",
            },
            {
              key: "encore-price",
              text: "The Baratza Encore ESP costs about ₹20,000 in India.",
              sourceKey: "encore",
              sourcePublishedAt: "2026-09-30",
              validFrom: "2026-09-30",
            },
          ],
        },
      ],
    },
    {
      fixture: "postgres-original",
      title: "Postgres hosting pricing",
      turns: [
        {
          at: postgresOriginalAt,
          userText:
            "I'm picking a Postgres host for a side project. Compare Neon, Supabase and Crunchy Bridge on price.",
          answerText:
            "At list price for a small side project: Neon's Launch plan is $19/month, Supabase Pro is $25/month, and Crunchy Bridge's Hobby plan is $30/month. Neon is the cheapest of the three; Supabase bundles more around the database.",
          sources: [
            textSource(
              "neon",
              "https://neon.tech/pricing",
              "Pricing — Neon",
              "2026-11-01",
              "Launch plan: $19/month.",
            ),
            textSource(
              "supabase",
              "https://supabase.com/pricing",
              "Pricing — Supabase",
              "2026-10-28",
              "Pro plan: $25/month.",
            ),
            textSource(
              "crunchy",
              "https://www.crunchybridge.com/pricing",
              "Pricing — Crunchy Bridge",
              "2026-10-30",
              "Hobby plan: $30/month.",
            ),
          ],
          claims: [
            {
              key: "neon-old",
              text: "Neon's Launch plan costs $19 per month.",
              sourceKey: "neon",
              sourcePublishedAt: "2026-11-01",
              validFrom: "2026-11-01",
            },
            {
              key: "supabase",
              text: "Supabase's Pro plan costs $25 per month.",
              sourceKey: "supabase",
              sourcePublishedAt: "2026-10-28",
              validFrom: "2026-10-28",
            },
            {
              key: "crunchy",
              text: "Crunchy Bridge's Hobby plan costs $30 per month.",
              sourceKey: "crunchy",
              sourcePublishedAt: "2026-10-30",
              validFrom: "2026-10-30",
            },
          ],
        },
      ],
    },
    {
      fixture: "postgres-last-tuesday",
      title: "Postgres hosting follow-up",
      turns: [
        {
          at: atLocalTime(lastTuesday, 10, 12, timeZone, now),
          userText:
            "I'm still comparing Postgres hosts for the side project. Is Neon still the cheapest of the three you looked at?",
          answerText:
            "At the prices I have, Neon Launch is still the cheapest at $19/month. Supabase Pro is $25/month and Crunchy Bridge Hobby is $30/month. I'd re-check the pricing pages before you commit.",
          sources: [
            textSource(
              "neon",
              "https://neon.tech/pricing",
              "Pricing — Neon",
              "2026-11-01",
              "Launch plan: $19/month.",
            ),
            textSource(
              "supabase",
              "https://supabase.com/pricing",
              "Pricing — Supabase",
              "2026-10-28",
              "Pro plan: $25/month.",
            ),
            textSource(
              "crunchy",
              "https://www.crunchybridge.com/pricing",
              "Pricing — Crunchy Bridge",
              "2026-10-30",
              "Hobby plan: $30/month.",
            ),
          ],
          claims: [],
        },
      ],
    },
    {
      fixture: "espresso-followup",
      title: "Espresso grinder follow-up",
      turns: [
        {
          at: espressoFollowupAt,
          userText:
            "I'm still deciding on that espresso setup from last week. Is the Baratza Encore ESP good for dark roasts?",
          answerText:
            "Yes. The Encore ESP has 40 grind settings and uses 40 mm conical steel burrs, so it handles dark-roast espresso well. Start around setting 12–15, then adjust finer if the shot runs fast. It is still the grinder I would pair with the Bambino Plus.",
          sources: [
            textSource(
              "encore",
              "https://baratza.com/grinder/encore-esp/",
              "Encore ESP — Baratza",
              "2026-09-30",
              "40 mm conical steel burrs and 40 grind settings.",
            ),
          ],
          claims: [
            {
              key: "encore-burrs",
              text: "The Baratza Encore ESP uses 40 mm conical steel burrs.",
              sourceKey: "encore",
              sourcePublishedAt: "2026-09-30",
              validFrom: "2026-09-30",
            },
          ],
          resolvedFrom: previousThursdayRange.from,
          resolvedTo: previousThursdayRange.to,
        },
      ],
    },
    {
      fixture: "laptop",
      title: "MacBook Air for travel",
      turns: [
        {
          at: laptopAt,
          userText:
            "My old laptop is dying. Is the 13-inch MacBook Air still the best small laptop for travel?",
          answerText:
            "For travel, yes. The 13-inch MacBook Air with M4 starts at $999, weighs 2.7 pounds, and gets up to 18 hours of battery life. If you run heavy local models, look at a 14-inch MacBook Pro instead.",
          sources: [
            textSource(
              "apple-air",
              "https://www.apple.com/macbook-air/",
              "MacBook Air — Apple",
              "2026-09-09",
              "13-inch MacBook Air with M4: from $999, 2.7 pounds, up to 18 hours battery.",
            ),
          ],
          claims: [
            {
              key: "air-price",
              text: "The 13-inch MacBook Air with M4 starts at $999.",
              sourceKey: "apple-air",
              sourcePublishedAt: "2026-09-09",
              validFrom: "2026-09-09",
            },
            {
              key: "air-battery",
              text: "The 13-inch MacBook Air has up to 18 hours of battery life.",
              sourceKey: "apple-air",
              sourcePublishedAt: "2026-09-09",
              validFrom: "2026-09-09",
            },
            {
              key: "air-weight",
              text: "The 13-inch MacBook Air weighs 2.7 pounds.",
              sourceKey: "apple-air",
              sourcePublishedAt: "2026-09-09",
              validFrom: "2026-09-09",
            },
          ],
        },
      ],
    },
    {
      fixture: "london-trip",
      title: "London trip planning",
      turns: [
        {
          at: londonOne,
          userText:
            "We're in London for four days in December. What's the fastest way from Heathrow to the hotel, and which area should we stay in?",
          answerText:
            "Take the Elizabeth line from Heathrow into central London; it takes about 30 minutes to Paddington or Tottenham Court Road. Stay in Bloomsbury or Fitzrovia if you want to walk to the British Museum and still have good Tube links.",
          sources: [
            textSource(
              "tfl-elizabeth",
              "https://tfl.gov.uk/modes/elizabeth-line/",
              "Elizabeth line — Transport for London",
              "2026-10-12",
              "Elizabeth line connects Heathrow with central London.",
            ),
            textSource(
              "visit-london",
              "https://www.visitlondon.com/things-to-do/area-guide/bloomsbury",
              "Bloomsbury area guide — Visit London",
              "2026-09-21",
              "Bloomsbury is within walking distance of the British Museum.",
            ),
          ],
          claims: [
            {
              key: "elizabeth",
              text: "The Elizabeth line takes about 30 minutes from Heathrow to central London.",
              sourceKey: "tfl-elizabeth",
              sourcePublishedAt: "2026-10-12",
              validFrom: "2026-10-12",
            },
            {
              key: "bloomsbury",
              text: "Bloomsbury and Fitzrovia are within walking distance of the British Museum.",
              sourceKey: "visit-london",
              sourcePublishedAt: "2026-09-21",
              validFrom: "2026-09-21",
            },
          ],
        },
        {
          at: londonTwo,
          userText: "What about the Tower of London? Is it worth booking ahead?",
          answerText:
            "Yes, book ahead. Adult admission is £34.80 online, and mornings are quieter. Book direct with Historic Royal Palaces rather than a reseller.",
          sources: [
            textSource(
              "hrp-tower",
              "https://www.hrp.org.uk/tower-of-london/visit/tickets-and-prices/",
              "Tower of London tickets — Historic Royal Palaces",
              "2026-10-05",
              "Adult online admission: £34.80.",
            ),
          ],
          claims: [
            {
              key: "tower-price",
              text: "Tower of London adult admission is £34.80 when booked online.",
              sourceKey: "hrp-tower",
              sourcePublishedAt: "2026-10-05",
              validFrom: "2026-10-05",
            },
          ],
        },
        {
          at: londonThree,
          userText: "And how long is the train to Edinburgh?",
          answerText:
            "The direct LNER train from London King's Cross to Edinburgh Waverley takes about 4 hours 20 minutes.",
          sources: [
            textSource(
              "lner",
              "https://www.lner.co.uk/travel-information/journey-information/",
              "Journey information — LNER",
              "2026-09-28",
              "Direct London to Edinburgh journeys take around 4 hours 20 minutes.",
            ),
          ],
          claims: [
            {
              key: "edinburgh-train",
              text: "The direct LNER train from London King's Cross to Edinburgh Waverley takes about 4 hours 20 minutes.",
              sourceKey: "lner",
              sourcePublishedAt: "2026-09-28",
              validFrom: "2026-09-28",
            },
          ],
        },
      ],
    },
    {
      fixture: "crm-shortlist",
      title: "CRM shortlist for a 20-person team",
      turns: [
        {
          at: crmShortlistAt,
          userText:
            "We're a 20-person sales team. Shortlist five CRM tools — HubSpot, Pipedrive, Close, Attio and Folk — and tell me the entry price per user for each.",
          answerText:
            "For 20 users, here is the entry tier for each: HubSpot Starter $15/user/month, Pipedrive Essential $14, Close Starter $29, Attio Plus $29, and Folk Standard $20. At 20 users that is roughly $280–$580 per month. Pipedrive is the cheapest; HubSpot and Folk are in the middle; Close and Attio are the most expensive.",
          sources: [
            textSource(
              "hubspot",
              "https://www.hubspot.com/pricing/crm",
              "CRM pricing — HubSpot",
              "2026-11-02",
              "Starter: $15 per user per month with annual billing.",
            ),
            textSource(
              "pipedrive",
              "https://www.pipedrive.com/en/pricing",
              "Pricing — Pipedrive",
              "2026-11-01",
              "Essential: $14 per user per month with annual billing.",
            ),
            textSource(
              "close",
              "https://close.com/pricing/",
              "Pricing — Close",
              "2026-10-30",
              "Starter: $29 per user per month.",
            ),
            textSource(
              "attio",
              "https://attio.com/pricing",
              "Pricing — Attio",
              "2026-11-04",
              "Plus: $29 per user per month.",
            ),
            textSource(
              "folk",
              "https://folk.app/pricing",
              "Pricing — Folk",
              "2026-10-29",
              "Standard: $20 per user per month.",
            ),
          ],
          claims: [
            {
              key: "hubspot-old",
              text: "HubSpot Starter costs $15 per user per month.",
              sourceKey: "hubspot",
              sourcePublishedAt: "2026-11-02",
              validFrom: "2026-11-02",
            },
            {
              key: "pipedrive-price",
              text: "Pipedrive Essential costs $14 per user per month.",
              sourceKey: "pipedrive",
              sourcePublishedAt: "2026-11-01",
              validFrom: "2026-11-01",
            },
            {
              key: "close",
              text: "Close Starter costs $29 per user per month.",
              sourceKey: "close",
              sourcePublishedAt: "2026-10-30",
              validFrom: "2026-10-30",
            },
            {
              key: "attio-old",
              text: "Attio Plus costs $29 per user per month.",
              sourceKey: "attio",
              sourcePublishedAt: "2026-11-04",
              validFrom: "2026-11-04",
            },
            {
              key: "folk",
              text: "Folk Standard costs $20 per user per month.",
              sourceKey: "folk",
              sourcePublishedAt: "2026-10-29",
              validFrom: "2026-10-29",
            },
          ],
        },
      ],
    },
    {
      fixture: "postgres-recheck",
      title: "Postgres pricing re-check",
      turns: [
        {
          at: postgresRecheckAt,
          userText:
            "Has Neon's pricing changed since you compared Postgres hosts for me last week?",
          answerText:
            "Yes. Neon's Launch plan is now $25/month, up from $19 when I checked on 3 November. Supabase Pro is still $25/month, so Neon and Supabase now cost the same at list price.",
          sources: [
            textSource(
              "neon",
              "https://neon.tech/pricing",
              "Pricing — Neon",
              formatCivil(postgresRecheckDay),
              "Launch plan: $25/month.",
            ),
          ],
          claims: [
            {
              key: "neon-new",
              text: "Neon's Launch plan costs $25 per month.",
              sourceKey: "neon",
              sourcePublishedAt: formatCivil(postgresRecheckDay),
              validFrom: formatCivil(postgresRecheckDay),
              supersedes: "neon-old",
            },
          ],
          resolvedFrom: postgresRecheckRange.from,
          resolvedTo: postgresRecheckRange.to,
        },
      ],
    },
    {
      fixture: "crm-recheck",
      title: "CRM pricing re-check",
      turns: [
        {
          at: crmRecheckAt,
          userText:
            "On Monday we shortlisted five CRM tools for our 20-person sales team. Has any of them changed pricing or shipped something big since?",
          answerText:
            "Two prices moved and Pipedrive shipped something: HubSpot Starter is now $20/user/month, up from $15; Attio Plus is now $34, up from $29; and Pipedrive launched an AI sales assistant included in its Essential plan. Close Starter ($29) and Folk Standard ($20) are unchanged.",
          sources: [
            textSource(
              "hubspot",
              "https://www.hubspot.com/pricing/crm",
              "CRM pricing — HubSpot",
              formatCivil(crmRecheckDay),
              "Starter: $20 per user per month with annual billing.",
            ),
            textSource(
              "attio",
              "https://attio.com/pricing",
              "Pricing — Attio",
              formatCivil(crmRecheckDay),
              "Plus: $34 per user per month.",
            ),
            textSource(
              "pipedrive-ai",
              "https://www.pipedrive.com/en/blog/ai-sales-assistant",
              "AI sales assistant — Pipedrive",
              formatCivil(addDays(crmRecheckDay, -5)),
              "Pipedrive's AI sales assistant is included in the Essential plan.",
            ),
          ],
          claims: [
            {
              key: "hubspot-new",
              text: "HubSpot Starter costs $20 per user per month.",
              sourceKey: "hubspot",
              sourcePublishedAt: formatCivil(crmRecheckDay),
              validFrom: formatCivil(crmRecheckDay),
              supersedes: "hubspot-old",
            },
            {
              key: "attio-new",
              text: "Attio Plus costs $34 per user per month.",
              sourceKey: "attio",
              sourcePublishedAt: formatCivil(crmRecheckDay),
              validFrom: formatCivil(crmRecheckDay),
              supersedes: "attio-old",
            },
            {
              key: "pipedrive-ai",
              text: "Pipedrive launched an AI sales assistant included in its Essential plan.",
              sourceKey: "pipedrive-ai",
              sourcePublishedAt: formatCivil(addDays(crmRecheckDay, -5)),
              validFrom: formatCivil(addDays(crmRecheckDay, -5)),
            },
          ],
          resolvedFrom: crmRange.from,
          resolvedTo: crmRange.to,
        },
      ],
    },
  ];

  // Never place a chat on a Friday: the abstention examples depend on Fridays
  // being empty. The fixed 3 November date is a Tuesday.
  for (const chat of chats) {
    for (const turn of chat.turns) {
      const local = todayInZone(timeZone, turn.at);
      if (weekday(local) === 5) {
        throw new Error(
          `Seed fixture ${chat.fixture} lands on a Friday (${formatCivil(local)}).`,
        );
      }
    }
  }

  // The optional last-Tuesday follow-up only exists when it is not the fixed
  // 3 November chat. It keeps the README example working on other weeks.
  const lastTuesdayChat = chats.find((chat) => chat.fixture === "postgres-last-tuesday");
  if (
    lastTuesdayChat &&
    (isSameCivil(lastTuesday, FIXED_POSTGRES_DATE) ||
      isSameCivil(lastTuesday, postgresRecheckDay))
  ) {
    chats.splice(chats.indexOf(lastTuesdayChat), 1);
  }

  return { timeZone, anchorDate: today, chats };
}

function sourceForTurn(
  spec: SeedSourceSpec,
  fixture: SeedFixtureId,
  turnIndex: number,
): Source {
  return source(spec, fixture, turnIndex);
}

export async function seedMemory(
  store: MemoryStore,
  options: SeedOptions = {},
): Promise<SeedSummary> {
  const plan = buildSeedPlan(options);
  const reset = options.reset ?? true;
  if (reset) await store.reset();

  const claimIds = new Map<string, string>();
  const summaries: SeedChatSummary[] = [];
  let totalTurns = 0;
  let totalClaims = 0;

  for (const chatSpec of plan.chats) {
    const chat = await store.createChat(chatSpec.title);
    const dates: string[] = [];
    let chatClaims = 0;

    for (const [turnIndex, turn] of chatSpec.turns.entries()) {
      dates.push(formatCivil(todayInZone(plan.timeZone, turn.at)));

      const sources = turn.sources.map((item) =>
        sourceForTurn(item, chatSpec.fixture, turnIndex),
      );
      const sourcesByKey = new Map(turn.sources.map((item, index) => [item.key, sources[index]]));

      const userMessageId = `msg_seed_${randomUUID()}`;
      const assistantMessageId = `msg_seed_${randomUUID()}`;
      const createdAt = turn.at.toISOString();

      const claims = turn.claims.map((claim) => {
        const claimSource = sourcesByKey.get(claim.sourceKey);
        if (!claimSource) {
          throw new Error(
            `Claim ${claim.key} references missing source ${claim.sourceKey} in ${chatSpec.fixture}.`,
          );
        }

        const supersedesClaimId = claim.supersedes ? claimIds.get(claim.supersedes) : undefined;
        if (claim.supersedes && !supersedesClaimId) {
          throw new Error(
            `Claim ${claim.key} supersedes ${claim.supersedes}, but that claim was not saved first.`,
          );
        }

        return {
          text: claim.text,
          sourceUrl: claimSource.url,
          sourceTitle: claimSource.title,
          sourcePublishedAt: claim.sourcePublishedAt,
          assertedAt: createdAt,
          validFrom:
            claim.validFrom ?? formatCivil(todayInZone(plan.timeZone, turn.at)),
          supersedesClaimId,
          isLatest: claim.isLatest ?? true,
        };
      });

      const saved = await store.saveTurn({
        chatId: chat.id,
        userMessage: {
          id: userMessageId,
          role: "user",
          content: turn.userText,
          createdAt,
        },
        assistantMessage: {
          id: assistantMessageId,
          role: "assistant",
          content: turn.answerText,
          createdAt,
          modelId: "seed-fixture",
          route: "direct",
          format: "markdown",
          sources,
        },
        episode: {
          userText: turn.userText,
          answerText: turn.answerText,
          createdAt,
          userMessageId,
          assistantMessageId,
          timezone: plan.timeZone,
          resolvedFrom: turn.resolvedFrom,
          resolvedTo: turn.resolvedTo,
        },
        claims,
      });

      const savedByText = new Map(saved.claims.map((claim) => [claim.text, claim]));
      turn.claims.forEach((claim, index) => {
        const stored = savedByText.get(claim.text) ?? saved.claims[index];
        if (!stored) {
          throw new Error(
            `saveTurn did not return the stored claim for ${claim.key} in ${chatSpec.fixture}.`,
          );
        }
        claimIds.set(claim.key, stored.id);
      });

      chatClaims += saved.claims.length;
      totalTurns += 1;
    }

    totalClaims += chatClaims;
    summaries.push({
      fixture: chatSpec.fixture,
      chatId: chat.id,
      title: chatSpec.title,
      dates,
      turns: chatSpec.turns.length,
      claims: chatClaims,
    });
  }

  return {
    timeZone: plan.timeZone,
    anchorDate: formatCivil(plan.anchorDate),
    chats: summaries,
    totalTurns,
    totalClaims,
  };
}

export function formatSeedPlan(plan: SeedPlan): string {
  const rows = plan.chats.map((chat) => {
    const dates = [...new Set(chat.turns.map((turn) => formatCivil(todayInZone(plan.timeZone, turn.at))))];
    return `  ${chat.fixture.padEnd(24)} ${dates.join(", ").padEnd(12)} ${chat.title} (${chat.turns.length} turn${chat.turns.length === 1 ? "" : "s"})`;
  });
  return [
    `Seed plan for ${plan.timeZone}, anchored to ${formatCivil(plan.anchorDate)}.`,
    "  No Friday chats.",
    ...rows,
  ].join("\n");
}

function printSummary(summary: SeedSummary): void {
  console.log(`Seeded ${summary.chats.length} chats in ${summary.timeZone}.`);
  console.log(`Anchor date: ${summary.anchorDate}`);
  for (const chat of summary.chats) {
    console.log(
      `  ${chat.dates.join(", ").padEnd(12)} ${chat.title} — ${chat.turns} turn${chat.turns === 1 ? "" : "s"}, ${chat.claims} claim${chat.claims === 1 ? "" : "s"}`,
    );
  }
  console.log(
    `Total: ${summary.totalTurns} turns, ${summary.totalClaims} claims. Memory was reset first.`,
  );
  console.log("Saved keys in data/keys.json were not touched.");
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      [
        "Usage: npm run seed [-- --dry-run] [--timezone Asia/Kolkata]",
        "",
        "Loads two weeks of sample history. Resets memory first, so it is safe to rerun.",
        "Keys in data/keys.json are never touched.",
      ].join("\n"),
    );
    return;
  }

  const timeZoneIndex = args.indexOf("--timezone");
  const timeZone =
    timeZoneIndex >= 0 ? args[timeZoneIndex + 1] : process.env.SEED_TIME_ZONE ?? SEED_TIME_ZONE;

  if (args.includes("--dry-run")) {
    console.log(formatSeedPlan(buildSeedPlan({ timeZone })));
    return;
  }

  const store = await loadMemoryStore();
  try {
    const summary = await seedMemory(store, { timeZone });
    printSummary(summary);
  } finally {
    store.close();
  }
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
