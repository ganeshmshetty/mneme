import type { AgentEvent, ChatRequestBody } from "@/lib/agent/events";

export async function streamChat(
  body: ChatRequestBody,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Chat request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (frame: string) => {
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        onEvent(JSON.parse(raw) as AgentEvent);
      } catch {
        // Ignore malformed frames; a stream should never take the page down.
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      flush(buffer.slice(0, split));
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf("\n\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) flush(buffer);
}
