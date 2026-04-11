import "server-only";

import { init } from "@instantdb/admin";
import { EkairosRuntime, type DomainSchemaResult } from "@ekairos/domain";
import {
  configureRuntime,
  resolveRuntime as resolveDomainRuntime,
} from "@ekairos/domain/runtime";
import type {
  DomainDbFor,
  DomainRuntime,
  RuntimeResolveOptions,
} from "@ekairos/domain/runtime";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import appDomain from "@/lib/domain";

export type RegistryRuntimeEnv<Extra extends Record<string, unknown> = {}> = Extra & {
  instant: {
    appId: string;
    adminToken: string;
  };
};

const runtimeDbCache = new Map<string, DomainDbFor<DomainSchemaResult>>();

function normalizeRuntimeEnv<Extra extends Record<string, unknown> = {}>(
  env: RegistryRuntimeEnv<Extra>,
): RegistryRuntimeEnv<Extra> {
  const appId = String(env?.instant?.appId ?? "").trim();
  const adminToken = String(env?.instant?.adminToken ?? "").trim();
  if (!appId || !adminToken) {
    throw new Error("[registry runtime] instant.appId and instant.adminToken are required.");
  }
  return {
    ...(env as Extra),
    instant: {
      appId,
      adminToken,
    },
  } as RegistryRuntimeEnv<Extra>;
}

async function resolveRuntimeDb<D extends DomainSchemaResult>(
  env: RegistryRuntimeEnv,
  domain: D,
): Promise<DomainDbFor<D>> {
  const normalizedEnv = normalizeRuntimeEnv(env);
  const cacheKey = `${normalizedEnv.instant.appId}:${normalizedEnv.instant.adminToken}`;
  const cached = runtimeDbCache.get(cacheKey);
  if (cached) {
    return cached as unknown as DomainDbFor<D>;
  }

  const schema = domain.toInstantSchema();
  const db = init({
    appId: normalizedEnv.instant.appId,
    adminToken: normalizedEnv.instant.adminToken,
    schema,
    useDateObjects: true,
  }) as unknown as DomainDbFor<D>;

  runtimeDbCache.set(cacheKey, db as unknown as DomainDbFor<DomainSchemaResult>);
  return db;
}

export class RegistryRuntime<Extra extends Record<string, unknown> = {}> extends EkairosRuntime<
  RegistryRuntimeEnv<Extra>,
  typeof appDomain,
  DomainDbFor<typeof appDomain>
> {
  static [WORKFLOW_SERIALIZE](instance: RegistryRuntime<any>) {
    return this.serializeRuntime(instance);
  }

  static [WORKFLOW_DESERIALIZE](data: { env: RegistryRuntimeEnv<any> }) {
    return new RegistryRuntime(data.env);
  }

  protected getDomain() {
    return appDomain;
  }

  protected async resolveDb(env: RegistryRuntimeEnv<Extra>) {
    return await resolveRuntimeDb(env, appDomain);
  }
}

export function createRegistryRuntime<Extra extends Record<string, unknown> = {}>(
  env: RegistryRuntimeEnv<Extra>,
) {
  return new RegistryRuntime<Extra>(env);
}

export async function resolveRegistryRuntime<D extends DomainSchemaResult>(
  env: RegistryRuntimeEnv,
  domain: D,
  options?: RuntimeResolveOptions,
): Promise<DomainRuntime<D, DomainDbFor<D>>> {
  return await resolveDomainRuntime(domain, env, options);
}

export const runtimeConfig = configureRuntime({
  domain: {
    domain: appDomain,
  },
  runtime: async (env: RegistryRuntimeEnv, domain) => {
    const resolvedDomain = domain as DomainSchemaResult | null | undefined;
    if (!resolvedDomain) {
      throw new Error("[registry runtime] explicit domain is required.");
    }
    const db = await resolveRuntimeDb(env, resolvedDomain);
    return { db };
  },
});

