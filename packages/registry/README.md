# Ekairos Registry

Local-first shadcn-compatible source registry for Ekairos UI. Components are
copied into the consumer; the registry does not require an npm UI package or a
GitHub URL.

## Build the static registry

```bash
pnpm --filter registry registry:build
```

The consumable JSON files are written to `packages/registry/public/r`.

## Consume from the local Next server

Build the registry first, then start the app:

```bash
pnpm --filter registry registry:build
pnpm --filter registry dev
```

From a Vite application initialized with shadcn, install from the static
endpoint served by Next:

```bash
npx shadcn@latest add http://localhost:3030/r/event-timeline.json
```

The component source imports `@ekairos/events/react`. The registry dependency
is versionless so the consumer can resolve the current package release or its
own workspace dependency.

Demo fixture:

```txt
http://localhost:3030/demo/event-timeline
```

## Verification

```bash
pnpm --filter registry typecheck
pnpm --filter ekairos-workbench-v3 typecheck
pnpm --filter ekairos-workbench-v3 test -- reaction-graph.test.ts
```
