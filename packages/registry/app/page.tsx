import Link from "next/link";

import { getRegistry } from "@/app/[component]/route";

export const revalidate = 3600;

const installCommand =
  "pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/use-context.json";

export default async function HomePage() {
  const registry = await getRegistry();
  const useContextItem = registry.items.find((item) => item.name === "use-context");
  const dependency = useContextItem?.dependencies?.[0] ?? "@ekairos/events@beta";

  return (
    <main className="mx-auto flex min-h-[calc(100svh-44px)] w-full max-w-5xl flex-col justify-center px-4 py-10 md:px-6">
      <section className="grid gap-10 border-b border-border pb-10 md:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] md:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Ekairos Registry
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
            useContext is the registry.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            One public shadcn entrypoint for the canonical React runtime in
            {" "}
            <span className="font-mono text-foreground">@ekairos/events/react</span>.
            No legacy agent surface, no component shelf.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/docs/components/use-context"
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Open useContext docs
            </Link>
            <a
              href="/r/use-context.json"
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              Manifest JSON
            </a>
          </div>
        </div>

        <div className="border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Install
          </p>
          <pre className="mt-4 overflow-x-auto bg-background p-4 text-xs leading-6 text-foreground">
            <code>{installCommand}</code>
          </pre>
          <div className="mt-4 grid gap-2 border-t border-border pt-4 font-mono text-xs text-muted-foreground">
            <div>public_items: {registry.items.length}</div>
            <div>component: use-context</div>
            <div>dependency: {dependency}</div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 py-10 md:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Source
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            The registry file is a thin bridge to the package export, so product apps
            consume the current `@ekairos/events` runtime directly.
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Demo
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            The demo shows only context identity, status, and event count. It exists
            to verify the hook contract, not to showcase an old agent UI.
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Contract
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Public install surface stays intentionally small: one manifest, one hook,
            one package dependency.
          </p>
        </div>
      </section>
    </main>
  );
}
