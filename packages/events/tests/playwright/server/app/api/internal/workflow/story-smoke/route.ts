import { NextResponse } from "next/server";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import {
  storySmoke,
  storySmokeDomain,
  storySmokeScripted,
  storySmokeToolError,
  type SmokeContext,
} from "../../../../../src/lib/story-smoke.story";
import { Context, Events } from "@ekairos/context";
import { createStorySmokeRuntime } from "../../../../../src/ekairos";
import { contextEngineDurableWorkflow } from "../../../../../src/lib/context-engine.workflow";

// Ensure env is available in dev (turbopack) even if the bootstrap module isn't evaluated.
dotenvConfig({ path: resolve(process.cwd(), ".env.local"), quiet: true });
dotenvConfig({ path: resolve(process.cwd(), ".env"), quiet: true });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env.local"), quiet: true });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env"), quiet: true });

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const modeParam = url.searchParams.get("mode");
    const mode =
      modeParam === "tool-error"
        ? "tool-error"
        : modeParam === "scripted"
          ? "scripted"
          : "success";

    const reaction =
      mode === "tool-error"
        ? storySmokeToolError
        : mode === "scripted"
          ? storySmokeScripted
          : storySmoke;
    const runtime = createStorySmokeRuntime({ mode });
    const context = await Context(runtime).create<SmokeContext>({
      key: `story-smoke:${mode}:${crypto.randomUUID()}`,
      content: { lastMessage: "ping" },
    });
    const triggerEvent = await Events(runtime).emit(
      storySmokeDomain.events.requested({ message: "ping", mode }),
      {
        id: crypto.randomUUID(),
        channel: "web",
        contextId: context.id,
        createdAt: new Date(),
      },
    );
    const effect = await context.react(triggerEvent, reaction, {
      workflow: contextEngineDurableWorkflow,
    });
    const refreshed = await context.refresh();

    return NextResponse.json({
      ok: true,
      data: {
        context: refreshed.context,
        trigger: triggerEvent,
        effect,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Story smoke failed", details: message }, { status: 500 });
  }
}
