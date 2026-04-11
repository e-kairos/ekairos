/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";
import { defineDomainAction, domain } from "../index.ts";
import {
  EkairosRuntime,
  configureRuntime,
  executeRuntimeAction,
  getRuntimeAction,
  getRuntimeActions,
} from "../runtime.ts";
import { readActionExecutionContext } from "./workflow.metadata.ts";

type Env = {
  orgId: string;
  actorId: string;
};

type RuntimeShape = {
  db: {
    runtimeCall: number;
  };
};

class DomainRuntime<RootDomain> extends EkairosRuntime<
  Env,
  RootDomain,
  RuntimeShape["db"]
> {
  private readonly runtimeCall: number;
  private readonly rootDomain: RootDomain;

  constructor(env: Env, rootDomain: RootDomain, runtimeCall = 1) {
    super(env);
    this.rootDomain = rootDomain;
    this.runtimeCall = runtimeCall;
  }

  protected getDomain() {
    return this.rootDomain;
  }

  protected async resolveDb() {
    return { runtimeCall: this.runtimeCall };
  }
}

function createManagementDomain() {
  const baseDomain = domain("management").schema({
    entities: {
      management_tasks: i.entity({
        title: i.string(),
        status: i.string().indexed(),
      }),
    },
    links: {},
    rooms: {},
  });

  let appDomain: any;
  appDomain = baseDomain.actions({
    normalizeTitle: {
      name: "management.task.normalizeTitle",
      description: "Normalize task titles.",
      execute: async ({ input, runtime }) => {
        "use step";
        const domain = await runtime.use(appDomain);
        return {
          title: String(input.title).trim(),
          status: "draft" as const,
          runtimeCall: domain.db.runtimeCall,
        };
      },
    },
    createTask: {
      name: "management.task.create",
      description: "Create a draft task.",
      execute: async ({ env, input, runtime }) => {
        "use step";
        const domain = await runtime.use(appDomain);
        const normalized = await domain.actions.normalizeTitle({ title: input.title });
        return {
          title: normalized.title,
          status: normalized.status,
          orgId: env.orgId,
          parentRuntimeCall: domain.db.runtimeCall,
          nestedRuntimeCall: normalized.runtimeCall,
        };
      },
    },
  });

  return { appDomain };
}

describe("runtime domain actions", () => {
  it("registers actions and executes nested calls with runtime isolation", async () => {
    const { appDomain } = createManagementDomain();
    let resolveCalls = 0;

    configureRuntime({
      domain: { domain: appDomain },
      runtime: async () => ({ db: { runtimeCall: ++resolveCalls } }),
    });

    const registered = getRuntimeActions().map((entry) => entry.name);
    expect(registered).toEqual([
      "management.task.normalizeTitle",
      "management.task.create",
    ]);
    expect(getRuntimeAction("management.task.create")?.name).toBe("management.task.create");

    const result = await executeRuntimeAction({
      action: "management.task.create",
      env: { orgId: "org_123", actorId: "user_1" },
      input: { title: "  Launch domain actions  " },
    });

    expect(result).toEqual({
      title: "Launch domain actions",
      status: "draft",
      orgId: "org_123",
      parentRuntimeCall: 1,
      nestedRuntimeCall: 1,
    });
  });

  it("fails fast when an action name is not registered", async () => {
    const emptyDomain = domain("empty").schema({
      entities: {},
      links: {},
      rooms: {},
    });

    configureRuntime({
      domain: { domain: emptyDomain },
      runtime: async () => ({ db: { runtimeCall: 1 } }),
    });

    await expect(
      executeRuntimeAction({
        action: "management.task.missing",
        env: { orgId: "org_123", actorId: "user_1" },
        input: {},
      }),
    ).rejects.toThrow("runtime_action_not_found:management.task.missing");
  });

  it("rejects duplicate names between domain actions and runtime explicit actions", () => {
    const { appDomain } = createManagementDomain();

    expect(() =>
      configureRuntime({
        domain: {
          domain: appDomain,
          actions: [
            defineDomainAction({
              name: "management.task.create",
              execute: () => ({ ok: true }),
            }),
          ],
        },
        runtime: async () => ({ db: { runtimeCall: 1 } }),
      }),
    ).toThrow("duplicate_runtime_action:management.task.create");
  });

  it("detects action recursion cycles", async () => {
    const baseCycleDomain = domain("cycle").schema({
      entities: {
        cycle_items: i.entity({
          value: i.number(),
        }),
      },
      links: {},
      rooms: {},
    });

    let cycleDomain: any;
    cycleDomain = baseCycleDomain.actions({
      actionA: defineDomainAction<Env, { value: number }, number, RuntimeShape, any>({
        name: "cycle.a",
        async execute({ runtime, input }) {
          "use step";
          const domain = await runtime.use(cycleDomain);
          return domain.actions.actionB(input);
        },
      }),
      actionB: defineDomainAction<Env, { value: number }, number, RuntimeShape, any>({
        name: "cycle.b",
        async execute({ runtime, input }) {
          "use step";
          const domain = await runtime.use(cycleDomain);
          return domain.actions.actionA(input);
        },
      }),
    });

    const runtime = new DomainRuntime(
      { orgId: "org_123", actorId: "user_1" },
      cycleDomain,
      1,
    );
    const cycle = await runtime.use(cycleDomain);

    await expect(
      cycle.actions.actionA({ value: 1 }),
    ).rejects.toThrow("domain_action_cycle:actionA");
  });

  it("lets internal clients use an explicit runtime instance directly", async () => {
    const baseExplicitDomain = domain("explicit").schema({
      entities: {},
      links: {},
      rooms: {},
    });

    let explicitDomain: any;
    explicitDomain = baseExplicitDomain.actions({
      normalizeTitle: defineDomainAction<
        Env,
        { title: string },
        { title: string; runtimeCall: number },
        DomainRuntime<any>,
        any
      >({
        name: "explicit.task.normalizeTitle",
        async execute({ input, runtime }) {
          "use step";
          const domain = await runtime.use(explicitDomain);
          return {
            title: String(input.title).trim(),
            runtimeCall: domain.db.runtimeCall,
          };
        },
      }),
      createTask: defineDomainAction<
        Env,
        { title: string },
        { title: string; orgId: string; parentRuntimeCall: number; nestedRuntimeCall: number },
        DomainRuntime<any>,
        any
      >({
        name: "explicit.task.create",
        async execute({ runtime, input }) {
          "use step";
          const domain = await runtime.use(explicitDomain);
          const normalized = await domain.actions.normalizeTitle({ title: input.title });
          return {
            title: normalized.title,
            orgId: runtime.env.orgId,
            parentRuntimeCall: domain.db.runtimeCall,
            nestedRuntimeCall: normalized.runtimeCall,
          };
        },
      }),
    });

    const runtime = new DomainRuntime(
      { orgId: "org_123", actorId: "user_1" },
      explicitDomain,
      7,
    );
    const explicit = await runtime.use(explicitDomain);

    const result = await explicit.actions.createTask({ title: "  Runtime first  " });

    expect(result).toEqual({
      title: "Runtime first",
      orgId: "org_123",
      parentRuntimeCall: 7,
      nestedRuntimeCall: 7,
    });
  });

  it("materializes an included subdomain with domain.db and domain.actions", async () => {
    const baseTasksDomain = domain("tasks").schema({
      entities: {
        tasks: i.entity({
          title: i.string(),
          status: i.string(),
        }),
      },
      links: {},
      rooms: {},
    });

    let tasksDomain: any;
    tasksDomain = baseTasksDomain.actions({
      normalizeTitle: {
        description: "Normalize title",
        inputSchema: { type: "object" },
        execute: async ({ input, runtime }) => {
          "use step";
          const domain = await runtime.use(tasksDomain);
          return {
            title: String(input.title).trim(),
            runtimeCall: domain.db.runtimeCall,
          };
        },
      },
      createTask: {
        description: "Create task",
        inputSchema: { type: "object" },
        execute: async ({ env, input, runtime }) => {
          "use step";
          const domain = await runtime.use(tasksDomain);
          const normalized = await domain.actions.normalizeTitle({ title: input.title });
          return {
            title: normalized.title,
            orgId: env.orgId,
            runtimeCall: normalized.runtimeCall,
          };
        },
      },
    });

    const appDomain = domain("app")
      .includes(tasksDomain)
      .schema({ entities: {}, links: {}, rooms: {} });

    const runtime = new DomainRuntime(
      { orgId: "org_123", actorId: "user_1" },
      appDomain,
      9,
    );

    const tasks = await runtime.use(tasksDomain);
    const result = await tasks.actions.createTask({ title: "  Ship it  " });

    expect(tasks.db.runtimeCall).toBe(9);
    expect(tasks.env.orgId).toBe("org_123");
    expect(result).toEqual({
      title: "Ship it",
      orgId: "org_123",
      runtimeCall: 9,
    });
  });

  it("executes step-marked actions outside workflow context as normal functions", async () => {
    const baseStepSafeDomain = domain("step-safe").schema({
      entities: {},
      links: {},
      rooms: {},
    });

    let stepSafeDomain: any;
    stepSafeDomain = baseStepSafeDomain.actions({
      inspectExecution: defineDomainAction<
        Env,
        { title: string },
        {
          title: string;
          runtimeCall: number;
          inWorkflow: boolean;
          inStep: boolean;
          workflowRunId: string | null;
          stepId: string | null;
        },
        DomainRuntime<any>,
        any
      >({
        name: "step.safe.inspect",
        async execute({ input, runtime }) {
          "use step";
          const execution = await readActionExecutionContext();
          const domain = await runtime.use(stepSafeDomain);
          return {
            title: String(input.title).trim(),
            runtimeCall: domain.db.runtimeCall,
            inWorkflow: execution.inWorkflow,
            inStep: execution.inStep,
            workflowRunId: execution.workflowRunId,
            stepId: execution.stepId,
          };
        },
      }),
    });

    const runtime = new DomainRuntime(
      { orgId: "org_123", actorId: "user_1" },
      stepSafeDomain,
      5,
    );
    const scoped = await runtime.use(stepSafeDomain);

    const result = await scoped.actions.inspectExecution({ title: "  hello step  " });

    expect(result).toEqual({
      title: "hello step",
      runtimeCall: 5,
      inWorkflow: false,
      inStep: false,
      workflowRunId: null,
      stepId: null,
    });
  });
});
