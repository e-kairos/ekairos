import Link from "next/link"

import { eventsDomainEntry } from "@/lib/domain-registry"

const entities = [
  ["context_contexts", "Pure current and previous Context content."],
  ["context_sessions", "One typed Reaction invocation, including parent and Workflow identity."],
  ["context_events", "Domain facts and technical operation results."],
  ["context_reactions", "Ordered causes and effects for every operation."],
  ["context_eventParts", "Ordered message, reasoning, source, action, and engine content."],
] as const

export default function EventsDomainPage() {
  return (
    <article className="space-y-10 text-foreground">
      <header className="border-b border-border pb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Domain</p>
        <h1 className="mt-3 text-3xl font-semibold md:text-5xl">{eventsDomainEntry.title}</h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground">
          {eventsDomainEntry.summary} The durable model uses five entities with one responsibility each.
        </p>
      </header>

      <section>
        <h2 className="text-2xl font-semibold">Canonical graph</h2>
        <pre className="mt-4 overflow-x-auto border border-border bg-neutral-950 p-5 font-mono text-xs leading-6 text-neutral-100">
          <code>{`context_contexts
+- context_sessions
   |- trigger -> context_events
   |- rootReaction -> context_reactions
   +- reactions -> context_reactions
      |- causes  -> context_events[]
      +- effects -> context_events[]
                     +- eventParts -> context_eventParts[]`}</code>
        </pre>
      </section>

      <section>
        <h2 className="text-2xl font-semibold">Schema responsibilities</h2>
        <div className="mt-4 divide-y divide-border border-y border-border">
          {entities.map(([name, description]) => (
            <div key={name} className="grid gap-2 py-4 md:grid-cols-[12rem_1fr]">
              <code className="font-mono text-sm text-cyan-700 dark:text-cyan-400">{name}</code>
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold">Runtime boundary</h2>
        <pre className="mt-4 overflow-x-auto border border-border bg-neutral-950 p-5 font-mono text-xs leading-6 text-neutral-100">
          <code>{`const trigger = await Events(runtime).emit(eventDraft, { contextId })

const result = await context.react(
  trigger,
  defineReaction(triggerConstructor, options, async reaction => {
    const answer = await reaction.given(reaction.trigger).agent({ instruction })
    return await reaction.given(answer).emit(completed(answer.payload))
  }),
)`}</code>
        </pre>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">
          Events owns persistence. Reactor owns orchestration. UI subscribes to the same Sessions,
          Reactions, Events, and Parts without reconstructing a provider-specific execution model.
        </p>
      </section>

      <nav className="grid border-y border-border md:grid-cols-2">
        <Link href="/reactor/docs" className="p-4 text-sm hover:bg-muted/40">Reaction Engine documentation</Link>
        <Link href="/events/components" className="border-t border-border p-4 text-sm hover:bg-muted/40 md:border-l md:border-t-0">Events components</Link>
      </nav>
    </article>
  )
}
