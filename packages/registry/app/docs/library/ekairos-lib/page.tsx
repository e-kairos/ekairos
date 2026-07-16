import Link from "next/link"

const example = `const answerMessage = defineReaction(
  support.events.messageReceived,
  {
    key: "support.answer",
    scope: support,
    engine: ai({ model: "openai/gpt-5.4" }),
    sandbox: false,
  },
  async reaction => {
    const answer = await reaction.given(reaction.trigger).agent({
      instruction: "Answer the request.",
      output: answerSchema,
    })
    return await reaction.given(answer).emit(
      support.events.responseCreated(answer.payload),
    )
  },
)

const trigger = await Events(runtime).emit(eventDraft, { contextId })
const effect = await context.react(trigger, answerMessage)`

export default function EkairosLibraryPage() {
  return (
    <article className="mx-auto max-w-4xl px-5 py-12">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Library</p>
      <h1 className="mt-3 text-4xl font-semibold">Domain facts to durable reactions.</h1>
      <p className="mt-5 max-w-3xl leading-7 text-muted-foreground">
        Domain defines Events and actions. Events persists Contexts and the causal graph. Reactor
        executes explicit Event-to-Event operations. Context provides the application handle.
      </p>
      <pre className="mt-8 overflow-x-auto border border-border bg-neutral-950 p-5 font-mono text-xs leading-6 text-neutral-100"><code>{example}</code></pre>
      <div className="mt-8 grid border-y border-border md:grid-cols-2">
        <Link href="/reactor/docs" className="p-4 hover:bg-muted/40">Reaction Engine</Link>
        <Link href="/docs/domains/events" className="border-t border-border p-4 hover:bg-muted/40 md:border-l md:border-t-0">Context domain</Link>
      </div>
    </article>
  )
}
