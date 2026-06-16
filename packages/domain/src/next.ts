import {
  executeRuntimeAction,
  type RuntimeDomainSource,
  type RuntimeResolveOptions,
} from "./runtime.js"
import { getDomainActionBinding, getDomainActions } from "./index.js"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"

type RuntimeLike = {
  env?: Record<string, unknown>
  db(options?: RuntimeResolveOptions): Promise<any>
  meta(): {
    domain?: RuntimeDomainSource | null
    schema?: unknown
    context?: unknown
    contextString?: string
  }
}

export type CreateRuntimeRouteHandlerOptions<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Runtime extends RuntimeLike = RuntimeLike,
> = {
  createRuntime: (env: Env) => Runtime | Promise<Runtime>
}

export type RuntimeRouteHandlers = {
  (req: Request): Promise<Response>
  GET(req: Request): Promise<Response>
  POST(req: Request): Promise<Response>
}

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function listKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return []
  return Object.keys(value as Record<string, unknown>)
}

function parseBody(bodyText: string) {
  try {
    return JSON.parse(bodyText)
  } catch {
    return null
  }
}

function serializeActionSchema(value: unknown) {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function resolveActionKey(domain: RuntimeDomainSource | null, action: unknown) {
  const binding = getDomainActionBinding(action as any) as any
  if (typeof binding?.key === "string" && binding.key.trim()) {
    return binding.key.trim()
  }

  if (!domain || typeof (domain as any).getActions !== "function") {
    return undefined
  }

  const actionName = String((action as any)?.name ?? "").trim()
  const actions = (domain as any).getActions() as unknown[]
  for (const candidate of actions) {
    if (String((candidate as any)?.name ?? "").trim() !== actionName) continue
    const candidateBinding = getDomainActionBinding(candidate as any) as any
    if (typeof candidateBinding?.key === "string" && candidateBinding.key.trim()) {
      return candidateBinding.key.trim()
    }
  }

  return undefined
}

function listRuntimeActions(domain: RuntimeDomainSource | null) {
  return getDomainActions(domain).map((action) => ({
    name: String(action.name ?? "").trim(),
    key: resolveActionKey(domain, action),
    description: typeof action.description === "string" ? action.description : null,
    inputSchema: serializeActionSchema((action as any).inputSchema),
    outputSchema: serializeActionSchema((action as any).outputSchema),
  }))
}

function findRuntimeAction(domain: RuntimeDomainSource | null, name: string) {
  const normalized = String(name ?? "").trim()
  if (!normalized) return null

  return (
    getDomainActions(domain).find((action) => {
      if (String(action.name ?? "").trim() === normalized) return true
      const key = resolveActionKey(domain, action)
      return typeof key === "string" && key === normalized
    }) ?? null
  )
}

function buildDomainSummary(domain: RuntimeDomainSource | null) {
  if (!domain) {
    return {
      available: false,
      entities: [],
      links: [],
      rooms: [],
      meta: {},
    }
  }

  if (typeof domain.context === "function") {
    return domain.context()
  }

  return {
    available: true,
    entities: listKeys(domain.entities),
    links: listKeys(domain.links),
    rooms: listKeys(domain.rooms),
    meta: domain.meta ?? {},
  }
}

function resolveBearerToken(req: Request) {
  const header = req.headers.get("authorization") || ""
  if (!header.startsWith("Bearer ")) return null
  return header.slice("Bearer ".length).trim()
}

function resolveImpersonatedDb(db: any, body: any) {
  if (typeof db?.asUser !== "function") return db

  const asEmail = String(body?.asEmail ?? "").trim()
  if (asEmail) return db.asUser({ email: asEmail })

  if (Boolean(body?.asGuest)) return db.asUser({ guest: true })

  return db
}

const EKAIROS_DOMAIN_KEY_ID_HEADER = "x-ekairos-domain-key-id"
const EKAIROS_DOMAIN_TIMESTAMP_HEADER = "x-ekairos-domain-timestamp"
const EKAIROS_DOMAIN_SIGNATURE_HEADER = "x-ekairos-domain-signature"
const SIGNATURE_VERSION = "v1"

function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function parseDomainApiKey(apiKey: string) {
  const match = /^ekdk_(test|live)_([A-Za-z0-9_-]{12,})_([A-Za-z0-9_-]{32,})$/.exec(
    apiKey.trim(),
  )
  if (!match) return null
  return {
    environment: match[1] as "test" | "live",
    keyId: match[2],
    secret: match[3],
  }
}

function pathWithSearch(url: string | URL) {
  const parsed = typeof url === "string" ? new URL(url) : url
  return `${parsed.pathname}${parsed.search}`
}

function canonicalPayload(input: {
  body?: string
  method: string
  timestamp: number
  url: string | URL
}) {
  return [
    "ekairos-domain",
    SIGNATURE_VERSION,
    String(input.timestamp),
    input.method.toUpperCase(),
    pathWithSearch(input.url),
    sha256Hex(input.body ?? ""),
  ].join("\n")
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function verifySignedDomainRequest(input: {
  apiKey: string
  body?: string
  headers: Headers
  method: string
  now?: number
  toleranceSeconds?: number
  url: string | URL
}) {
  const parsed = parseDomainApiKey(input.apiKey)
  if (!parsed) return { ok: false as const, error: "domain_api_key_invalid" }
  const keyId = input.headers.get(EKAIROS_DOMAIN_KEY_ID_HEADER)?.trim()
  if (keyId !== parsed.keyId) return { ok: false as const, error: "key_id_invalid" }
  const timestamp = Number(input.headers.get(EKAIROS_DOMAIN_TIMESTAMP_HEADER))
  if (!Number.isFinite(timestamp)) {
    return { ok: false as const, error: "timestamp_invalid" }
  }
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const toleranceSeconds = input.toleranceSeconds ?? 300
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { ok: false as const, error: "timestamp_outside_tolerance" }
  }
  const signature = input.headers
    .get(EKAIROS_DOMAIN_SIGNATURE_HEADER)
    ?.trim()
    .replace(/^v1=/, "")
  if (!signature) return { ok: false as const, error: "signature_missing" }
  const expected = createHmac("sha256", parsed.secret)
    .update(
      canonicalPayload({
        body: input.body,
        method: input.method,
        timestamp,
        url: input.url,
      }),
    )
    .digest("base64url")
  if (!safeEqual(signature, expected)) {
    return { ok: false as const, error: "signature_invalid" }
  }
  return { ok: true as const, keyId: parsed.keyId, timestamp }
}

function configuredDomainApiKey() {
  return String(process.env.EKAIROS_API_KEY ?? "").trim() || null
}

function requireDomainRouteAuth(input: {
  bodyText?: string
  req: Request
}): Response | null {
  const apiKey = configuredDomainApiKey()
  if (!apiKey) {
    return json(
      { ok: false, error: "ekairos_api_key_not_configured" },
      { status: 500 },
    )
  }

  if (parseDomainApiKey(apiKey)) {
    const verification = verifySignedDomainRequest({
      apiKey,
      body: input.bodyText ?? "",
      headers: input.req.headers,
      method: input.req.method,
      url: input.req.url,
    })
    if (!verification.ok) {
      return json(
        { ok: false, error: "ekairos_domain_unauthorized", reason: verification.error },
        { status: 401 },
      )
    }
    return null
  }

  const token = resolveBearerToken(input.req)
  if (token !== apiKey) {
    return json(
      { ok: false, error: "ekairos_domain_unauthorized" },
      { status: 401 },
    )
  }

  return null
}

function truncateQueryResult(result: Record<string, unknown>) {
  const MAX_QUERY_ROWS = 50
  const output: Record<string, unknown> = {}
  const truncation: Record<string, { returned: number; total: number }> = {}

  for (const [key, value] of Object.entries(result ?? {})) {
    if (Array.isArray(value)) {
      const total = value.length
      const returned = Math.min(total, MAX_QUERY_ROWS)
      output[key] = value.slice(0, returned)
      if (total > returned) truncation[key] = { returned, total }
      continue
    }
    output[key] = value
  }

  return {
    data: output,
    truncated: Object.keys(truncation).length > 0 ? truncation : null,
  }
}

export function createRuntimeRouteHandler<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Runtime extends RuntimeLike = RuntimeLike,
>(options: CreateRuntimeRouteHandlerOptions<Env, Runtime>): RuntimeRouteHandlers {
  function resolveEnvFor(body: unknown): Env {
    return asRecord((body as any)?.env) as Env
  }

  async function createRuntimeFor(
    body: unknown,
    resolvedEnv?: Env,
  ): Promise<Runtime> {
    const env = resolvedEnv ?? resolveEnvFor(body)
    return await options.createRuntime(env)
  }

  async function GET(req: Request) {
      const authError = requireDomainRouteAuth({ req })
      if (authError) return authError

      const runtime = await createRuntimeFor(null)
      const meta = runtime.meta()
      const domain = (meta.domain ?? null) as RuntimeDomainSource | null
      const apiKey = configuredDomainApiKey()

      return json({
        ok: true,
        mode: "full",
        instant: {
          appId: String(runtime.env?.appId ?? process.env.NEXT_PUBLIC_INSTANT_APP_ID ?? "") || null,
          apiURI: String(process.env.EKAIROS_DOMAIN_API_URI ?? process.env.INSTANT_API_URI ?? "https://api.instantdb.com"),
          projectId: String(process.env.EKAIROS_PROJECT_ID ?? "") || null,
        },
        auth: {
          required: true,
          scheme: parseDomainApiKey(apiKey ?? "") ? "ekairos-domain-signature" : "bearer",
          supportsRefreshToken: false,
          supportsBearerToken: !parseDomainApiKey(apiKey ?? ""),
        },
        domain: buildDomainSummary(domain),
        schema: meta.schema,
        contextString: meta.contextString ?? (typeof domain?.contextString === "function" ? domain.contextString() : null),
        actions: listRuntimeActions(domain),
      })
    }

    async function POST(req: Request) {
      const bodyText = await req.text()
      const authError = requireDomainRouteAuth({ bodyText, req })
      if (authError) return authError

      const body = parseBody(bodyText)
      const op = String((body as any)?.op ?? ((body as any)?.action ? "action" : "query")).trim()
      const env = resolveEnvFor(body)
      const runtime = await createRuntimeFor(body, env)
      const meta = runtime.meta()
      const domain = (meta.domain ?? null) as RuntimeDomainSource | null
      const db = resolveImpersonatedDb(await runtime.db(), body)

      if (op === "action") {
        const actionName = String((body as any)?.action ?? "")
        const action = findRuntimeAction(domain, actionName)
        if (!action) {
          return json(
            {
              ok: false,
              error: `runtime_action_not_found:${actionName}`,
            },
            { status: 404 },
          )
        }

        try {
          const output = await executeRuntimeAction({
            action: action as any,
            runtime: {
              ...runtime,
              async db() {
                return db
              },
            } as any,
            input: (body as any)?.input ?? {},
          })

          return json({
            ok: true,
            action: action.name,
            output,
            source: "runtime-route",
          })
        } catch (error) {
          return json(
            {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              source: "runtime-route",
            },
            { status: 500 },
          )
        }
      }

      const query = (body as any)?.query ?? null
      if (!query) return new Response("Missing query", { status: 400 })

      try {
        const result = await db.query(query)
        return json({
          ok: true,
          source: "runtime-route",
          ...truncateQueryResult(asRecord(result)),
        })
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            source: "runtime-route",
          },
          { status: 500 },
        )
      }
    }

  const handler = async (req: Request) => {
    if (req.method === "GET") return GET(req)
    if (req.method === "POST") return POST(req)
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, POST" },
    })
  }

  return Object.assign(handler, { GET, POST })
}
