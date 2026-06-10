import { NextResponse } from "next/server";

/**
 * Demo send endpoint for the channel live demo. Mirrors the contract of a
 * real app-owned send endpoint: accepts { channel, text, contextId?,
 * threadKey? } and acknowledges. The demo page appends the message locally.
 */
export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const channel = typeof payload.channel === "string" ? payload.channel : "web";
  if (!text) {
    return NextResponse.json({ error: "text_required" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, channel });
}
