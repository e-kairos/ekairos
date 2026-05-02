import Link from "next/link";

export default function ExamplesPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-3xl flex-col justify-center px-4 py-12 md:px-6">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Demo
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">
        The demo is useContext only.
      </h1>
      <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
        The previous reactor and agent showcases are intentionally out of the
        primary path. Use this route as a pointer to the single supported demo:
        the hook contract exposed by `@ekairos/events/react`.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link
          href="/docs/components/use-context"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Open useContext demo
        </Link>
        <a
          href="/r/use-context.json"
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          Manifest JSON
        </a>
      </div>
    </main>
  );
}
