# Ekairos Workspace

Public monorepo for the reusable Ekairos packages.

## Main packages

- `@ekairos/domain`: bounded-context contracts and explicit runtimes
- `@ekairos/events`: context engine, durable execution, canonical event parts
- `@ekairos/dataset`: sandbox-backed dataset materialization
- `@ekairos/sandbox`: provider-agnostic sandbox management
- `@ekairos/openai-reactor`: Codex/OpenAI reactor integrations
- `@ekairos/testing`: temporary InstantDB apps and test helpers

## Requirements

- Node.js 20+
- pnpm 10+

## Workspace commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

## Release model

- `development`: main integration branch
- `main`: stable release branch
- package publishing is handled from CI

Useful commands:

```bash
pnpm run release:required-checks
pnpm run build:publish-packages
```

## CI requirements

- `NPM_TOKEN`
- `INSTANT_PERSONAL_ACCESS_TOKEN`

## License

Apache-2.0
