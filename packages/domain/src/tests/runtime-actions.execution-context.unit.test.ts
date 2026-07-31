/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineDomainAction, domain } from "../index.ts";
import { executeDomainAction } from "../internal.ts";
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
        async execute({ input, domain }, executionContext) {
          const workflowExecution = await readActionExecutionContext();
          return {
            title: String(input.title).trim(),
            runtimeCall: domain.db.runtimeCall,
            inWorkflow: workflowExecution.inWorkflow,
            inStep: workflowExecution.inStep,
            workflowRunId: workflowExecution.workflowRunId,
            stepId: workflowExecution.stepId,
            reactionId: executionContext?.reactionId ?? null,
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

  it("passes the public Session environment as the action second argument", async () => {
    const base = domain("session-environment").schema({
      entities: {},
      links: {},
      rooms: {},
    });
    let received: unknown;
    const executionDomain = base.withActions({
      inspect: defineDomainAction({
        input: z.object({ value: z.string() }),
        output: z.object({ value: z.string() }),
        execute({ input }, executionContext) {
          received = executionContext;
          return input;
        },
      }),
    });
    const runtime = new DomainRuntime(
      { orgId: "org_123", actorId: "user_1" },
      executionDomain,
      1,
    );
    const executionContext = Object.freeze({
      context: Object.freeze({ id: "context-1", key: "rocket:match-1" }),
      sessionId: "session-1",
      reactionId: "reaction-1",
      causeIds: Object.freeze(["event-1", "event-2"]),
    });

    await executeDomainAction(
      runtime,
      executionDomain.actions.inspect,
      { value: "ok" },
      { executionContext },
    );

    expect(received).toBe(executionContext);
  });
});
