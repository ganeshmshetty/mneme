import {
  createLibrary,
  defineComponent,
  type PromptOptions,
} from "@openuidev/react-lang";
import { z } from "zod/v4";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
} from "lucide-react";
import { cn } from "cn";

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * OpenUI re-parses the program on every streamed chunk, so a component can be
 * rendered before its array prop has finished arriving. Treat a missing or
 * malformed list as empty instead of crashing the whole chat.
 */
function toList<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function toCells(row: unknown): string[] {
  const cells = Array.isArray(row)
    ? row
    : row && typeof row === "object"
      ? (row as { cells?: unknown }).cells
      : undefined;
  return Array.isArray(cells)
    ? cells.filter((cell): cell is string => typeof cell === "string")
    : [];
}

const Paragraph = defineComponent({
  name: "Paragraph",
  description: "One short paragraph of plain text. No Markdown.",
  props: z.object({
    text: z.string(),
  }),
  component: ({ props }) => (
    <p className="text-[0.95rem] leading-7 text-foreground/90">{props.text}</p>
  ),
});

const Bullets = defineComponent({
  name: "Bullets",
  description: "A short unordered list of plain-text items.",
  props: z.object({
    items: z.array(z.string()),
  }),
  component: ({ props }) => (
    <ul className="list-disc space-y-1.5 pl-5 text-[0.95rem] leading-6 text-foreground/90">
      {toList(props.items).map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  ),
});

const Facts = defineComponent({
  name: "Facts",
  description:
    "Two to six label/value pairs for one item, shown as a compact definition list.",
  props: z.object({
    items: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
      }),
    ),
  }),
  component: ({ props }) => (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {toList(props.items).map((item, index) => (
        <div key={index} className="min-w-0 border-t border-border/70 pt-2">
          <dt className="text-xs font-medium text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-0.5 text-[0.9rem] leading-6 text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  ),
});

const Table = defineComponent({
  name: "Table",
  description:
    "A compact comparison table for 2–5 products or options across the same attributes.",
  props: z.object({
    columns: z.array(z.string()).min(2).max(5),
    rows: z
      .array(
        z.object({
          cells: z.array(z.string()).min(1).max(5),
        }),
      )
      .min(1)
      .max(6),
    caption: z.string().optional(),
  }),
  component: ({ props }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        {props.caption ? (
          <caption className="pb-2 text-left text-xs text-muted-foreground">
            {props.caption}
          </caption>
        ) : null}
        <thead>
          <tr className="border-b border-border/80">
            {toList(props.columns).map((column, index) => (
              <th
                key={index}
                className="py-2 pr-4 font-medium text-muted-foreground last:pr-0"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {toList(props.rows).map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b border-border/60 last:border-0"
            >
              {toCells(row).map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    "py-2 pr-4 align-top text-[0.9rem] leading-6 text-foreground/90 last:pr-0",
                    cellIndex === 0 && "font-medium text-foreground",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
});

const Compare = defineComponent({
  name: "Compare",
  description:
    "A then-vs-now comparison for a changed or unchanged fact. Use for re-checks and before/after answers.",
  props: z.object({
    thenLabel: z.string(),
    thenValue: z.string(),
    nowLabel: z.string(),
    nowValue: z.string(),
    verdict: z.string(),
    thenDate: z.string().optional(),
    nowDate: z.string().optional(),
  }),
  component: ({ props }) => (
    <div className="rounded-xl border border-border/80 bg-muted/35 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">
            Then
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">{props.thenLabel}</div>
          <div className="text-lg tracking-tight text-foreground">{props.thenValue}</div>
          {props.thenDate ? (
            <div className="mt-1 text-xs text-muted-foreground">{props.thenDate}</div>
          ) : null}
        </div>
        <div className="min-w-0 border-t border-border/70 pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
          <div className="text-xs font-medium text-muted-foreground">
            Now
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">{props.nowLabel}</div>
          <div className="text-lg tracking-tight text-foreground">{props.nowValue}</div>
          {props.nowDate ? (
            <div className="mt-1 text-xs text-muted-foreground">{props.nowDate}</div>
          ) : null}
        </div>
      </div>
      <p className="mt-3 border-t border-border/70 pt-3 text-sm leading-6 text-foreground/85">
        {props.verdict}
      </p>
    </div>
  ),
});

const Callout = defineComponent({
  name: "Callout",
  description: "A short note, warning, or confirmation.",
  props: z.object({
    text: z.string(),
    tone: z.enum(["note", "warning", "success"]).optional(),
  }),
  component: ({ props }) => {
    const tone = props.tone ?? "note";
    const Icon =
      tone === "warning" ? CircleAlertIcon : tone === "success" ? CircleCheckIcon : InfoIcon;
    return (
      <div
        className={cn(
          "flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm leading-6",
          tone === "warning" && "border-amber-500/25 bg-amber-500/5 text-amber-900 dark:text-amber-200",
          tone === "success" && "border-emerald-500/25 bg-emerald-500/5 text-emerald-900 dark:text-emerald-200",
          tone === "note" && "border-border/80 bg-muted/40 text-foreground/85",
        )}
      >
        <Icon className="mt-1 size-4 shrink-0" />
        <p>{props.text}</p>
      </div>
    );
  },
});

const Timeline = defineComponent({
  name: "Timeline",
  description: "A short dated history, for what the user asked or what happened over time.",
  props: z.object({
    items: z.array(
      z.object({
        date: z.string(),
        text: z.string(),
      }),
    ),
  }),
  component: ({ props }) => (
    <ol className="space-y-3">
      {toList(props.items).map((item, index) => (
        <li key={index} className="relative grid grid-cols-[5.5rem_1fr] gap-3 pl-0">
          <span className="text-xs leading-5 text-muted-foreground">{item.date}</span>
          <span className="relative border-l border-border/80 pl-3 text-sm leading-5 text-foreground/90">
            <span className="absolute top-2 -left-[3px] size-1.5 rounded-full bg-muted-foreground/60" />
            {item.text}
          </span>
        </li>
      ))}
    </ol>
  ),
});

const Sources = defineComponent({
  name: "Sources",
  description: "The web pages behind the answer. Include every source the answer relies on.",
  props: z.object({
    items: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        date: z.string().optional(),
      }),
    ),
  }),
  component: ({ props }) => (
    <details className="group border-t border-border/70 pt-2.5">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        Sources
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
          {toList(props.items).length}
        </span>
        <ChevronDownIcon className="size-3 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-2 space-y-1.5">
        {toList(props.items).map((item, index) => (
          <li key={index}>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="group/link flex min-w-0 items-baseline gap-2 text-sm text-foreground/85 underline-offset-4 hover:text-foreground hover:underline"
            >
              <span className="truncate">{item.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{hostname(item.url)}</span>
              {item.date ? (
                <span className="shrink-0 text-xs text-muted-foreground">· {item.date}</span>
              ) : null}
              <ArrowUpRightIcon className="size-3 shrink-0 opacity-40 transition-opacity group-hover/link:opacity-100" />
            </a>
          </li>
        ))}
      </ul>
    </details>
  ),
});

const Answer = defineComponent({
  name: "Answer",
  description:
    "The root of an OpenUI answer. Composes a short structured answer from the available blocks.",
  props: z.object({
    children: z.array(
      z.union([
        Paragraph.ref,
        Bullets.ref,
        Facts.ref,
        Table.ref,
        Compare.ref,
        Callout.ref,
        Timeline.ref,
        Sources.ref,
      ]),
    ),
  }),
  component: ({ props, renderNode }) => (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {renderNode(toList(props.children))}
    </div>
  ),
});

export const openuiLibrary = createLibrary({
  root: "Answer",
  components: [Answer, Paragraph, Bullets, Facts, Table, Compare, Callout, Timeline, Sources],
  componentGroups: [
    {
      name: "Structure",
      components: ["Answer", "Paragraph", "Bullets", "Facts"],
      notes: [
        "- Every program starts with `root = Answer([...])`.",
        "- Keep the answer to 2-5 statements. Prefer one block per idea.",
        "- Use Paragraph for one short paragraph and Bullets for a short list.",
        "- Use Facts for one item's 2-6 label/value pairs.",
      ],
    },
    {
      name: "Compare products",
      components: ["Table"],
      notes: [
        "- Use Table when comparing 2-5 products or options across the same 2-4 attributes.",
        "- Put the product names in the first column and one shared attribute per remaining column.",
        "- Use Facts for one item, Table for several items, and Compare for one then-vs-now fact.",
      ],
    },
    {
      name: "Change over time",
      components: ["Compare", "Timeline", "Callout"],
      notes: [
        "- Use Compare for any then/now, before/after, or changed/unchanged fact. This is the re-check card.",
        "- Use Timeline for a dated history of what the user asked or what happened.",
        "- Use Callout only for a short caveat, warning, or confirmation.",
      ],
    },
    {
      name: "Evidence",
      components: ["Sources"],
      notes: [
        "- Include Sources in every answer that relies on web pages, with one item per page.",
        "- Use the page title, full URL, and publish date when known.",
      ],
    },
  ],
});

export const openuiPromptOptions: PromptOptions = {
  preamble:
    "You write short OpenUI Lang programs for a chat agent. The app renders your program inside a message. Use this format when the answer is clearer as a small structured card, product or option comparison, timeline, or fact list. Do not write Markdown.",
  additionalRules: [
    "Start with `root = Answer([...])` and use only the components in this library.",
    "Keep the program to 2-5 statements. Do not repeat the question.",
    "Use Table when comparing 2-5 products or options across the same attributes. Put the names in the first column and one attribute per remaining column.",
    "Use Facts for one item's 2-6 label/value pairs. Do not use Facts for a multi-product comparison.",
    "Use Compare whenever the answer is about whether one thing changed, with the old value and date on the left and the current value and date on the right.",
    "Use Sources for every factual answer that uses web pages.",
    "Write plain text inside Paragraph and Bullet items. Do not put Markdown or links there.",
    "Treat every example as a format example only. Never reuse its data or invent mock data unless the user explicitly asks for mock data.",
    "Do not use Query, Mutation, $variables, actions, or code fences.",
    "If the answer is simple prose or a greeting, do not use OpenUI; the app will use Markdown instead.",
  ],
  examples: [
    `root = Answer([intro, table, evidence])
intro = Paragraph("Here are the two closest options.")
table = Table(["Option", "Price", "Best for"], [{cells: ["Plan A", "$19/month", "Small teams"]}, {cells: ["Plan B", "$29/month", "Growing teams"]}], "Monthly pricing")
evidence = Sources([{title: "Pricing", url: "https://example.com/pricing", date: "10 Nov 2026"}])`,
    `root = Answer([summary, cmp, evidence])
summary = Paragraph("Neon's Launch plan changed this week.")
cmp = Compare("Launch plan", "$19/month", "Launch plan", "$25/month", "The price changed.", "3 Nov 2026", "10 Nov 2026")
evidence = Sources([{title: "Neon pricing", url: "https://neon.tech/pricing", date: "10 Nov 2026"}])`,
    `root = Answer([intro, history])
intro = Paragraph("You asked about Postgres hosting last Tuesday.")
history = Timeline([{date: "3 Nov 2026", text: "Asked about Postgres hosting"}, {date: "10 Nov 2026", text: "Re-checked the current pricing"}])`,
    `root = Answer([summary, facts])
summary = Paragraph("Four of the five CRM tools you shortlisted have changed.")
facts = Facts([{label: "HubSpot", value: "Starter moved from $15 to $20"}, {label: "Pipedrive", value: "No pricing change"}, {label: "Close", value: "New AI add-on"}])`,
  ],
};

let cachedPrompt: string | null = null;

export function getOpenUIPrompt(): string {
  if (!cachedPrompt) {
    const raw = openuiLibrary.prompt(openuiPromptOptions);
    // The generic builder suggests charts and forms that this library does not
    // have. Keep the model inside the components above.
    cachedPrompt = raw.replace(
      "## Important Rules\n- Choose components that best represent the content (tables for comparisons, charts for trends, forms for input, etc.)\n",
      "## Important Rules\n- Use only the components listed above; do not invent components.\n",
    );
  }
  return cachedPrompt;
}
