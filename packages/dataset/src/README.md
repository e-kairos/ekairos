# Dataset Runtime

Internal implementation notes for the dataset package.

## Core idea

`@ekairos/dataset` turns query, file, text, and dataset sources into persisted datasets.

It uses:

- InstantDB for canonical dataset records and files
- `@ekairos/events` for iterative agent loops
- `@ekairos/sandbox` for command execution and file processing

## High-level flow

1. Create or update dataset metadata.
2. Materialize source data.
3. Run sandbox-backed transforms when needed.
4. Validate rows against schema.
5. Upload JSONL output to InstantDB storage.
6. Mark the dataset as completed.

## Important rule

Reads and metadata live in InstantDB.
Heavy file or transform work lives in sandbox commands.
