import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { ContextHandle, getContextRuntimeServices } from "@ekairos/events";
import { getCurrentPreviewRuntimeAppId, resolveRuntime } from "@/runtime";
import {
  DEMO_REACTOR_KEY,
  initialDemoContext,
  runDemoReaction,
  type DemoContext,
} from "@/src/demo-reaction";

const APP_COOKIE = "ek_context_elements_app_id";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function messageFromBody(body: Record<string, unknown>): string {
  const direct = text(body.message);
  if (direct) return direct;

  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const parts = (message as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const value = part as Record<string, unknown>;
      const directPart = text(value.text);
      if (directPart) return directPart;
      const content = value.content;
      if (content && typeof content === "object") {
        const contentText = text((content as Record<string, unknown>).text);
        if (contentText) return contentText;
      }
    }
  }

  return "Run the Reactor template.";
}

async function resolveTemplateRuntime(request: NextRequest) {
  const cookieStore = await cookies();
  const requestedAppId =
    text(request.nextUrl.searchParams.get("appId")) ||
    text(cookieStore.get(APP_COOKIE)?.value);
  const runtime = await resolveRuntime({
    appId: requestedAppId || undefined,
    orgId: text(request.nextUrl.searchParams.get("orgId")) || undefined,
  });
  const appId = getCurrentPreviewRuntimeAppId();
  if (!appId) throw new Error("context_elements_runtime_app_missing");
  return { runtime, appId };
}

async function ensureContext(runtime: any, contextKey: string) {
  const existing = await ContextHandle.get<DemoContext>(runtime, { key: contextKey });
  if (existing) return existing;

  return await ContextHandle.create(runtime, {
    key: contextKey,
    name: "Reaction template",
    content: initialDemoContext(),
  });
}

function withAppCookie(response: NextResponse, appId: string) {
  response.cookies.set(APP_COOKIE, appId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const contextKey = text(request.nextUrl.pathname.split("/").pop());
    if (!contextKey) return NextResponse.json({ error: "context_key_required" }, { status: 400 });

    const { runtime, appId } = await resolveTemplateRuntime(request);
    const handle = await ensureContext(runtime, contextKey);
    const response = NextResponse.json({
      ok: true,
      appId,
      contextId: handle.id,
      contextKey,
      context: handle.context,
    });
    return withAppCookie(response, appId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const contextKey = text(request.nextUrl.pathname.split("/").pop());
    if (!contextKey) return NextResponse.json({ error: "context_key_required" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { runtime, appId } = await resolveTemplateRuntime(request);
    const handle = await ensureContext(runtime, contextKey);
    const current = (handle.context.content ?? initialDemoContext()) as DemoContext;
    const result = await runDemoReaction(runtime, {
      contextId: handle.id,
      context: {
        title: text(current.title) || initialDemoContext().title,
        runs: Number.isFinite(current.runs) ? current.runs : 0,
        lastMessage: text(current.lastMessage),
      },
      message: messageFromBody(body),
    });

    const response = NextResponse.json({
      ok: true,
      appId,
      contextId: handle.id,
      sessionId: result.sessionId,
      triggerEvent: result.trigger,
      reactionEvent: result.result?.reactionEvent,
      output: result.result?.output,
    });
    return withAppCookie(response, appId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
