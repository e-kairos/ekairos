# Skill: ekairos-cli

Use this skill when operating the Ekairos CLI, creating apps with the CLI, smoke-testing generated apps, or preparing CLI-driven workflows for agents.

## Dependencies

This CLI uses the domain library and its skill:

- Domain package: `@ekairos/domain`
- Domain skill: `../domain/SKILL.md`

Always read the domain skill when the CLI task involves schemas, actions, runtime routes, or generated app code.

## CLI Contract

Canonical command:

```powershell
ekairos create-app <dir> --next --install --smoke --json
```

Full demo cycle:

```powershell
ekairos create-app --demo
```

`--demo` defaults to a supply-chain app, `--next`, `--install`, `--smoke`, `--keep-server`, and `pnpm`.

Domain operations stay under the domain namespace:

```powershell
ekairos domain query "{ procurement_order: { supplier: {} } }" --baseUrl=http://localhost:3000 --admin
```

Non-interactive app creation must be explicit:

- `--json`
- `--plain`
- `--no-ui`

Non-interactive app creation must also pass a framework:

- `--next`
- or `--framework=next`

## App Creation Workflow

1. Choose a target directory under a test-apps folder when experimenting.
2. Use `--instantToken` or provide `--appId` and `--adminToken` when provisioning is required.
3. Use `--smoke` when the generated app should be verified end to end.
4. Use `--smoke --keep-server` when the user needs a live local review URL.
5. Never print admin tokens unless the user explicitly passes `--print-secrets`.

## Supply Chain Template Smoke

The default app scaffold validates:

- `supplyChain.order.launch`
- `procurement_order` nested with supplier, stock items, shipments, and inspections
- optional `supplyChain.shipment.expedite`

Expected smoke summary:

```txt
orders >= 1
shipments >= 1
inspections >= 1
```

## Help And Skill Discovery

`ekairos --help`, `ekairos create-app --help`, and `ekairos domain --help` should show skill paths.

Agents should prefer the printed skill path over guessing package internals.

## Related Skills

- Domain design and runtime code: `../domain/SKILL.md`
