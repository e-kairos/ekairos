import type { MaterializedDomainLike } from "@ekairos/domain";
import {
  configureRuntime,
  getRuntimeConfig,
  type RuntimeResolver,
} from "@ekairos/domain/runtime";
import { createAppTestingDomain, ekairosTestDomain } from "./schema.js";

export type ResolveEkairosRuntime<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Domain extends MaterializedDomainLike = MaterializedDomainLike,
  Runtime = unknown,
> = (params: { env: Env; domain: Domain }) => Promise<Runtime> | Runtime;

export type ComposeTestDomain = (params: {
  appDomain: MaterializedDomainLike;
  testDomain: MaterializedDomainLike;
  name?: string;
}) => MaterializedDomainLike;

export type TestRuntimeParams<
  Env extends Record<string, unknown> = Record<string, unknown>,
> = {
  testDomain?: MaterializedDomainLike;
  composedDomainName?: string;
  resolveRuntime: ResolveEkairosRuntime<Env, MaterializedDomainLike, unknown>;
  shouldInject?: (params: { env: Env; domain: MaterializedDomainLike }) => boolean;
  composeDomain?: ComposeTestDomain;
  runtimeDomain?: MaterializedDomainLike;
};

function composeTestDomain(params: {
  appDomain: MaterializedDomainLike;
  testDomain: MaterializedDomainLike;
  name?: string;
  composeDomain?: ComposeTestDomain;
}): MaterializedDomainLike {
  if (params.composeDomain) {
    return params.composeDomain({
      appDomain: params.appDomain,
      testDomain: params.testDomain,
      name: params.name,
    });
  }

  return createAppTestingDomain({
    appDomain: params.appDomain,
    testDomain: params.testDomain,
    name: params.name,
  });
}

export async function getEkairosRuntime<
  Env extends Record<string, unknown>,
  Domain extends MaterializedDomainLike,
  Runtime,
>(params: {
  env: Env;
  domain: Domain;
  resolveRuntime: ResolveEkairosRuntime<Env, Domain, Runtime>;
}): Promise<Runtime> {
  if (!params.domain) {
    throw new Error("getEkairosRuntime requires an explicit domain.");
  }
  return await params.resolveRuntime({
    env: params.env,
    domain: params.domain,
  });
}

export async function getEkairosTestRuntime<
  Env extends Record<string, unknown>,
  Runtime,
>(params: {
  env: Env;
  appDomain: MaterializedDomainLike;
  testDomain?: MaterializedDomainLike;
  composedDomainName?: string;
  resolveRuntime: ResolveEkairosRuntime<Env, MaterializedDomainLike, Runtime>;
  composeDomain?: ComposeTestDomain;
}): Promise<{ runtime: Runtime; domain: MaterializedDomainLike }> {
  const domain = composeTestDomain({
    appDomain: params.appDomain,
    testDomain: params.testDomain ?? ekairosTestDomain,
    name: params.composedDomainName,
    composeDomain: params.composeDomain,
  });

  const runtime = await getEkairosRuntime({
    env: params.env,
    domain,
    resolveRuntime: params.resolveRuntime,
  });

  return { runtime, domain };
}

export function configureTestRuntime<
  Env extends Record<string, unknown> = Record<string, unknown>,
>(params: TestRuntimeParams<Env>): void {
  const testDomain = params.testDomain ?? ekairosTestDomain;

  const runtimeResolver: RuntimeResolver<Env> = async (env, domain) => {
    const appDomain = domain as MaterializedDomainLike | null | undefined;
    if (!appDomain) {
      throw new Error(
        "configureTestRuntime requires runtime(domain, env) calls with an explicit domain."
      );
    }

    const shouldInject = params.shouldInject
      ? params.shouldInject({ env, domain: appDomain })
      : true;

    const resolvedDomain = shouldInject
      ? composeTestDomain({
          appDomain,
          testDomain,
          name: params.composedDomainName,
          composeDomain: params.composeDomain,
        })
      : appDomain;

    return await params.resolveRuntime({
      env,
      domain: resolvedDomain,
    });
  };

  const existing = getRuntimeConfig();
  configureRuntime({
    runtime: runtimeResolver,
    domain: {
      ...(existing ?? {}),
      domain: params.runtimeDomain ?? existing?.domain,
    },
  });
}
