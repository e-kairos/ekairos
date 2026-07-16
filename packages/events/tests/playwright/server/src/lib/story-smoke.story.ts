import { defineEvent, domain } from "@ekairos/domain";
import { contextDomain, Part } from "@ekairos/context";
import {
  defineReaction,
  type ReactionEngine,
  type ReactionEngineActions,
  type ReactionEngineInput,
} from "@ekairos/reactor";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { z } from "zod";

export type SmokeContext = { lastMessage?: string };
export type StorySmokeMode = "success" | "tool-error" | "scripted";

const smokeOutput = z.object({
  ok: z.boolean(),
  message: z.string(),
});

class StorySmokeEngine implements ReactionEngine<SmokeContext> {
  constructor(readonly mode: StorySmokeMode) {}

  static [WORKFLOW_SERIALIZE](instance: StorySmokeEngine) {
    return { mode: instance.mode };
  }

  static [WORKFLOW_DESERIALIZE](data: { mode: StorySmokeMode }) {
    return new StorySmokeEngine(data.mode);
  }

  async agent<TOutput, TActions extends ReactionEngineActions>(
    input: ReactionEngineInput<SmokeContext, TOutput, TActions>,
  ) {
    const request = storySmokeDomain.events.requested.payload.parse(
      input.trigger.payload,
    );
    const candidate = this.mode === "tool-error"
      ? { ok: false, message: "echo_failed" }
      : { ok: true, message: request.message };
    const output = input.output
      ? input.output.parse(candidate)
      : candidate as TOutput;
    return { output, parts: [Part.message(JSON.stringify(candidate))] };
  }
}

export const storySmokeDomain = domain("storySmoke")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    requested: defineEvent({
      payload: z.object({ message: z.string(), mode: z.enum(["success", "tool-error", "scripted"]) }),
    }),
    completed: defineEvent({ payload: smokeOutput }),
  });

function createStorySmoke(mode: StorySmokeMode) {
  const key = mode === "tool-error"
    ? "story.smoke.tool-error"
    : mode === "scripted"
      ? "story.smoke.scripted"
      : "story.smoke";
  const engine = new StorySmokeEngine(mode);

  return defineReaction(
    storySmokeDomain.events.requested,
    { key, scope: storySmokeDomain, engine, sandbox: false },
    async reaction => {
      const response = await reaction.given(reaction.trigger).agent({
        instruction: "Echo the persisted trigger through the deterministic ReactionEngine.",
        output: smokeOutput,
      });
      return await reaction.given(response).emit(
        storySmokeDomain.events.completed(response.payload),
      );
    },
  );
}

export const storySmoke = createStorySmoke("success");
export const storySmokeToolError = createStorySmoke("tool-error");
export const storySmokeScripted = createStorySmoke("scripted");
