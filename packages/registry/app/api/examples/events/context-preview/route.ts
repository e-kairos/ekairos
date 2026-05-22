import { NextResponse } from "next/server";

function readLastText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const firstMessage = messages[0] as { parts?: unknown } | undefined;
  const parts = Array.isArray(firstMessage?.parts) ? firstMessage.parts : [];
  const firstTextPart = parts.find((part) => {
    return part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string";
  }) as { text?: string } | undefined;

  return firstTextPart?.text?.trim() ?? "";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    contextId?: unknown;
    messages?: unknown;
  };
  const contextId =
    typeof body.contextId === "string" && body.contextId.trim()
      ? body.contextId
      : crypto.randomUUID();
  const userText = readLastText(body.messages);

  return NextResponse.json({
    contextId,
    assistantEvent: {
      id: crypto.randomUUID(),
      type: "assistant.message",
      channel: "web",
      createdAt: new Date().toISOString(),
      status: "completed",
      content: {
        parts: [
          {
            type: "text",
            text: userText
              ? `Preview response for: ${userText}`
              : "Preview response stored through the events context endpoint.",
          },
        ],
      },
    },
  });
}
