import { resolve } from "node:path"

import { config as dotenvConfig } from "dotenv"
import {
  createTestApp,
  destroyTestApp,
} from "../../../ekairos-test/src/provision.ts"
import type {
  EntitiesDef,
  InstantSchemaDef,
  LinksDef,
  RoomsDef,
} from "@instantdb/core"
import { describe, it } from "vitest"

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

type AnyInstantSchema = InstantSchemaDef<EntitiesDef, LinksDef<EntitiesDef>, RoomsDef>
type CreateTestAppResult = {
  appId: string
  adminToken: string
  title: string
}

function getInstantProvisionToken() {
  return String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
}

export function hasInstantProvisionToken(): boolean {
  return Boolean(getInstantProvisionToken())
}

export async function provisionContextTestApp(params: {
  name: string
  schema: AnyInstantSchema
}): Promise<CreateTestAppResult> {
  const token = getInstantProvisionToken()
  if (!token) {
    throw new Error(
      "INSTANT_PERSONAL_ACCESS_TOKEN is required for @ekairos/events Instant tests.",
    )
  }

  return await createTestApp({
    name: params.name,
    token,
    schema: params.schema,
  })
}

export async function destroyContextTestApp(appId: string): Promise<void> {
  const token = getInstantProvisionToken()
  if (!token || !appId) return

  await destroyTestApp({
    appId,
    token,
  })
}

export const describeInstant = ((name: string, fn: Parameters<typeof describe>[1]) =>
  (hasInstantProvisionToken() ? describe : describe.skip)(name, fn)) as typeof describe

export const itInstant = ((name: string, fn: Parameters<typeof it>[1], timeout?: number) =>
  (hasInstantProvisionToken() ? it : it.skip)(name, fn, timeout)) as typeof it
