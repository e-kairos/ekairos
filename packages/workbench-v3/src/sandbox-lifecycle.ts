export type SandboxProbeResult = Readonly<{
  success: boolean
  error?: string
}>

export type SandboxLeaseDependencies = Readonly<{
  probe(sandboxId: string): Promise<SandboxProbeResult>
  create(): Promise<string>
}>

export function isMissingSandboxError(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value ?? "")
  return /sandbox_not_found|sandbox_not_active:(?:shutdown|error)|sandbox[\s\S]*not found|not found[\s\S]*sandbox/i.test(message)
}

export async function resolveSandboxLease(
  sandboxId: string,
  dependencies: SandboxLeaseDependencies,
): Promise<Readonly<{ sandboxId: string; replaced: boolean }>> {
  try {
    const probe = await dependencies.probe(sandboxId)
    if (probe.success) return Object.freeze({ sandboxId, replaced: false })

    const error = String(probe.error ?? "sandbox_probe_failed").trim()
    if (!isMissingSandboxError(error)) throw new Error(error)
  } catch (error) {
    if (!isMissingSandboxError(error)) throw error
  }

  const replacementId = String(await dependencies.create()).trim()
  if (!replacementId) throw new Error("sandbox_replacement_id_required")
  return Object.freeze({ sandboxId: replacementId, replaced: true })
}
