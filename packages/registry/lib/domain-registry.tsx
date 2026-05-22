export type DomainRegistryComponentStatus = "published";

export type DomainRegistryComponentLink = {
  id: string;
  label: string;
  description: string;
  href: string;
  registryName: string;
  registryPath: string;
  target: string;
  dependency: string;
  packageImport: string;
  status: DomainRegistryComponentStatus;
  kind: "component";
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
  packageDependency: string;
  aggregateRoot: string;
  durableSurface: string;
  components: DomainRegistryComponentLink[];
  demos: DomainRegistryDemoLink[];
};

export const eventsDomainEntry: DomainRegistryEntry = {
  id: "events",
  title: "Events",
  summary:
    "Context-first domain where `event_contexts` anchor runtime state, `event_items` hold the durable turn history, and executions, steps, parts, and chunks explain how each item was produced.",
  href: "/events/components",
  schemaPackage: "@ekairos/events",
  packageDependency: "@ekairos/events@beta",
  aggregateRoot: "event_contexts",
  durableSurface: "event_items",
  components: [
    {
      id: "event-context-panel",
      label: "EventContextPanel",
      description:
        "Interactive panel for rendering an event context timeline and appending input through the canonical events React API.",
      href: "/events/components#event-context-panel",
      registryName: "event-context-panel",
      registryPath: "/r/event-context-panel.json",
      target: "components/ekairos/events/event-context-panel.tsx",
      dependency: "@ekairos/events@beta",
      packageImport: "@ekairos/events/react",
      status: "published",
      kind: "component",
    },
  ],
  demos: [],
};

export const domainRegistry = [eventsDomainEntry];

export function getDomainById(id: string) {
  return domainRegistry.find((domain) => domain.id === id) ?? null;
}
