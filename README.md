# Mneme

A chat agent with one tool, web search, and memory over time. It remembers what you asked, when, and whether the answer still holds.

## Run

Needs Node 24.15 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. First-run setup asks for one model key and one optional search key. Skip it to try the dry run.

## Keys

One model key is required. Everything else is optional.

| Key | Use |
| --- | --- |
| `OPENCODE_API_KEY` | DeepSeek, Claude and GPT through OpenCode. Recommended. |
| `ANTHROPIC_API_KEY` | Claude directly. |
| `OPENAI_API_KEY` | GPT directly. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini directly. |
| `FIRECRAWL_API_KEY` | Optional. Raises search limits. |
| `TAVILY_API_KEY` | Optional. Used with `SEARCH_PROVIDER=tavily`. |

Keys live on the server: `.env` first, then `data/keys.json`. They are never sent to the browser. Memory is local SQLite in `data/`.

## Sample history

```bash
npm run seed
```

Then try:

- What did I ask you on 3 November? Is your answer still correct today?
- Last Tuesday I asked you about Postgres hosting. Has any pricing changed since?
- We shortlisted 5 CRM tools for a 20-person team. Has any of them changed pricing or shipped something big since?

## Checks

```bash
npm test
npm run typecheck
```

## Design

See [DESIGN.md](./DESIGN.md).
