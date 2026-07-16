# Esolbay Award Dataset Repro

This folder isolates captured Esolbay `award.addBidItems` dataset failures at
the `@ekairos/dataset` boundary.

The repro intentionally starts a workflow that only runs:

```ts
dataset(runtime, { datasetId })
  .sandbox(sandboxId)
  .from({ kind: "file", fileId })
  .engine(...)
  .instructions(capturedInstructions)
  .schema(capturedOutputSchema)
  .asRows()
  .build()
```

It does not execute Esolbay `addBidItemsExecuteStep`, persist bid items, or run
the inbound mail parent workflow.

Run from `packages/dataset`:

```powershell
pnpm exec vitest run -c repro/vitest.workflow.config.mts
```

The fixtures under `repro/fixtures/esolbay-award-dataset-runs` are captured
workflow inputs for:

- Roberto: original run `wrun_01KR2HXNMH0MWXWBXMVPKZW8CX`
- Provider 2: original run `wrun_01KR2HYTBJVVFKGJVQMEK6KGD0`

Each successful run writes a JSON report under `.ekairos/reports`.
