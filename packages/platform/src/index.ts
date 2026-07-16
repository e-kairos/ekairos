const DEFAULT_PLATFORM_URL = "https://platform.ekairos.dev"

export type PlatformAuth = {
  /**
   * Platform OAuth access token (obtain via `ekairos login`, then `ekairos token`),
   * or a provider called before each request.
   */
  token: string | (() => string | Promise<string>)
}

export type PlatformApiConfig = {
  auth: PlatformAuth
  /** Defaults to EKAIROS_PLATFORM_URL or https://platform.ekairos.dev */
  platformUrl?: string
}

export type PlatformEnvironment = {
  recordId: string
  environmentId: string
  key: string
  title: string
  status: string | null
  env: Record<string, unknown> | null
  lastSeenAt: string | null
  updatedAt: string | null
}

export type PlatformApplication = {
  recordId: string
  appId: string
  title: string
  status: string | null
  baseUrl: string | null
  domainPath: string | null
  environments: PlatformEnvironment[]
  updatedAt: string | null
  project: string | null
}

export type RegisterApplicationInput = {
  appId: string
  title: string
  projectId: string
  workspaceId?: string
  key?: string
  baseUrl?: string
  domainPath?: string
  /** Signed domain API key (ekdk_...) to store for this application. */
  apiKey?: string
  recordId?: string
}

export type RegisterEnvironmentInput = {
  appId: string
  key: string
  /** Runtime env payload forwarded on domain operations (e.g. { orgId: "org_..." }). */
  env: Record<string, unknown>
  title?: string
  status?: string
  recordId?: string
}

export type CreateApiKeyResult = {
  apiKey: string
  keyId: string
  apiKeyId: string
  environment?: string
  env: { EKAIROS_API_KEY: string }
}

export class PlatformApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = "PlatformApiError"
    this.status = status
    this.body = body
  }
}

function resolvePlatformUrl(value?: string) {
  const url =
    String(value ?? "").trim() ||
    String(
      (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env?.EKAIROS_PLATFORM_URL ?? "",
    ).trim() ||
    DEFAULT_PLATFORM_URL
  return url.replace(/\/+$/, "")
}

async function resolveToken(auth: PlatformAuth) {
  const token =
    typeof auth.token === "function" ? await auth.token() : auth.token
  const trimmed = String(token ?? "").trim()
  if (!trimmed) {
    throw new PlatformApiError("platform_token_required", 401, null)
  }
  return trimmed
}

export class PlatformApi {
  readonly platformUrl: string
  private readonly auth: PlatformAuth

  constructor(config: PlatformApiConfig) {
    this.platformUrl = resolvePlatformUrl(config.platformUrl)
    this.auth = config.auth
  }

  private async request<T>(input: {
    path: string
    method?: "GET" | "POST"
    body?: unknown
  }): Promise<T> {
    const token = await resolveToken(this.auth)
    const response = await fetch(`${this.platformUrl}${input.path}`, {
      method: input.method ?? (input.body === undefined ? "GET" : "POST"),
      headers: {
        authorization: `Bearer ${token}`,
        ...(input.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })

    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = text
    }

    const ok =
      response.ok &&
      (payload === null ||
        typeof payload !== "object" ||
        (payload as { ok?: unknown }).ok !== false)
    if (!ok) {
      const error =
        payload && typeof payload === "object"
          ? String((payload as { error?: unknown }).error ?? "platform_request_failed")
          : "platform_request_failed"
      throw new PlatformApiError(error, response.status, payload)
    }

    return payload as T
  }

  /** Applications registered in the caller's organization ("projects" surface). */
  readonly apps = {
    list: async (): Promise<PlatformApplication[]> => {
      const result = await this.request<{
        ok: true
        organization: string
        applications: PlatformApplication[]
      }>({ path: "/api/platform/applications/list" })
      return Array.isArray(result.applications) ? result.applications : []
    },

    get: async (appId: string): Promise<PlatformApplication | null> => {
      const target = String(appId ?? "").trim()
      if (!target) throw new PlatformApiError("app_id_required", 400, null)
      const applications = await this.apps.list()
      return applications.find((app) => app.appId === target) ?? null
    },

    register: async (input: RegisterApplicationInput) => {
      const result = await this.request<{
        ok: true
        application: {
          recordId: string
          appId: string
          key: string
          title: string
          baseUrl: string
          domainPath: string
          apiKeyId: string
        }
      }>({ path: "/api/platform/applications/upsert", body: input })
      return result.application
    },

    /**
     * Generate a signed domain API key (ekdk_...). With appId the key is stored
     * for the application; without it the key is only returned to the caller.
     */
    createApiKey: async (input: { appId?: string } = {}) => {
      return await this.request<CreateApiKeyResult>({
        path: "/api/platform/projects/api-key",
        body: input,
      })
    },
  }

  /** Runtime environments of an application (e.g. one per customer org). */
  readonly environments = {
    list: async (appId: string): Promise<PlatformEnvironment[]> => {
      const application = await this.apps.get(appId)
      if (!application) {
        throw new PlatformApiError("application_not_found", 404, null)
      }
      return application.environments
    },

    register: async (input: RegisterEnvironmentInput) => {
      const result = await this.request<{
        ok: true
        environment: {
          recordId: string
          environmentId: string
          key: string
          title: string
          env: Record<string, unknown>
        }
      }>({
        path: "/api/platform/environments/upsert",
        body: {
          appId: input.appId,
          key: input.key,
          env: input.env,
          ...(input.title ? { title: input.title } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.recordId ? { recordId: input.recordId } : {}),
        },
      })
      return result.environment
    },
  }
}

export function init(config: PlatformApiConfig) {
  return new PlatformApi(config)
}

// ---------------------------------------------------------------------------
// Runtime env reporting (machine credential)
//
// A client domain reports the runtime env it was constructed with so the
// platform can materialize a workspace environment under the registered
// application. Auth is the project's signed domain API key (ekdk_...), not a
// user token — safe to call from the host application's server runtime.
// ---------------------------------------------------------------------------

export type RuntimeEnvReportConfig = {
  /** Project domain credential (ekdk_...), the same key that protects /api/domain. */
  apiKey: string
  /** Defaults to EKAIROS_PLATFORM_URL or https://platform.ekairos.dev */
  platformUrl?: string
  /** Platform organization that owns the application (x-ekairos-organization-id). */
  organizationId?: string | null
  /** Public origin of the reporting deployment; informational. */
  baseUrl?: string | null
  /** Domain route path of the reporting deployment (default /api/domain). */
  domainPath?: string
}

export type RuntimeEnvReportOptions = {
  source?: string
  title?: string
}

const REPORT_TTL_MS = 10 * 60 * 1000
const REPORT_TIMEOUT_MS = 4000
const reportedAt = new Map<string, number>()

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null"
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item !== "function" && item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
  return `{${entries.join(",")}}`
}

function sanitizeReportEnv(env: Record<string, unknown>) {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value === undefined || typeof value === "function") continue
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      output[key] = value
      continue
    }
    try {
      output[key] = JSON.parse(JSON.stringify(value))
    } catch {
      // non-serializable env members are dropped from the report
    }
  }
  return output
}

/**
 * Report a runtime env to the platform. Fire-and-forget: schedules a
 * deduplicated request (10 min TTL per env fingerprint) and returns
 * immediately. Never throws and never blocks the host application.
 */
export function reportRuntimeEnv(
  config: RuntimeEnvReportConfig,
  env: Record<string, unknown>,
  options?: RuntimeEnvReportOptions,
): void {
  try {
    const platformUrl = resolvePlatformUrl(config.platformUrl)
    const apiKey = String(config.apiKey ?? "").trim()
    if (!apiKey) return

    const sanitized = sanitizeReportEnv(env)
    const fingerprint = `${platformUrl}|${stableStringify(sanitized)}`
    const now = Date.now()
    const last = reportedAt.get(fingerprint)
    if (last && now - last < REPORT_TTL_MS) return
    reportedAt.set(fingerprint, now)

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    }
    const organizationId = String(config.organizationId ?? "").trim()
    if (organizationId) {
      headers["x-ekairos-organization-id"] = organizationId
    }

    void fetch(`${platformUrl}/api/platform/domain/env-report`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        env: sanitized,
        baseUrl: config.baseUrl ?? null,
        domainPath: String(config.domainPath ?? "").trim() || "/api/domain",
        source: options?.source ?? "runtime",
        ...(options?.title ? { title: options.title } : {}),
        reportedAt: new Date(now).toISOString(),
      }),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    })
      .then((response) => {
        if (!response.ok) reportedAt.delete(fingerprint)
      })
      .catch(() => {
        // allow a retry on the next report
        reportedAt.delete(fingerprint)
      })
  } catch {
    // reporting must never interfere with the host application
  }
}
