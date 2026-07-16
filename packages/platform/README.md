# @ekairos/platform

Typed client for the Ekairos Platform API. Scope today: applications ("projects"),
runtime environments, and signed domain API keys. Domain queries/actions through the
SDK are planned; use `ekairos domain ... --app=<appId>` meanwhile.

Auth is the Platform OAuth access token — the same session the CLI and Ekairos
Desktop use. Sign in once with `ekairos login`; scripts can read the token via
`ekairos token`.

```ts
import { PlatformApi } from "@ekairos/platform"

const platform = new PlatformApi({
  auth: { token: process.env.EKAIROS_PLATFORM_TOKEN! },
  // platformUrl defaults to EKAIROS_PLATFORM_URL or https://platform.ekairos.dev
})

// Applications (projects)
const apps = await platform.apps.list()
const app = await platform.apps.get("esolbay")
const { apiKey } = await platform.apps.createApiKey({ appId: "esolbay" }) // ekdk_...

// Runtime environments (e.g. one per customer org)
await platform.environments.register({
  appId: "esolbay",
  key: "disal",
  title: "DISAL",
  env: { orgId: "org_..." },
})
const environments = await platform.environments.list("esolbay")
```

Every environment `key` acts as the alias for domain operations:

```powershell
ekairos domain query "{ accounting_documents: { $: { limit: 5 } } }" --app=esolbay --env=disal
```

## Runtime env reporting (machine credential)

`reportRuntimeEnv` is the machine half: a client domain reports the runtime env it
was constructed with, authenticated by the project's own `ekdk_` key — no user
token. Fire-and-forget with a 10-minute dedup TTL; never throws, never blocks.
`@ekairos/domain` calls this automatically on every `runtime.db()` resolution
(see its `platform-sync.ts`), so host applications normally only set
`EKAIROS_PLATFORM_URL`, `EKAIROS_API_KEY`, and `EKAIROS_PLATFORM_ORG_ID`.

```ts
import { reportRuntimeEnv } from "@ekairos/platform"

reportRuntimeEnv(
  { apiKey: process.env.EKAIROS_API_KEY!, organizationId: "org_..." },
  { orgId: "org_customer" },
  { title: "Customer Name", source: "auth-provision" },
)
```

Errors throw `PlatformApiError` with `status` and the raw response `body`.
Secret-looking keys (`*apiKey`, `*secret`, `*token`) are stripped from environment
payloads server-side; environments carry routing data (like `orgId`), never credentials.
