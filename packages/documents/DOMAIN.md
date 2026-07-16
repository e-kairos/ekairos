# Documents Domain

Module: `@ekairos/documents`

## Purpose

Documents formalizes stored `$files` into durable, page-addressable content.
Files travel through Events; Documents persist extracted content for precise,
repeatable reads.

## Aggregate

`document_documents` is the aggregate root:

```text
document_documents
  file  -> $files
  jobs  -> document_jobs
  pages -> document_pages
```

## Invariants

1. One Document is linked to one source File.
2. `ready` implies ordered readable pages were persisted.
3. Failed formalization records its error and remains retryable.
4. File bytes stay in `$files`; Documents store normalized extracted content.
5. Formalization is explicit and idempotent. It is not automatic ingestion.
6. Providers are adapters. The domain owns normalized pages and job status.

Documents has no dependency on Reactor persistence. A domain action may call
Documents inside a Reaction; the action's causal Event makes that work visible.
