/**
 * Non-blocking env registration against the Ekairos Platform.
 *
 * Every time a domain runtime resolves its database, the env it was built
 * with is reported so the platform can materialize a workspace environment
 * under the registered application URL. Reporting is best effort and must
 * never block or break the host application.
 */

type ReportableEnv = Record<string, unknown>;

const REPORT_TTL_MS = 10 * 60 * 1000;
const REPORT_TIMEOUT_MS = 4000;
const reportedAt = new Map<string, number>();

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item !== "function" && item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(",")}}`;
}

function sanitizeEnv(env: ReportableEnv) {
  const output: ReportableEnv = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value === undefined || typeof value === "function") continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      output[key] = value;
      continue;
    }
    try {
      output[key] = JSON.parse(JSON.stringify(value));
    } catch {
      // non-serializable env members are dropped from the report
    }
  }
  return output;
}

function readConfig() {
  const platformUrl = (process.env.EKAIROS_PLATFORM_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const token = (process.env.EKAIROS_API_KEY ?? "").trim();
  if (!platformUrl || !token) return null;

  const vercelUrl = (process.env.VERCEL_URL ?? "").trim();
  const baseUrl =
    (process.env.EKAIROS_DOMAIN_BASE_URL ?? "").trim() ||
    (vercelUrl ? `https://${vercelUrl}` : "");

  return {
    platformUrl,
    token,
    baseUrl: baseUrl || null,
    domainPath: (process.env.EKAIROS_DOMAIN_PATH ?? "").trim() || "/api/domain",
    organizationId: (process.env.EKAIROS_PLATFORM_ORG_ID ?? "").trim() || null,
  };
}

export function reportRuntimeEnvToPlatform(
  env: ReportableEnv,
  options?: { source?: string; title?: string },
) {
  try {
    const config = readConfig();
    if (!config) return;

    const sanitized = sanitizeEnv(env);
    const fingerprint = stableStringify(sanitized);
    const now = Date.now();
    const last = reportedAt.get(fingerprint);
    if (last && now - last < REPORT_TTL_MS) return;
    reportedAt.set(fingerprint, now);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${config.token}`,
    };
    if (config.organizationId) {
      headers["x-ekairos-organization-id"] = config.organizationId;
    }

    void fetch(`${config.platformUrl}/api/platform/domain/env-report`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        env: sanitized,
        baseUrl: config.baseUrl,
        domainPath: config.domainPath,
        source: options?.source ?? "runtime",
        ...(options?.title ? { title: options.title } : {}),
        reportedAt: new Date(now).toISOString(),
      }),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    })
      .then((response) => {
        if (!response.ok) reportedAt.delete(fingerprint);
      })
      .catch(() => {
        reportedAt.delete(fingerprint);
      });
  } catch {
    // reporting must never interfere with the host application
  }
}
