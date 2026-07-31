/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { start } from "workflow/api"

import {
  usingCatchWorkflow,
  usingSuccessWorkflow,
} from "./workflow/using.workflow-fixtures.ts"

describe("await using dentro de use workflow", () => {
  it("dispose corre al cerrar el scope, despues del cuerpo y antes del after-scope", async () => {
    const run = await start(usingSuccessWorkflow, [{ stepInDispose: false }])
    const result = await run.returnValue

    expect(result.log).toEqual(["start", "step:body", "disposed", "after-scope"])
  })

  it("un use step ADENTRO del dispose tambien funciona", async () => {
    const run = await start(usingSuccessWorkflow, [{ stepInDispose: true }])
    const result = await run.returnValue

    expect(result.log).toEqual([
      "start",
      "step:body",
      "step:inside-dispose",
      "disposed",
      "after-scope",
    ])
  })

  it("con excepcion: dispose corre ANTES del catch", async () => {
    const run = await start(usingCatchWorkflow, [])
    const result = await run.returnValue

    expect(result.log).toEqual(["start", "disposed", "caught:boom"])
  })
})
