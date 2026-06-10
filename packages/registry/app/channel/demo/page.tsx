import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ChannelDemo } from "./demo.client";

export const metadata = {
  title: "Channel — Live demo | Ekairos Registry",
  description:
    "A simulated agent thread spanning whatsapp, email, slack and web — rendered by the plug & play channel components.",
};

export default function ChannelDemoPage() {
  return (
    <main className="mx-auto min-h-[calc(100svh-56px)] w-full max-w-[72rem] px-4 py-10 md:px-8 md:py-14">
      <header className="grid gap-6 border-b border-border pb-8 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#0e7490]">
            <Link href="/channel" className="transition-colors hover:text-foreground">
              /channel
            </Link>{" "}
            / demo
          </p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight md:text-5xl">
            One thread. Four channels.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
            A procurement agent negotiates a purchase: the customer writes on whatsapp, suppliers
            answer by email, the team approves on slack — and everything is one timeline, because
            every message is one canonical <span className="font-mono text-foreground">channel_messages</span>{" "}
            record on the same agent context.
          </p>
        </div>
        <div className="grid content-start gap-2 border-t border-border pt-4 font-mono text-xs text-muted-foreground md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <span>ChannelTimeline</span>
          <span>ChannelComposer</span>
          <span>ChannelBadge</span>
          <Link
            href="/channel/docs"
            className="mt-2 inline-flex items-center gap-1.5 text-foreground underline underline-offset-4"
          >
            channel docs <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section className="py-8">
        <ChannelDemo />
      </section>

      <section className="grid gap-4 border-t border-border py-8 md:grid-cols-3">
        {[
          {
            title: "Plug & play",
            body: "These are the exact components served by this registry. In your app they bind to InstantDB with two props: db and contextId.",
          },
          {
            title: "Schema is the contract",
            body: "No demo-specific rendering: the timeline only knows the canonical message model. Any channel that maps into it just works.",
          },
          {
            title: "Your custom code",
            body: "A webhook mount and a send endpoint. The composer here posts to a real endpoint with the production contract.",
          },
        ].map((card) => (
          <div key={card.title} className="border border-border p-5">
            <h2 className="text-base font-semibold">{card.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{card.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
