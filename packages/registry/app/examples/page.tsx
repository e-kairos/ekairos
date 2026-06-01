import Link from "next/link";

export default function ExamplesPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-3xl flex-col justify-center px-4 py-12 md:px-6">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Domain examples
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">
        Examples now live under their domain.
      </h1>
      <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
        The registry is not a single showcase route. Browse the domain catalog,
        then open the component and manifest endpoints published by that domain.
        Events is the first published domain in this registry.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Open domains
        </Link>
        <Link
          href="/events/components"
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          Open events
        </Link>
      </div>
    </main>
  );
}
