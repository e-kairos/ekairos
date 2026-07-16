# @ekairos/documents

Formalize stored Files into durable, queryable Documents with ordered pages.

## Compose the domain

```ts
import { documentDomain } from "@ekairos/documents"

export const appDomain = domain("app")
  .includes(documentDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
```

## Read or formalize

```ts
const api = documents(runtime)

const document = await api.create(fileId)
document.id
document.status
document.pagesCount

await document.text()
await document.page(2)
await document.pages([0, 1])

const result = await api.read(fileId, {
  pages: [3, 4],
  maxChars: 20_000,
})
```

`create` is idempotent. Plain text, JSON, CSV, and Markdown are formalized
inline. Other media uses the configured parsing provider.

## Domain-action use

Documents becomes visible in a Reaction through an application domain action:

```ts
const readAwardDocument = defineDomainAction({
  description: "Read one attached award document.",
  input: z.object({ fileId: z.string() }),
  output: z.object({ documentId: z.string(), content: z.string() }),
  async execute({ runtime, input }) {
    const result = await documents(runtime).read({ fileId: input.fileId })
    return { documentId: result.documentId, content: result.content }
  },
})
```

```ts
const answerAward = defineReaction(
  award.events.requested,
  {
    key: "award.answer",
    scope: award,
    engine: ai({ model: env.AWARD_AGENT_MODEL }),
    sandbox: false,
  },
  async reaction => {
    const answer = await reaction.given(reaction.trigger).agent({
      instruction: "Read the relevant attachment and answer from evidence.",
      actions: [award.actions.readAwardDocument],
      output: awardReplySchema,
    })
    return await reaction.given(answer).emit(
      award.events.completed(answer.payload),
    )
  },
)

await context.react(trigger, answerAward)
```

For deterministic formalization, call a registered domain action directly with
`reaction.given(event).action(...)`.

## Providers

```ts
documents(runtime, {
  provider: llamaCloud({ apiKey: process.env.LLAMA_CLOUD_API_KEY }),
})

documents(runtime, {
  provider: reducto({ apiKey: process.env.REDUCTO_API_KEY }),
})
```

A custom `DocumentParseProvider` uploads/starts a parse, reports job status, and
returns normalized pages.

## Data model

- `document_documents`: identity, source File, status, provider, page count
- `document_jobs`: append-only provider attempts and errors
- `document_pages`: ordered text, Markdown, and optional layout
- `document_sets`: durable many-to-many grouping of Documents
