import { z } from "zod";
import type { AgentEvent } from "@/lib/agent/events";
import { runAgent } from "@/lib/agent/pipeline";
import { getMemoryStore } from "@/lib/memory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  chatId: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1).max(20_000),
  modelId: z.string().trim().min(1).optional(),
  timeZone: z.string().trim().min(1).max(100).optional(),
});

const encoder = new TextEncoder();

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid chat payload." }, { status: 400 });
  }

  const body = parsed.data;
  const memory = getMemoryStore();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: AgentEvent) => {
        if (closed || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        await runAgent({
          memory,
          message: body.message,
          chatId: body.chatId,
          modelId: body.modelId,
          timeZone: body.timeZone,
          signal: request.signal,
          onEvent: send,
        });
      } catch (error) {
        if (!request.signal.aborted) {
          send({
            type: "run_error",
            message:
              error instanceof Error
                ? error.message
                : "Something went wrong while answering. Try again.",
            retryable: true,
          });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // The client may have already closed the stream.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
