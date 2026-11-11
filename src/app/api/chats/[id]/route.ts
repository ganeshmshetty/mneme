import { NextResponse } from "next/server";
import { getMemoryStore } from "@/lib/memory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const store = getMemoryStore();
  const chat = await store.getChat(id);
  if (!chat) return NextResponse.json({ error: "Chat not found." }, { status: 404 });

  return NextResponse.json({
    chat,
    messages: await store.getMessages(id),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const store = getMemoryStore();
  const chat = await store.getChat(id);
  if (!chat) return NextResponse.json({ ok: true });

  await store.deleteChat(id);
  return NextResponse.json({ ok: true });
}
