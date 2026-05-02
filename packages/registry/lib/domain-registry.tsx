export type DomainRegistryComponentLink = {
  label: string;
  href: string;
  kind: "component" | "template";
};

export type DomainRegistryDemoLink = {
  label: string;
  href: string;
  description: string;
};

export type DomainRegistryEntry = {
  id: string;
  title: string;
  summary: string;
  href: string;
  schemaPackage: string;
  components: DomainRegistryComponentLink[];
  demos: DomainRegistryDemoLink[];
};

export const eventsDomainEntry: DomainRegistryEntry = {
  id: "events",
  title: "Events",
  summary:
    "Context-first domain where `event_contexts` anchor runtime state, `event_items` hold the durable turn history, and executions, steps, parts, and chunks explain how each item was produced.",
  href: "/docs/domains/events",
  schemaPackage: "@ekairos/events",
  components: [
    {
      label: "useContext",
      href: "/docs/components/use-context",
      kind: "component",
    },
  ],
  demos: [],
};

export const domainRegistry = [eventsDomainEntry];

export function getDomainById(id: string) {
  return domainRegistry.find((domain) => domain.id === id) ?? null;
}
