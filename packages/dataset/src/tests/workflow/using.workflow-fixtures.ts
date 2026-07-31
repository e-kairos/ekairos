// PRUEBA: `await using` (Symbol.asyncDispose) dentro de "use workflow".
// Evidencia en banda: el orden de `log` viaja en el returnValue del workflow.

export async function echoStep(value: string): Promise<string> {
  "use step"
  return `step:${value}`
}

function probe(log: string[], stepInDispose: boolean) {
  return {
    async [Symbol.asyncDispose]() {
      if (stepInDispose) {
        // caso agresivo: un "use step" ADENTRO del dispose
        log.push(await echoStep("inside-dispose"))
      }
      log.push("disposed")
    },
  }
}

export async function usingSuccessWorkflow(input: { stepInDispose: boolean }) {
  "use workflow"
  const log: string[] = []
  {
    await using _guard = probe(log, input.stepInDispose)
    log.push("start")
    log.push(await echoStep("body"))
  }
  log.push("after-scope")
  return { log }
}

export async function usingCatchWorkflow() {
  "use workflow"
  const log: string[] = []
  try {
    await using _guard = probe(log, false)
    log.push("start")
    throw new Error("boom")
  } catch (error) {
    log.push(`caught:${(error as Error).message}`)
  }
  return { log }
}
