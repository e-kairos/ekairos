import type { ConcreteDomain, MaterializedDomainLike } from "@ekairos/domain"
import type { EkairosRuntime, RuntimeForDomain, RuntimeResolveOptions } from "@ekairos/domain/runtime"

import type { ContextStore } from "./context.store.js"
import { contextDomain } from "./schema.js"

export type ContextRuntime<
  Env extends Record<string, unknown> = Record<string, unknown>,
> = EkairosRuntime<Env, any, any>

export type ContextRuntimeServiceHandle = {
  db: any | ((...args: any[]) => Promise<any> | any)
  resolve?: (...args: any[]) => Promise<any> | any
  meta?: (...args: any[]) => Record<string, unknown> | undefined
}

export type ContextRuntimeHandleForDomain<
  Env extends Record<string, unknown> = Record<string, unknown>,
  RequiredDomain extends MaterializedDomainLike = typeof contextDomain,
> = ContextRuntimeServiceHandle & {
  use<Subdomain extends typeof contextDomain | RequiredDomain>(
    subdomain: Subdomain,
    options?: RuntimeResolveOptions,
  ): Promise<unknown>
}

export type ContextRuntimeForDomain<
  Runtime extends ContextRuntime<any>,
  RequiredDomain extends MaterializedDomainLike = typeof contextDomain,
> =
  & RuntimeForDomain<Runtime, typeof contextDomain>
  & RuntimeForDomain<Runtime, RequiredDomain>

export type ContextRuntimeServices = {
  db: any
  store: ContextStore
  domain?: ConcreteDomain<any, any>
}

const storeByDb = new WeakMap<object, ContextStore>()

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

export async function getContextRuntimeServices(
  runtime: ContextRuntimeServiceHandle,
): Promise<ContextRuntimeServices> {
  const runtimeRecord = asRecord(runtime)
  const dbMember = runtimeRecord.db
  const db =
    typeof dbMember === "function"
      ? await (dbMember as () => Promise<any>).call(runtime)
      : dbMember
  if (!db) {
    throw new Error("Context runtime did not provide a database instance.")
  }

  let store = typeof db === "object" && db !== null ? storeByDb.get(db as object) : undefined
  if (!store) {
    const { InstantStore } = await import("./stores/instant.store.js")
    store = new InstantStore(db)
    if (typeof db === "object" && db !== null) {
      storeByDb.set(db as object, store)
    }
  }

  const resolveMember = runtimeRecord.resolve
  const resolved =
    typeof resolveMember === "function"
      ? await (resolveMember as () => Promise<unknown>).call(runtime)
      : runtime
  const resolvedMeta = asRecord(resolved).meta
  const ownMeta = runtimeRecord.meta
  const meta =
    typeof resolvedMeta === "function"
      ? resolvedMeta.call(resolved)
      : typeof ownMeta === "function"
        ? ownMeta.call(runtime)
        : undefined
  const domain = asRecord(meta).domain
  return {
    db,
    store,
    domain: domain as ConcreteDomain<any, any> | undefined,
  }
}
