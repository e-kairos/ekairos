import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

export async function writeContextLocalJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

export async function writeContextLocalText(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value, "utf8")
}

export async function writeContextLocalBinary(path: string, value: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value)
}
