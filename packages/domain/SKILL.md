# Skill: ekairos-domain

## Goal
Provide consistent guidance for working with `@ekairos/domain` in agents and codegen.

## Minimum requirement
- Prefer explicit runtimes via `new AppRuntime(env)` over hidden globals.
- Read through the composed InstantDB schema when no write boundary is needed.
- Put writes and invariants behind domain actions.
- For new domain actions, use:
  `async execute({ runtime, input }) { "use step"; const domain = await runtime.use(exportedDomain); ... }`

## Workflow
1) Open the domain package `DOMAIN.md` when available.
2) Identify the root domain and any included subdomains.
3) For reads, prefer the typed InstantDB client bound to the composed root domain.
4) For writes, call `runtime.use(domain).actions.<name>(input)` or `executeRuntimeAction(...)`.
5) Treat domain actions as step-safe building blocks. Reconstruct a local scoped handle with `await runtime.use(exportedDomain)` inside `execute(...)`. Durable orchestration belongs in separate workflow functions that call those actions.
6) Use `domain.context()` or `domain.contextString()` when AI/system context is needed.

## Notes
- A domain is a bounded-context contract, not a transport API.
- `runtime.use(subdomain)` narrows to one domain-scoped handle while keeping the same real DB and env.
- Actions should reconstruct a local scoped handle with `runtime.use(exportedDomain)` and then call `domain.actions.*`.
- `"use workflow"` is not the action contract. For now, action bodies should be `"use step"` and workflows should orchestrate above them.
- `domain.toInstantSchema()` returns the flattened InstantDB schema for the composed domain graph.
