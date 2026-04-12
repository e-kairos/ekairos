# Skill: ekairos-domain

Use this package when editing `@ekairos/domain` itself or generating sample apps and snippets around it.

## Core contract

- Model reads in the composed InstantDB graph.
- Put writes behind domain actions.
- Keep actions step-safe:
  `async execute({ runtime, input }) { "use step"; const scoped = await runtime.use(appDomain); ... }`
- Use explicit runtime classes that extend `EkairosRuntime`.
- Keep workflows above actions; call exported action definitions through `executeRuntimeAction(...)` inside `"use workflow"`.
- For Next.js adapters, use `createRuntimeRouteHandler({ createRuntime })` in an explicit app route.
- Do not use or reintroduce `withRuntime(...)`; the runtime route is no longer configured through `next.config`.

## Internal workflow

1. Open `DOMAIN.md` when available.
2. Identify the root domain and included subdomains.
3. Verify the public CLI path with `inspect`, `action`, and `query`.
4. Prefer scaffold-first examples through `create-app --next`.
5. New apps should expose `/api/ekairos/domain`; legacy `.well-known` remains only as CLI fallback.

## Related workspace skills

- `skills/ekairos-domain-design`
- `skills/ekairos-domain-cli`
