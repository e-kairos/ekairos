import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buildRegistriesConfig, getDomainRegistryById } from "@/lib/domain-registries";

export const metadata = {
  title: "@ekairos-dataset | Ekairos Registry",
  description:
    "The dataset registry: UI for runtime-first materialization — sources, row previews, transforms, and downloadable artifacts.",
};

const PIPELINE = [
  {
    stage: "source",
    title: "Domain query, file, or text",
    body: "fromQuery snapshots live domain state; from / fromText pull files and raw input into the same build.",
  },
  {
    stage: "materialize",
    title: "Rows or a single object",
    body: "asRows for tabular work, first for one structured result. Sandbox-backed reactors handle the heavy parsing.",
  },
  {
    stage: "durable",
    title: "dataset_datasets + dataset_records",
    body: "Output is domain state: datasets carry analysis and artifacts, records carry the materialized rows.",
  },
] as const;

const SAMPLE_ROWS = [
  { id: "rec_01", kind: "tender", title: "Open tender snapshot", status: "materialized" },
  { id: "rec_02", kind: "tender", title: "Supplier bid rollup", status: "materialized" },
  { id: "rec_03", kind: "file", title: "price-list.xlsx → rows", status: "transforming" },
  { id: "rec_04", kind: "text", title: "Pasted spec → structure", status: "queued" },
] as const;

const PLANNED = [
  {
    name: "dataset-source-summary",
    label: "DatasetSourceSummary",
    body: "What fed the dataset: domain queries, files, and text sources with their analysis state.",
  },
  {
    name: "dataset-rows-preview",
    label: "DatasetRowsPreview",
    body: "Rows and object preview with schema-aware empty states — the table that understands materialization.",
  },
  {
    name: "dataset-transform-panel",
    label: "DatasetTransformPanel",
    body: "Transform runs linked to sandbox execution and events, observable end to end.",
  },
] as const;

export default function DatasetRegistryPage() {
  const registry = getDomainRegistryById("dataset");
  if (!registry) {
    return null;
  }

  return (
    <main className="min-h-[calc(100svh-56px)] bg-[#faf7f0] text-[#211d12]">
      <section className="border-b border-[#211d12]/15">
        <div className="mx-auto w-full max-w-[88rem] px-4 py-14 md:px-8 md:py-20">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#b45309]">
            <Link href="/registries" className="transition-colors hover:text-[#211d12]">
              registries
            </Link>{" "}
            / dataset
          </p>
          <div className="mt-6 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <h1 className="font-mono text-4xl font-semibold leading-tight md:text-6xl">
                {registry.namespace}
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-[#211d12]/70 md:text-lg">
                Domain data packaged for AI work. This registry will ship the UI that makes
                materialization observable — every component reads durable state from{" "}
                <span className="font-mono text-[#b45309]">{registry.schemaPackage}</span>.
              </p>
              <div className="mt-8 flex flex-wrap gap-4 font-mono text-xs">
                <a
                  href={registry.manifestPath}
                  className="border border-[#b45309]/40 bg-[#b45309]/10 px-3 py-2 transition-colors hover:bg-[#b45309]/20"
                >
                  {registry.manifestPath}
                </a>
                <span className="border border-[#211d12]/15 px-3 py-2 text-[#211d12]/60">
                  namespace reserved · first items in progress
                </span>
              </div>
            </div>

            <div className="min-w-0 border border-[#211d12]/20 bg-white">
              <div className="border-b border-[#211d12]/15 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#b45309]">
                dataset_records · open_tenders_v1
              </div>
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr className="border-b border-[#211d12]/15 text-left text-[#211d12]/55">
                    <th className="px-4 py-2 font-normal">id</th>
                    <th className="px-4 py-2 font-normal">kind</th>
                    <th className="px-4 py-2 font-normal">title</th>
                    <th className="px-4 py-2 font-normal">status</th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_ROWS.map((row) => (
                    <tr key={row.id} className="border-b border-[#211d12]/10 last:border-b-0">
                      <td className="px-4 py-2 text-[#b45309]">{row.id}</td>
                      <td className="px-4 py-2">{row.kind}</td>
                      <td className="px-4 py-2">{row.title}</td>
                      <td className="px-4 py-2 text-[#211d12]/55">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#211d12]/15">
        <div className="mx-auto grid w-full max-w-[88rem] gap-px border-x border-[#211d12]/15 bg-[#211d12]/15 md:grid-cols-3">
          {PIPELINE.map((entry, index) => (
            <div key={entry.stage} className="bg-[#faf7f0] p-6 md:p-8">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-[#b45309]">0{index + 1}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#211d12]/55">
                  {entry.stage}
                </span>
              </div>
              <h2 className="mt-4 text-xl font-semibold leading-tight">{entry.title}</h2>
              <p className="mt-3 text-sm leading-6 text-[#211d12]/65">{entry.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-[#211d12]/15">
        <div className="mx-auto grid w-full max-w-[88rem] gap-8 px-4 py-10 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:px-8">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#b45309]">
              setup
            </p>
            <h2 className="mt-4 max-w-md text-2xl font-semibold leading-tight">
              Configure the namespace before the first table ships.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#211d12]/65">
              The per-domain manifest is already live. Items will publish into{" "}
              <span className="font-mono">{registry.namespace}</span> as the dataset surfaces
              stabilize in the workbench.
            </p>
          </div>
          <pre className="min-w-0 overflow-x-auto border border-[#211d12]/15 bg-white p-4 font-mono text-xs leading-6">
            <code>{buildRegistriesConfig([registry])}</code>
          </pre>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[88rem] px-4 py-10 md:px-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#b45309]">
          planned items
        </p>
        <div className="mt-4 grid">
          {PLANNED.map((item) => (
            <div
              key={item.name}
              className="grid gap-3 border-t border-[#211d12]/15 py-6 first:border-t-0 md:grid-cols-[16rem_minmax(0,1fr)_minmax(0,18rem)]"
            >
              <p className="font-mono text-xs text-[#b45309]">{item.name}</p>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">{item.label}</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[#211d12]/65">{item.body}</p>
              </div>
              <p className="font-mono text-[11px] text-[#211d12]/50 md:text-right">
                {`shadcn add ${registry.namespace}/${item.name}`}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-6 border-t border-[#211d12]/15 pt-8">
          <p className="max-w-2xl text-xl font-semibold leading-tight md:text-2xl">
            Materialization is already a runtime. This registry makes it visible.
          </p>
          <Link
            href={registry.domain.href}
            className="inline-flex w-fit items-center gap-2 border border-[#211d12]/25 px-4 py-3 font-mono text-xs uppercase tracking-[0.2em] transition-colors hover:bg-[#211d12] hover:text-[#faf7f0]"
          >
            dataset domain
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
