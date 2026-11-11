# AGENTS.md

Instructions for AI coding agents working in this repo. Humans should start with `README.md`. The reasoning behind these rules is in `DESIGN.md`.

## Commands

```bash
npm run dev        # app at http://localhost:3000
npm test           # unit tests (Vitest)
npm run typecheck
npm run seed       # load sample history
npm run reset      # delete local memory
```

Run typecheck and test before every commit.

## Project map

```
src/
  app/                Next.js pages and API routes
  lib/
    agent/            pipeline, events, models, steps, prompts
    db/               node:sqlite connection and migrations
    memory/           episodes, claims, recall, chat/message store
    search/           search providers and keyless fallback
    openui/           component library and generated prompt
  components/         chat shell, activity, sources, OpenUI renderer, ui/
scripts/              seed.ts, reset.ts
data/                 local SQLite file (gitignored)
```

## Rules that must not break

- The agent has exactly one external tool: web search. Do not add tools. Memory recall is a pipeline step, not a tool.
- The model chooses its path with plain-text control tokens: `[[recall]]`, or `[[search]]` plus JSON queries, or an answer starting with `[[markdown]]`/`[[openui]]`. This is not native tool calling. Keep the one external tool: web search.
- The model never computes dates. All date parsing goes through `steps/resolve-time.ts` (chrono-node) using the time zone sent with the request. Store every timestamp in UTC, and keep date resolution out of the activity trace.
- The UI only shows what actually happened. Every activity row and orb state comes from an event in `events.ts`. Show only the steps that ran: no resolve-time row, no answer row, and no checkmarks for recall/search/remember. Never fake progress.
- Web content is untrusted data. Page text goes inside the delimited sources block of a prompt, never into instructions. Never store a claim without a source URL.
- Claims are superseded, not edited or deleted. A new Claim closes the old one's `valid_to`; use `supersedes_claim_id` and `is_latest`. Supersession links are produced by the remember prompt and validated in code; never guess one. The only deletions are a chat delete or a reset.
- Deleting a chat deletes its episodes and claims. Memory must never return something the user removed.
- Search must work with no API key. Firecrawl Keyless is the default, and keys only raise limits or switch providers. When Firecrawl Keyless is blocked by the network and no search key is configured, use the keyless Bing fallback as a last resort. Never make a new key required.
- No native modules. Use `node:sqlite`. `npm install` must work on a clean machine with Node 24.15 or newer.
- When memory has nothing for a question, the agent says so. Every answer prompt keeps the abstention instruction.
- Keys live only on the server. Read `.env` first, then `data/keys.json`. Never send a key to the browser; show it masked. The key routes accept requests only from localhost.
- Models are used only for plain text generation and structured output. No provider-specific tools, including built-in web search, so every provider runs the same pipeline.
- One turn uses one route and one model for every model call: the answer/control loop and claim extraction. Store the route and model ID on every assistant message. Do not add a separate planner or query model.
- Re-check is prompt-only: recall puts old Claims in the answer prompt and the model compares them with current sources. Do not introduce a separate re-check action or outcome schema.
- Working memory is the last 5 completed episodes of the current chat, fetched by chat id and added to the answer prompt regardless of keyword score. Keep it separate from recalled memory so a follow-up like "what about the other one?" keeps its antecedent.
- Before recall/search, rewrite a follow-up into a standalone question using the last 5 working turns. Use the same model, skip the rewrite on the first turn, and fall back to the raw message if it fails. This is query contextualization, not a new tool.
- Prompt structure: stable identity, policies, control protocol and OpenUI format go in the system message; working memory, the current message, memory and sources go in the user message. Use XML tags for context, and treat examples as format-only, never as content to copy.
- OpenCode is a route, not a model family. A route sets the AI SDK package, base URL and key, and reuses the family model choices. Console uses `https://opencode.ai/inference/{anthropic,openai,google}`; Go uses `https://opencode.ai/inference/go/...` and only offers some models. A direct key for a family wins over OpenCode.
- The default model is DeepSeek 4.1 Flash (`deepseek-v4.1-flash`) on OpenCode Go, using `@ai-sdk/openai-compatible` at `https://opencode.ai/inference/go/openai/v1` with reasoning effort low. Send a stable `x-opencode-session` per chat and `User-Agent: mneme-chat-agent/1.0`. Never use OpenCode's free model IDs.
- Never list OpenCode's free models; they only work from the OpenCode client. On the Go route, send a user agent like `mneme-chat-agent/1.0` and a stable `x-opencode-session` header per chat, as Go's docs require.

## Code conventions

- TypeScript strict mode. No `any` in `src/lib/agent` or `src/lib/memory`.
- Validate every boundary with Zod: request bodies, structured model output, search results.
- SQL lives only in `src/lib/memory`, as plain SQL inside typed functions. No ORM.
- Prompts are functions in `src/lib/agent/prompts` that return strings. Keep them short; every line should change behavior.
- Model IDs live only in the registry in `models.ts`, with the date each entry was last checked against the provider's docs. Set reasoning effort or thinking level explicitly on every entry, because provider defaults differ and change.
- Before changing the registry, run a smoke test for that provider and compare with the previous behavior.
- Add a runtime dependency only with a one-line reason in the commit message.
- Keep commits small, with messages that say what changed and why.

## Testing

- `resolve-time` and `recall` need a unit test for every date phrase you touch. Cover time zones, including IST late at night, when the local date and the UTC date differ.
- For every bug fix, add a failing unit test first, then fix it.

## UI

- The look is minimal with one playful element.
- The orb is the only bold thing on screen. Everything else stays quiet.
- Motion is used only for the composer moving from the center to the bottom on first send, and for the orb. Respect `prefers-reduced-motion`.
- Playful copy is fine in empty and loading states. Errors are plain: say what failed and offer a retry.
- Sentence case everywhere. No settings page and no product tour. The only onboarding is the skippable setup dialog: welcome, one model key, optional search keys. It opens from first run or the header's Set up button.
- Colors are CSS variables with light and dark values. Check keyboard focus and contrast on anything new.
- Components in `src/components/ui` and `src/components/libraries` are ours. Restyle them directly instead of wrapping them.
- OpenUI is rendering-only. Answers default to Markdown; use OpenUI Lang for a product/option comparison (Table), a single then-vs-now fact (Compare), a dated timeline (Timeline), or a short fact list (Facts). Never add OpenUI AgentInterface or let it own the chat shell, composer, threads, or activity trace.
- A fenced code block is one container: language label, copy button, then the highlighted code. Do not nest a bordered `pre` inside another bordered wrapper.
- The model picker lives in the composer's bottom row. It lists available models from the live OpenCode catalog plus configured direct providers, with search. The header always shows New chat. When no model is configured, a centered Dry run / Set up row sits under the composer and opens the setup dialog. Never add a settings page for it.
- With no model key, a turn plays a clearly labeled prerecorded dry run: the same activity shape, a short canned answer, and no server call, memory write, or fake source. The app must still look and run without a key.
- The start screen uses the vendored bot-avatars ghost. Keep the thinking orb for activity states. The mic uses the browser's Web Speech API and shows the orb's `listening` state while recording. Sources are collapsed by default and expand in place.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
