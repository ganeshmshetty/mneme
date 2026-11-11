import { NextResponse } from "next/server";
import { getMemoryStore } from "@/lib/memory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const store = getMemoryStore();
  return NextResponse.json({ chats: await store.listChats() });
}
