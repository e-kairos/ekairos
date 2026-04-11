import type { ConcreteDomain } from "@ekairos/domain"
import type { ExplicitRuntimeLike } from "@ekairos/domain/runtime"

import type { ContextEnvironment } from "./context.config.js"
import type { ContextStore } from "./context.store.js"

export type ContextRuntime<
  Env extends ContextEnvironment = ContextEnvironment,
> = ExplicitRuntimeLike<Env, any, any>

export type ContextRuntimeServices = {
  db: any
  store: ContextStore
  domain?: ConcreteDomain<any, any>
}

const storeByDb = new WeakMap<object, ContextStore>()

export async function getContextRuntimeServices(
  runtime: ContextRuntime<any>,
): Promise<ContextRuntimeServices> {
  const db = await runtime.db()
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

  const resolved = await runtime.resolve()
  return {
    db,
    store,
    domain: typeof resolved === "object" && resolved !== null ? (resolved as any).meta?.()?.domain : undefined,
  }
}
