# Skill: ekairos-domain

Use this skill when creating, editing, reviewing, or operating Ekairos domain code.

## Core Contract

- Model knowledge boundaries as domains first. A domain owns one coherent concept.
- Domain names are camelCase, for example `supplierNetwork`, `procurement`, `qualityControl`.
- Entity names must follow `<domainName>_<entityName>`, for example `supplierNetwork_supplier`.
- Put writes behind `defineDomainAction(...)`.
- Keep action bodies step-safe:
  `async execute({ runtime, input }) { "use step"; const scoped = await runtime.use(appDomain); ... }`
- Prefer typed action calls in app-owned code:
  `const scoped = await runtime.use(appDomain); await scoped.actions.launchOrder(input);`
- Use string action names only for dynamic runtime/HTTP/CLI execution.
- Use explicit runtime classes that extend `EkairosRuntime`.
- New Next.js apps expose `/api/ekairos/domain` through `createRuntimeRouteHandler({ createRuntime })`.
- Do not use or reintroduce `withRuntime(...)`.

## Domain Design Workflow

1. Identify the knowledge domains before writing schema.
2. Name every entity with its owning domain prefix.
3. Use `domain(...).includes(...)` only when one domain needs another domain's entities or links.
4. Keep root app domains thin. The root should usually include domains and register actions.
5. Write actions around business use cases, not CRUD verbs.
6. Verify the graph with a nested query that crosses at least two domains.

## Schema Rules

- Prefer operational names over abstract names.
- Avoid generic `app_*` entities in new examples unless the domain itself is `app`.
- Do not duplicate entity names across domains.
- Links should describe the business relationship, not implementation plumbing.
- Use optional attributes when migrating an existing app with data.

## Runtime And Actions

- Dynamic endpoints may call `executeRuntimeAction({ action: "domain.action", input })`.
- Workflows and app code should use typed scoped actions.
- Action outputs should return durable ids needed by callers.
- Keep actions idempotent where possible when they will be used by smoke tests or agents.

## Verification

For a generated or edited app:

1. Run `pnpm typecheck`.
2. Start the app locally.
3. Verify `GET /api/ekairos/domain`.
4. Execute at least one domain action.
5. Query the linked graph produced by that action.

## Related Skills

- CLI/application workflow skill: `../cli/SKILL.md`
