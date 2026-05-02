import Link from "next/link";

export default function RegistryListPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-4xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        Registry index is intentionally minimal
      </h1>
      <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
        The public shadcn surface exposes only `use-context`. Legacy agent and
        component catalog routes are not part of the primary registry contract.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted/50"
        >
          Back to home
        </Link>
        <Link
          href="/docs/components/use-context"
          className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted/50"
        >
          Open useContext docs
        </Link>
        <a
          href="/r/use-context.json"
          className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted/50"
        >
          Manifest JSON
        </a>
      </div>
    </main>
  );
}
