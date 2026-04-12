import { configureRuntime } from "@ekairos/domain/runtime";
import { EkairosRuntime } from "@ekairos/domain";
import { eventsDomain } from "@ekairos/events";
import { configureContextDurableWorkflow } from "@ekairos/events/runtime";
import { init } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import "./lib/story-smoke.story";
import { contextEngineDurableWorkflow } from "./lib/context-engine.workflow";

const appId =
  (process.env.NEXT_PUBLIC_INSTANT_APP_ID as string) ||
  (process.env.INSTANT_APP_ID as string) ||
  (process.env.INSTANTDB_APP_ID as string);
const adminToken =
  (process.env.INSTANT_APP_ADMIN_TOKEN as string) ||
  (process.env.INSTANT_ADMIN_TOKEN as string) ||
  (process.env.INSTANTDB_ADMIN_TOKEN as string);

const appDomain =
  appId && adminToken
    ? domain("context-workflow-smoke")
        .includes(eventsDomain)
        .schema({ entities: {}, links: {}, rooms: {} })
    : null;

const db =
  appDomain && appId && adminToken
    ? init({ appId, adminToken, schema: appDomain.toInstantSchema() } as any)
    : null;

export type StorySmokeRuntimeEnv = {
  appId: string;
  adminToken: string;
  mode?: "success" | "tool-error" | "scripted";
};

export class StorySmokeRuntime extends EkairosRuntime<
  StorySmokeRuntimeEnv,
  NonNullable<typeof appDomain>,
  NonNullable<typeof db>
> {
  static [WORKFLOW_SERIALIZE](instance: StorySmokeRuntime) {
    return { env: instance.env };
  }

  static [WORKFLOW_DESERIALIZE](data: { env: StorySmokeRuntimeEnv }) {
    return new StorySmokeRuntime(data.env);
  }

  protected getDomain() {
    if (!appDomain) {
      throw new Error("Story smoke runtime domain is not configured");
    }
    return appDomain;
  }

  protected async resolveDb() {
    if (!db) {
      throw new Error("Story smoke runtime database is not configured");
    }
    return db;
  }
}

export function createStorySmokeRuntime(
  env: Omit<StorySmokeRuntimeEnv, "appId" | "adminToken"> = {},
) {
  if (!appId || !adminToken) {
    throw new Error("Story smoke runtime env is not configured");
  }
  return new StorySmokeRuntime({
    appId,
    adminToken,
    ...env,
  });
}

export const runtimeConfig =
  appDomain && db
    ? configureRuntime({
        domain: { domain: appDomain },
        runtime: async (env) => ({
          db: await createStorySmokeRuntime(env as any).db(),
        } as any),
      })
    : null;

configureContextDurableWorkflow(contextEngineDurableWorkflow);
