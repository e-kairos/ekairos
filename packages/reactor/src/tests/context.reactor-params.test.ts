import { describe, expectTypeOf, it } from "vitest"

import type { ContextReactorParams } from "../reactors/types"

describe("ContextReactorParams public contract", () => {
  it("exposes provider-neutral actions and env without AI SDK tool state", () => {
    type Params = ContextReactorParams<Record<string, never>>

    expectTypeOf<Params>().toHaveProperty("actions")
    expectTypeOf<Params>().toHaveProperty("events")
    expectTypeOf<Params>().toHaveProperty("env")
    expectTypeOf<Params>().not.toHaveProperty("actionSpecs")
    expectTypeOf<Params>().not.toHaveProperty("toolsForModel")
  })
})
