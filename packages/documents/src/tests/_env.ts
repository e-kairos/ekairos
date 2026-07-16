import { resolve } from "node:path"

import { config as dotenvConfig } from "dotenv"
import { describe, it } from "vitest"

import {
  createTestApp,
  destroyTestApp,
} from "../../../ekairos-test/src/provision.ts"

const envRoots = [
  process.cwd(),
  resolve(process.cwd(), ".."),
  resolve(process.cwd(), "..", ".."),
  resolve(process.cwd(), "..", "..", ".."),
  resolve(process.cwd(), "..", "ekairos-core"),
  resolve(process.cwd(), "..", "..", "ekairos-core"),
  resolve(process.cwd(), "..", "..", "..", "ekairos-core"),
]

for (const root of envRoots) {
  dotenvConfig({ path: resolve(root, ".env.local"), quiet: true })
  dotenvConfig({ path: resolve(root, ".env"), quiet: true })
}

function getInstantProvisionToken() {
  return String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
}

export function hasInstantProvisionToken(): boolean {
  return Boolean(getInstantProvisionToken())
}

export function hasLlamaCloudKey(): boolean {
  return Boolean(String(process.env.LLAMA_CLOUD_API_KEY ?? "").trim())
}

export async function provisionDocumentsTestApp(params: {
  name: string
  schema: any
}): Promise<{ appId: string; adminToken: string; title: string }> {
  const token = getInstantProvisionToken()
  if (!token) {
    throw new Error(
      "INSTANT_PERSONAL_ACCESS_TOKEN is required for @ekairos/documents Instant tests.",
    )
  }
  return await createTestApp({
    name: params.name,
    token,
    schema: params.schema,
  })
}

export async function destroyDocumentsTestApp(appId: string): Promise<void> {
  const token = getInstantProvisionToken()
  if (!token || !appId) return
  await destroyTestApp({ appId, token })
}

export const describeInstant = ((name: string, fn: Parameters<typeof describe>[1]) =>
  (hasInstantProvisionToken() ? describe : describe.skip)(name, fn)) as typeof describe

export const itInstant = ((name: string, fn: Parameters<typeof it>[1], timeout?: number) =>
  (hasInstantProvisionToken() ? it : it.skip)(name, fn, timeout)) as typeof it

export const itLlamaCloud = ((name: string, fn: Parameters<typeof it>[1], timeout?: number) =>
  (hasInstantProvisionToken() && hasLlamaCloudKey() ? it : it.skip)(
    name,
    fn,
    timeout,
  )) as typeof it
