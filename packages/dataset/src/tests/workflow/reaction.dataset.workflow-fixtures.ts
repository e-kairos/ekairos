import { init } from "@instantdb/admin"
import { defineEvent, domain, EkairosRuntime } from "@ekairos/domain"
import {
  ContextHandle,
  contextDomain,
  type ContextEvent,
  type StoredContext,
} from "@ekairos/events"
import {
  defineReaction,
} from "@ekairos/reactor"
import { executeReaction } from "@ekairos/reactor/internal"
import { sandboxDomain } from "@ekairos/sandbox/schema"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { z } from "zod"

import { buildReactionDataset } from "../../reactionDataset.ts"
import { datasetDomain } from "../../schema.ts"
import { actionStep, deterministicReactionEngine } from "../_reactionEngine.ts"

const sourceItemSchema = z.object({
  code: z.string(),
  description: z.string(),
  price: z.number(),
})

const materializedSchema = z.object({
  datasetId: z.string(),
  itemCount: z.number().int(),
})

export const reactionDatasetWorkflowDomain = domain("reactionDatasetWorkflow")
  .includes(contextDomain)
  .includes(datasetDomain)
  .includes(sandboxDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    received: defineEvent({ payload: z.array(sourceItemSchema) }),
    materialized: defineEvent({ payload: materializedSchema }),
  })
  .withActions(datasetDomain.actions)
  .withActions(sandboxDomain.actions)

export type ReactionDatasetWorkflowEnv = {
  appId: string
  adminToken: string
}

export type ReactionDatasetWorkflowContext = {
  sandboxId: string
}

export class ReactionDatasetWorkflowRuntime extends EkairosRuntime<
  ReactionDatasetWorkflowEnv,
  typeof reactionDatasetWorkflowDomain,
  ReturnType<typeof init>
> {
  static [WORKFLOW_SERIALIZE](instance: ReactionDatasetWorkflowRuntime) {
    return this.serializeRuntime(instance)
  }

  static [WORKFLOW_DESERIALIZE](data: { env: ReactionDatasetWorkflowEnv }) {
    return this.deserializeRuntime(data) as ReactionDatasetWorkflowRuntime
  }

  protected getDomain() {
    return reactionDatasetWorkflowDomain
  }

  protected resolveDb(env: ReactionDatasetWorkflowEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: reactionDatasetWorkflowDomain.instantSchema(),
      useDateObjects: true,
    } as any)
  }

  async materializeDataset(input: Parameters<typeof buildReactionDataset>[0]) {
    return await buildReactionDataset(input)
  }
}

export class ReactionDatasetWorkflowContextHandle extends ContextHandle<
  ReactionDatasetWorkflowContext
> {
  declare readonly runtime: ReactionDatasetWorkflowRuntime

  constructor(
    runtime: ReactionDatasetWorkflowRuntime,
    context: StoredContext<ReactionDatasetWorkflowContext>,
  ) {
    super(runtime, context)
  }

  static [WORKFLOW_SERIALIZE](instance: ReactionDatasetWorkflowContextHandle) {
    return { runtime: instance.runtime, context: instance.context }
  }

  static [WORKFLOW_DESERIALIZE](data: {
    runtime: ReactionDatasetWorkflowRuntime
    context: StoredContext<ReactionDatasetWorkflowContext>
  }) {
    return new ReactionDatasetWorkflowContextHandle(data.runtime, data.context)
  }

  async react(
    trigger: ContextEvent,
    definition: typeof reactionDatasetWorkflowDefinition,
  ) {
    return await executeReaction(this.runtime, this, trigger, definition)
  }
}

const pythonCode = [
  "import json",
  "import os",
  "script_dir = os.path.dirname(__file__)",
  "session_dir = os.path.dirname(script_dir)",
  "output_path = os.path.join(session_dir, 'output', 'output.jsonl')",
  "os.makedirs(os.path.dirname(output_path), exist_ok=True)",
  "rows = [",
  "  {'code': 'A1', 'description': 'Bolt', 'price': 10.5},",
  "  {'code': 'A2', 'description': 'Nut', 'price': 20.25},",
  "]",
  "with open(output_path, 'w', encoding='utf-8') as output:",
  "  for row in rows:",
  "    output.write(json.dumps({'type': 'row', 'data': row}) + '\\n')",
  "print(f'wrote_rows={len(rows)} output={output_path}')",
].join("\n")

const engine = deterministicReactionEngine({
  steps: [
    actionStep("executeCommand", {
      commandDescription: "Parse the selected causal rows into the declared schema.",
      pythonCode,
      scriptName: "parse_items",
    }),
    actionStep("completeDataset", {
      summary: "Two item rows materialized from the trigger Event.",
    }),
  ],
})

export const reactionDatasetWorkflowDefinition = defineReaction<
  typeof reactionDatasetWorkflowDomain.events.received,
  ReactionDatasetWorkflowContext,
  typeof reactionDatasetWorkflowDomain
>(
  reactionDatasetWorkflowDomain.events.received,
  {
    key: "dataset.reaction.workflow",
    scope: reactionDatasetWorkflowDomain,
    engine,
    sandbox: ({ context }) => context.sandboxId,
  },
  async reaction => {
    const items = await reaction.given(reaction.trigger).dataset({
      instruction: "Extract one canonical item row per source row.",
      schema: sourceItemSchema,
    })

    return await reaction.given(items).emit(
      reactionDatasetWorkflowDomain.events.materialized({
        datasetId: items.payload.datasetId,
        itemCount: items.payload.preview.length,
      }),
    )
  },
)

export async function reactionDatasetWorkflow(
  context: ReactionDatasetWorkflowContextHandle,
  trigger: ContextEvent,
) {
  "use workflow"

  return await context.react(trigger, reactionDatasetWorkflowDefinition)
}
