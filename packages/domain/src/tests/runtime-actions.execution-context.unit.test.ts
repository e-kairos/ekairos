/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineDomainAction, domain } from "../index.ts";
import { readActionExecutionContext } from "./workflow.metadata.ts";
import {
  DomainRuntime,
} from "./runtime-actions.test-fixtures.ts";

describe("runtime action execution outside workflows", () => {
  it("does not invent a Reaction origin for direct runtime calls", async () => {
    // given: a domain action that inspects the workflow execution context
    // before touching the scoped domain runtime.
    const baseExecutionDomain = domain("action-execution").schema({
      entities: {},
      links: {},
      rooms: {},
    });

    let executionDomain: any;
    executionDomain = baseExecutionDomain.withActions({
      inspectExecution: defineDomainAction({
        input: z.object({ title: z.string() }),
        output: z.object({
          title: z.string(),
          runtimeCall: z.number(),
          inWorkflow: z.boolean(),
          inStep: z.boolean(),
          workflowRunId: z.string().nullable(),
          stepId: z.string().nullable(),
          reactionId: z.string().nullable(),
        }),
        async execute({ input, domain, reactionId }) {
          const workflowExecution = await readActionExecutionContext();
          return {
            title: String(input.title).trim(),
            runtimeCall: domain.db.runtimeCall,
            inWorkflow: workflowExecution.inWorkflow,
            inStep: workflowExecution.inStep,
            workflowRunId: workflowExecution.workflowRunId,
            stepId: workflowExecution.stepId,
            reactionId: reactionId ?? null,
          };
        },
      }),
    });

    const runtime = new DomainRuntime(
      { orgId: "org_123", actorId: "user_1" },
      executionDomain,
      5,
    );
    const scoped = await runtime.use(executionDomain);

    // when: the action runs as a regular function outside a workflow.
    const result = await scoped.actions.inspectExecution({ title: "  hello step  " });

    // then: workflow metadata is reported as outside-workflow.
    expect(result).toEqual({
      title: "hello step",
      runtimeCall: 5,
      inWorkflow: false,
      inStep: false,
      workflowRunId: null,
      stepId: null,
      reactionId: null,
    });
  });
});
