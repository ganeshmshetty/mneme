import { NextResponse } from "next/server";
import { z } from "zod";
import { getKeyStatuses, KEY_NAMES, saveKey } from "@/lib/keys";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.enum(KEY_NAMES),
  key: z.string().min(1).max(4096),
});

function isLocalRequest(request: Request): boolean {
  const host = request.headers.get("host") ?? "";
  return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
}

export async function GET(request: Request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "Keys are only available from localhost." }, { status: 403 });
  }
  return NextResponse.json({ keys: await getKeyStatuses() });
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "Keys can only be changed from localhost." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid key payload." }, { status: 400 });
  }

  try {
    await saveKey(parsed.data.name, parsed.data.key);
    return NextResponse.json({ keys: await getKeyStatuses() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save key." },
      { status: 400 },
    );
  }
}
