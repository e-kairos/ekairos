/**
 * Non-blocking env registration against the Ekairos Platform.
 *
 * Every time a domain runtime resolves its database, the env it was built
 * with is reported so the platform can materialize a workspace environment
 * under the registered application URL. The transport lives in
 * `@ekairos/platform` (`reportRuntimeEnv`); this module only adapts the host
 * application's env vars. Reporting is best effort and must never block or
 * break the host application.
 *
 * Configuration (host app env vars):
 * - EKAIROS_PLATFORM_URL      target platform origin; sync is disabled when unset
 * - EKAIROS_API_KEY           project credential that protects the domain route;
 *                             the platform matches it against the registered
 *                             application credential
 * - EKAIROS_PLATFORM_ORG_ID   platform organization that owns the application
 * - EKAIROS_DOMAIN_BASE_URL   public origin of this deployment (falls back to
 *                             VERCEL_URL); informational
 * - EKAIROS_DOMAIN_PATH       domain route path (default /api/domain)
 */

import { reportRuntimeEnv } from "@ekairos/platform";

type ReportableEnv = Record<string, unknown>;

function readConfig() {
  const platformUrl = (process.env.EKAIROS_PLATFORM_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const apiKey = (process.env.EKAIROS_API_KEY ?? "").trim();
  if (!platformUrl || !apiKey) return null;

  const vercelUrl = (process.env.VERCEL_URL ?? "").trim();
  const baseUrl =
    (process.env.EKAIROS_DOMAIN_BASE_URL ?? "").trim() ||
    (vercelUrl ? `https://${vercelUrl}` : "");

  return {
    platformUrl,
    apiKey,
    baseUrl: baseUrl || null,
    domainPath: (process.env.EKAIROS_DOMAIN_PATH ?? "").trim() || "/api/domain",
    organizationId: (process.env.EKAIROS_PLATFORM_ORG_ID ?? "").trim() || null,
  };
}

/**
 * Report a runtime env to the platform. Synchronous from the caller's point
 * of view: schedules a deduplicated fire-and-forget request and returns
 * immediately. Never throws.
 */
export function reportRuntimeEnvToPlatform(
  env: ReportableEnv,
  options?: { source?: string; title?: string },
): void {
  try {
    const config = readConfig();
    if (!config) return;
    reportRuntimeEnv(config, env, options);
  } catch {
    // reporting must never interfere with the host application
  }
}
