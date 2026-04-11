# Agent Test Assets

This folder contains local assets used by agent and document-parser tests.

## Expected files

- `sample-document.pdf`
- `document-with-tables.pdf`

## Required env

- `NEXT_PUBLIC_INSTANT_APP_ID`
- `INSTANT_APP_ADMIN_TOKEN`
- `LLAMA_CLOUD_API_KEY`

## Run

```bash
pnpm test src/agent/tests/document-parser.test.ts
```
