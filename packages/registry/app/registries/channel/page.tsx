import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buildRegistriesConfig, getDomainRegistryById } from "@/lib/domain-registries";

export const metadata = {
  title: "@ekairos-channel | Ekairos Registry",
  description:
    "The channel registry: plug & play multichannel UI — timeline, bubbles, badges and composer over the channel_messages InstantDB schema.",
};

const WIRE = [
  { from: "whatsapp", note: "customer asks" },
  { from: "email", note: "supplier quotes" },
  { from: "slack", note: "team approves" },
  { from: "web", note: "product follows" },
] as const;

const ACCENTS: Record<string, string> = {
  whatsapp: "#25d366",
  email: "#f59e0b",
  slack: "#e01e5a",
  web: "#61e9ff",
};

export default function ChannelRegistryPage() {
  const registry = getDomainRegistryById("channel");
  if (!registry) {
    return null;
  }

  return (
    <main className="min-h-[calc(100svh-56px)] bg-[#06181d] text-[#d9eef2]">
      <section className="border-b border-[#0e7490]/30">
        <div className="mx-auto w-full max-w-[88rem] px-4 py-14 md:px-8 md:py-20">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#22d3ee]">
            <Link href="/registries" className="transition-colors hover:text-white">
              registries
            </Link>{" "}
            / channel
          </p>
          <div className="mt-6 grid gap-10 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="min-w-0">
              <h1 className="font-mono text-4xl font-semibold leading-tight text-white md:text-6xl">
                {registry.namespace}
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-[#9fc4cc] md:text-lg">
                Every channel, one thread. These components render the canonical{" "}
                <span className="font-mono text-[#22d3ee]">channel_messages</span> schema straight
                from InstantDB — install them and a multichannel inbox exists. The only custom code
                left is your send endpoint and a webhook mount.
              </p>
              <div className="mt-8 flex flex-wrap gap-4 font-mono text-xs">
                <a
                  href={registry.manifestPath}
                  className="border border-[#22d3ee]/40 bg-[#22d3ee]/10 px-3 py-2 text-white transition-colors hover:bg-[#22d3ee]/20"
                >
                  {registry.manifestPath}
                </a>
                <Link
                  href="/channel/docs"
                  className="border border-[#0e7490]/40 px-3 py-2 text-[#9fc4cc] transition-colors hover:text-white"
                >
                  channel docs
                </Link>
                <Link
                  href="/channel/demo"
                  className="border border-[#0e7490]/40 px-3 py-2 text-[#9fc4cc] transition-colors hover:text-white"
                >
                  live demo
                </Link>
              </div>
            </div>

            <div className="min-w-0 border border-[#0e7490]/35 bg-black/40">
              <div className="border-b border-[#0e7490]/30 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#22d3ee]">
                one context · every channel
              </div>
              <div className="grid px-4 py-3">
                {WIRE.map((line) => (
                  <div
                    key={line.from}
                    className="flex items-center gap-3 border-b border-[#0e7490]/20 py-3 font-mono text-xs last:border-b-0"
                  >
                    <span
                      className="inline-flex h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: ACCENTS[line.from] }}
                    />
                    <span className="w-20 text-white">{line.from}</span>
                    <span className="flex-1 border-t border-dashed border-[#0e7490]/40" />
                    <span className="text-[#9fc4cc]">{line.note}</span>
                    <span className="flex-1 border-t border-dashed border-[#0e7490]/40" />
                    <span className="text-[#22d3ee]">channel_messages</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#0e7490]/30">
        <div className="mx-auto grid w-full max-w-[88rem] gap-8 px-4 py-10 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:px-8">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#22d3ee]">setup</p>
            <h2 className="mt-4 max-w-md text-2xl font-semibold leading-tight text-white">
              Configure once. Install by name.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#9fc4cc]">
              The components depend on the schema, not on your backend — push{" "}
              <span className="font-mono text-[#d9eef2]">@ekairos/channel</span> entities to your
              InstantDB app and they are live.
            </p>
          </div>
          <div className="grid min-w-0 content-start gap-4">
            <pre className="overflow-x-auto border border-[#0e7490]/30 bg-black/40 p-4 font-mono text-xs leading-6 text-[#d9eef2]">
              <code>{buildRegistriesConfig([registry])}</code>
            </pre>
            <pre className="overflow-x-auto border border-[#0e7490]/30 bg-black/40 p-4 font-mono text-xs leading-6 text-[#d9eef2]">
              <code>{`pnpm dlx shadcn@latest add ${registry.namespace}/channel-timeline`}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[88rem] px-4 py-10 md:px-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#22d3ee]">items</p>
        <div className="mt-4 grid gap-px border border-[#0e7490]/30 bg-[#0e7490]/30 md:grid-cols-2">
          {registry.items.map((item) => (
            <div key={item.id} className="bg-[#06181d] p-6">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-xl font-semibold text-white">{item.label}</h3>
                <span className="border border-[#22d3ee]/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#22d3ee]">
                  {item.status}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#9fc4cc]">{item.description}</p>
              <p className="mt-4 font-mono text-[11px] text-[#9fc4cc]/70">{item.target}</p>
              <pre className="mt-3 overflow-x-auto border border-[#0e7490]/25 bg-black/40 p-3 font-mono text-[11px] leading-6 text-[#d9eef2]">
                <code>{`shadcn add ${registry.namespace}/${item.registryName}`}</code>
              </pre>
              <a
                href={`/r/${registry.id}/${item.registryName}.json`}
                className="mt-3 inline-block font-mono text-xs text-[#22d3ee] underline underline-offset-4"
              >
                /r/{registry.id}/{item.registryName}.json
              </a>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-6 border-t border-[#0e7490]/30 pt-8">
          <p className="max-w-2xl text-xl font-semibold leading-tight text-white md:text-2xl">
            The conversation is domain state. The UI is an install away.
          </p>
          <Link
            href="/channel"
            className="inline-flex w-fit items-center gap-2 border border-[#22d3ee]/50 px-4 py-3 font-mono text-xs uppercase tracking-[0.2em] text-white transition-colors hover:bg-[#22d3ee]/15"
          >
            channel domain
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
