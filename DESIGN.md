# Design

## How it works

You talk to one agent with one tool, web search. Every message goes through the same six steps, and the activity list under the orb shows each one as it happens, because the UI is drawn from the same events the pipeline emits.

- It works out the time you mean. "Last Tuesday" or "on 3 November" becomes an exact date range in your time zone, computed in code. If a phrase could mean two dates, the agent tells you which one it picked.
- It checks memory on every turn. When a date resolves, it looks only inside that range, across all your chats; otherwise it searches all history. It ranks what it finds by keyword, and if there's nothing there, it says so plainly instead of guessing. The last five completed turns of the current chat are always added as working memory, whatever the keyword score. Before recall or search, a follow-up is rewritten into a standalone question using those turns, so "what about the other one?" keeps its antecedent. This is the standard conversational-RAG pattern: recent turns in the prompt, and a self-contained query before retrieval.
- The model decides what to do: answer directly, or search. When the question refers to an old answer, recall brings that answer into the prompt and the model compares it with current sources.
- It searches. Queries run in parallel and the agent reads snippets first. It opens a full page only when a snippet lacks the fact it needs, and never more than three pages per answer. Search works with no API key through Firecrawl Keyless; a key only raises the limits.
- The same model writes the answer with sources and publish dates. When you ask whether an old answer still holds, it puts what it said then next to what the sources say now.
- After the answer, it saves the facts it stated, with when it said them and when they were true. If the comparison finds a change, the new fact becomes the latest and the old one stays in history.

Most answers are Markdown. When the answer is a product or option comparison, a dated history, or a short fact list, the same model writes a small OpenUI Lang program instead, and the message renders it with a local component library: Table for 2–5 products, Facts for one item's labels, Compare for one then-vs-now fact, Timeline for a dated history. It is a rendering choice, not a second agent: the shell, the orb and the activity trace stay the app's own.

## Why I built it this way

The product is about personal context, open loops, and memory over time, and two of its core questions ask whether an old answer still holds. So I treated remembering and re-checking as the main problem and web search as the easier one.

Time comes first because of LongMemEval (Wu et al., ICLR 2025): memory designs that ignore time do badly on temporal questions, and narrowing retrieval to the right time range improves recall. Storing "when I said it" separately from "when it was true," and linking each fact to the one it replaces, comes from Zep (Rasmussen et al., 2025) and Supermemory's published design. Most memory systems remember facts about the user. This agent mostly needs to remember its own answers, which LongMemEval points out earlier benchmarks didn't test.

minimi's own product memory is a local vector store of personal context behind MCP; Mem0 and Supermemory are vector-first memory APIs; Zep/Graphiti is a temporal graph. This agent's memory is narrower: its own answers and the web facts behind them. I borrowed Zep's temporal claim/validity idea, kept episodes as LIGHT's episodic log, and used SQLite because the memory questions are date-exact and the app is one-key and local. Embeddings with reciprocal rank fusion are the next step if real questions show semantic misses.

The loop is a fixed workflow with one bounded retry, following Anthropic's "Building effective agents" advice to start with the simplest pattern that works. Speed comes from the shape of the pipeline: one model handles the turn, searches run in parallel, and snippets are read before full pages. Because the pipeline only asks models for text and structured output, it runs the same way on Claude, GPT, Gemini and DeepSeek, called directly or through OpenCode's gateway with a single key, and switching changes nothing else. FreshQA (Vu et al., 2023) found that the order and number of search results change answer quality and that short answers hallucinate less, so results are sorted by date and capped, and answers stay short.

OpenUI is used at the answer layer only. I wanted the comparison and timeline blocks without handing the conversation shell, threads or artifacts to a generative-UI framework; those are the parts I wanted to design. Markdown stays the default, so a plain answer never pays the cost of a UI program.

The interface is minimal on purpose: an empty screen with the composer in the middle, a black ghost at the start, an orb that shows which step the agent is on, and an activity list you can open to see every search and memory lookup. A small chip inside the composer picks the model from the live OpenCode catalog, and a mic beside send turns speech into a message. Sources stay collapsed under the answer until opened. On first run a skippable setup dialog asks for one model key and one optional search key, and keeps them on your machine; without a model key the app plays a labeled prerecorded dry run. Editing a message keeps the earlier version, and memory follows the final one.

I tested against a seeded 37-case set covering extraction, multi-session, temporal, knowledge update, abstention, false premise, and relevance. It is not shipped. It guided the control loop, the working-memory window, and the query rewrite; the remaining weak spot is exact phrasing on a few judge checks, which is why the prompt and retrieval path stay the focus.

## What I considered and rejected

- Memory as a second tool. The product has one tool, and recall works better as a step the agent always takes than as a call it might skip.
- A fast planner plus a stronger answer model. It saves planning tokens, but it doubles the prompt and test surface, and the answer dominates latency. One model per turn is simpler and easier to test.
- Answer-level memory only. It cannot express the two-fact case where the price changes but the storage does not, so claims stay separate.
- Embeddings and a vector database as the main memory. "What did I ask on 3 November" is a date lookup, and product names are exact words that keyword search matches better.
- The model's built-in web search. It needs no extra key, but the model picks its own queries, which removes parallel search and date sorting, and Anthropic's version has to be enabled in the Console first.
- Scraping Google or DuckDuckGo directly as the primary search. It's unofficial and breaks without warning. Firecrawl Keyless is the default; a keyless Bing fallback exists only for networks where Firecrawl Keyless is blocked and no search key is configured. A key removes the fallback.
- Agent frameworks (LangChain, LangGraph, Mastra) and hosted memory (Zep, Supermemory). They would own the memory and the loop, which are the parts I wanted to design and explain myself.
- Reading every search result in full. In one published comparison, full pages made search responses roughly fifteen times larger, which means slower answers and more noise for the model.
- Inferred memories. A fact the user never said is easy to get wrong and hard to explain.
- Offering every model each provider sells. Each provider gets two models, a default and a stronger option, and the chosen model does the whole turn, because every extra option is something I'd have to test.
- Keeping pasted keys in the browser. Any script on the page could read them, so they're stored on the server and only accepted from localhost.
- OpenUI's AgentInterface for the whole chat. It would own the shell, threads and artifacts, which are the parts I wanted to keep minimal and explain. Using only its renderer gives the structured answers without the rest.

## What I'd do with another week

- Add embeddings with reciprocal rank fusion, if real questions show keyword search missing memories.
- Add a fast planner model if p50 time to first token shows planning is the bottleneck.
- Re-check fast-changing facts in the background and tell the user when something they asked about has changed. This is the "ping you at the right moment" idea minimi is built on.
- Run part of LongMemEval itself, not only my own cases.
- Run BEAM too, especially contradiction resolution, event ordering and instruction following.
- Compare Firecrawl and Tavily on a held-out question set and keep whichever is faster and more accurate.
