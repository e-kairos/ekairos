import "server-only";

import { randomUUID } from "node:crypto";
import { defineAction, defineEvent } from "@ekairos/domain";
import {
  ContextHandle,
  Events,
  getContextRuntimeServices,
  type ContextRuntimeServiceHandle,
} from "@ekairos/events";
import {
  defineReaction,
  type ReactionEngine,
  type ReactionEngineActions,
  type ReactionEngineInput,
  type ReactionEngineResult,
} from "@ekairos/reactor";
import { executeReaction } from "@ekairos/reactor/internal";
import { z } from "zod";
import appDomain from "@/lib/domain";

const demoContextSchema = z.object({
  title: z.string(),
  runs: z.number().int().nonnegative(),
  lastMessage: z.string(),
});

const receivedSchema = z.object({
  message: z.string(),
  receivedAt: z.string(),
});

const publishedSchema = z.object({
  status: z.literal("published"),
  summary: z.string(),
  run: z.number().int().positive(),
});

const publishInputSchema = z.object({
  contextId: z.string(),
  title: z.string(),
  message: z.string(),
  summary: z.string(),
  run: z.number().int().positive(),
});

const demoOutputSchema = z.object({
  summary: z.string(),
  run: z.number().int().positive(),
  operations: z.array(z.string()),
});

const wordCountSchema = z.object({
  words: z.number().int().nonnegative(),
});

const signalSchema = z.object({
  signal: z.enum(["short", "substantial"]),
});

const publish = defineAction({
  input: publishInputSchema,
  output: publishedSchema,
  async execute({ runtime, input }) {
    "use step";

    await wait(120);
    const context = await ContextHandle.get<DemoContext>(runtime, { id: input.contextId });
    if (!context) throw new Error(`demo_context_not_found:${input.contextId}`);
    await context.updateContent({
      title: input.title,
      runs: input.run,
      lastMessage: input.message,
    });
    return publishedSchema.parse({
      status: "published",
      summary: input.summary,
      run: input.run,
    });
  },
});

const demoDomain = appDomain
  .withEvents({
    requested: defineEvent({
      payload: z.object({ message: z.string() }),
    }),
    completed: defineEvent({
      payload: demoOutputSchema,
    }),
  })
  .withActions({ publish });

export const DEMO_REACTOR_KEY = "context-elements.demo-reaction";

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function latestGivenPayload(input: Parameters<ReactionEngine["agent"]>[0]) {
  return input.given.at(-1)?.payload;
}

function triggerPayload(input: Parameters<ReactionEngine["agent"]>[0]) {
  return input.trigger.payload && typeof input.trigger.payload === "object"
    ? input.trigger.payload as Record<string, unknown>
    : {};
}

const demoEngine: ReactionEngine<DemoContext> = {
  async agent<TOutput, TActions extends ReactionEngineActions>(
    input: ReactionEngineInput<DemoContext, TOutput, TActions>,
  ): Promise<ReactionEngineResult<TOutput>> {
    switch (input.instruction) {
      case "Capture the input message as the current reaction value.": {
        await wait(90);
        return {
          output: receivedSchema.parse({
            message: String(triggerPayload(input).message ?? ""),
            receivedAt: new Date().toISOString(),
          }) as TOutput,
        };
      }
      case "Count the words in the current message.": {
        await wait(70);
        const message = receivedSchema.parse(latestGivenPayload(input)).message
          .replace(/\s+/g, " ")
          .trim();
        return {
          output: wordCountSchema.parse({ words: message ? message.split(" ").length : 0 }) as TOutput,
        };
      }
      case "Classify the message by length.": {
        await wait(100);
        const message = receivedSchema.parse(latestGivenPayload(input)).message.trim();
        return {
          output: signalSchema.parse({
            signal: message.length >= 40 ? "substantial" : "short",
          }) as TOutput,
        };
      }
      default:
        throw new Error(`demo_instruction_not_supported:${input.instruction}`);
    }
  },
};

const demoReaction = defineReaction(
  demoDomain.events.requested,
  {
    key: DEMO_REACTOR_KEY,
    scope: demoDomain,
    engine: demoEngine,
    sandbox: false,
  },
  async reaction => {
    const received = await reaction.given(reaction.trigger).agent({
      instruction: "Capture the input message as the current reaction value.",
      output: receivedSchema,
    });

    const [wordCount, signal] = await Promise.all([
      reaction.given(received).agent({
        instruction: "Count the words in the current message.",
        output: wordCountSchema,
      }),
      reaction.given(received).agent({
        instruction: "Classify the message by length.",
        output: signalSchema,
      }),
    ]);

    const published = await reaction.given([received, wordCount, signal]).action(
      demoDomain.actions.publish,
      {
        contextId: reaction.context.id,
        title: reaction.context.content.title,
        message: received.payload.message,
        summary: `Received a ${signal.payload.signal} message with ${wordCount.payload.words} words.`,
        run: reaction.context.content.runs + 1,
      },
    );
    const output = demoOutputSchema.parse({
      summary: published.payload.summary,
      run: published.payload.run,
      operations: ["agent", "agent", "agent", "action", "emit"],
    });

    return await reaction.given(published).emit(
      demoDomain.events.completed(output),
    );
  },
);

export async function runDemoReaction(
  runtime: ContextRuntimeServiceHandle,
  params: {
    contextId: string;
    context: z.infer<typeof demoContextSchema>;
    message: string;
  },
) {
  const trigger = await Events(runtime).emit(
    demoDomain.events.requested({ message: params.message }),
    {
      id: randomUUID(),
      channel: "web",
      contextId: params.contextId,
      createdAt: new Date(),
    },
  );
  const context = await ContextHandle.get<DemoContext>(runtime, { id: params.contextId });
  if (!context) throw new Error(`demo_context_not_found:${params.contextId}`);
  const effect = await executeReaction(
    runtime as any,
    context,
    trigger,
    demoReaction,
  );
  const { db } = await getContextRuntimeServices(runtime);
  const snapshot = await db.query({
    context_contexts: {
      $: { where: { id: params.contextId }, limit: 1 },
      currentSession: {},
    },
  });
  const sessionId = snapshot.context_contexts?.[0]?.currentSession?.id;
  if (!sessionId) throw new Error(`demo_session_not_found:${params.contextId}`);

  return {
    trigger,
    sessionId,
    result: {
      reactionEvent: effect,
      output: effect.payload,
    },
  };
}

export type DemoContext = z.infer<typeof demoContextSchema>;

export function initialDemoContext(): DemoContext {
  return {
    title: "Context Elements Reaction Template",
    runs: 0,
    lastMessage: "",
  };
}
