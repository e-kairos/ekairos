import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buildRegistriesConfig, getDomainRegistryById } from "@/lib/domain-registries";

export const metadata = {
  title: "@ekairos-sandbox | Ekairos Registry",
  description:
    "The sandbox registry: UI for durable execution environments — lifecycle, process streams, files, checkpoints, and preview ports.",
};

const SESSION = [
  { prompt: "createSandbox", output: "provider=vercel runtime=node22 → sandbox_sb_01" },
  { prompt: "runCommandProcess pnpm test", output: "process_p_07 · streaming stdout" },
  { prompt: "writeFiles ./src", output: "12 files moved through the boundary" },
  { prompt: "createCheckpoint", output: "state captured · reconnect by durable id" },
  { prompt: "getPortUrl 3000", output: "https://sb-01-3000.preview → live" },
] as const;

const PLANNED = [
  {
    name: "sandbox-status-strip",
    label: "SandboxStatusStrip",
    body: "Provider and runtime identity, lifecycle state, and durable id at a glance.",
  },
  {
    name: "process-stream-panel",
    label: "ProcessStreamPanel",
    body: "stdout, stderr, and exit state for a sandbox_processes run — the terminal as a component.",
  },
  {
    name: "port-preview-launcher",
    label: "PortPreviewLauncher",
    body: "Expose a running port and open the generated app without leaving the surface.",
  },
] as const;

export default function SandboxRegistryPage() {
  const registry = getDomainRegistryById("sandbox");
  if (!registry) {
    return null;
  }

  return (
    <main className="min-h-[calc(100svh-56px)] bg-[#0a0f0a] text-[#d7e4d7]">
      <section className="border-b border-[#3fae5a]/25">
        <div className="mx-auto w-full max-w-[88rem] px-4 py-14 md:px-8 md:py-20">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#5ddb7e]">
            <Link href="/registries" className="transition-colors hover:text-white">
              registries
            </Link>{" "}
            / sandbox
          </p>
          <div className="mt-6 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <h1 className="font-mono text-4xl font-semibold leading-tight text-white md:text-6xl">
                {registry.namespace}
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-[#9fbf9f] md:text-lg">
                Durable sandboxes without provider lock-in. This registry will ship the
                operational UI for{" "}
                <span className="font-mono text-[#5ddb7e]">{registry.schemaPackage}</span>:
                environment lifecycle, command streams, files, checkpoints, and preview ports.
              </p>
              <div className="mt-8 flex flex-wrap gap-4 font-mono text-xs">
                <a
                  href={registry.manifestPath}
                  className="border border-[#3fae5a]/40 bg-[#3fae5a]/10 px-3 py-2 text-white transition-colors hover:bg-[#3fae5a]/20"
                >
                  {registry.manifestPath}
                </a>
                <span className="border border-[#3fae5a]/25 px-3 py-2 text-[#9fbf9f]">
                  namespace reserved · first items in progress
                </span>
              </div>
            </div>

            <div className="min-w-0 border border-[#3fae5a]/30 bg-black/60 shadow-[0_0_60px_rgba(63,174,90,0.08)]">
              <div className="flex items-center gap-2 border-b border-[#3fae5a]/25 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#5ddb7e]">
                sandbox_sandboxes · session
              </div>
              <div className="grid gap-3 px-4 py-4 font-mono text-xs leading-6">
                {SESSION.map((line) => (
                  <div key={line.prompt}>
                    <p className="text-white">
                      <span className="text-[#5ddb7e]">$</span> {line.prompt}
                    </p>
                    <p className="text-[#9fbf9f]">{line.output}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#3fae5a]/25">
        <div className="mx-auto grid w-full max-w-[88rem] gap-8 px-4 py-10 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:px-8">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#5ddb7e]">
              setup
            </p>
            <h2 className="mt-4 max-w-md text-2xl font-semibold leading-tight text-white">
              Wire the namespace now. Items land here, not in a new URL.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#9fbf9f]">
              The manifest is already served per domain. When the first component publishes,
              consumers that configured{" "}
              <span className="font-mono text-[#d7e4d7]">{registry.namespace}</span> only run
              the add command.
            </p>
          </div>
          <pre className="min-w-0 overflow-x-auto border border-[#3fae5a]/25 bg-black/60 p-4 font-mono text-xs leading-6 text-[#d7e4d7]">
            <code>{buildRegistriesConfig([registry])}</code>
          </pre>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[88rem] px-4 py-10 md:px-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#5ddb7e]">
          planned items
        </p>
        <div className="mt-4 grid gap-px border border-[#3fae5a]/25 bg-[#3fae5a]/25 md:grid-cols-3">
          {PLANNED.map((item) => (
            <div key={item.name} className="bg-[#0a0f0a] p-6">
              <p className="font-mono text-xs text-[#5ddb7e]">{item.name}</p>
              <h3 className="mt-3 text-xl font-semibold text-white">{item.label}</h3>
              <p className="mt-3 text-sm leading-6 text-[#9fbf9f]">{item.body}</p>
              <p className="mt-5 font-mono text-[11px] text-[#9fbf9f]/70">
                {`shadcn add ${registry.namespace}/${item.name}`}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-6 border-t border-[#3fae5a]/25 pt-8">
          <p className="max-w-2xl text-xl font-semibold leading-tight text-white md:text-2xl">
            The runtime is live today. The registry is where its operational UI will land.
          </p>
          <Link
            href={registry.domain.href}
            className="inline-flex w-fit items-center gap-2 border border-[#3fae5a]/40 px-4 py-3 font-mono text-xs uppercase tracking-[0.2em] text-white transition-colors hover:bg-[#3fae5a]/15"
          >
            sandbox domain
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
