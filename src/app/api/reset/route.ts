import { NextResponse } from "next/server";
import { getMemoryStore } from "@/lib/memory/store";

export const runtime = "nodejs";

export async function POST() {
  const store = getMemoryStore();
  await store.reset();
  return NextResponse.json({ ok: true });
}
