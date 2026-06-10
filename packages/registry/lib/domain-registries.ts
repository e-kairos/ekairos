import {
  domainRegistry,
  type DomainRegistryComponentLink,
  type DomainRegistryEntry,
} from "@/lib/domain-registry";

export const REGISTRY_BASE_URL = "https://registry.ekairos.dev";

export type DomainRegistryItemGroup = {
  name: string;
  items: DomainRegistryComponentLink[];
};

export type DomainRegistryNamespace = {
  id: string;
  title: string;
  summary: string;
  namespace: string;
  manifestPath: string;
  manifestUrl: string;
  itemUrlTemplate: string;
  packageDependency: string;
  schemaPackage: string;
  domain: DomainRegistryEntry;
  items: DomainRegistryComponentLink[];
  groups: DomainRegistryItemGroup[];
  publishedCount: number;
  sourceCount: number;
};

function groupItems(items: DomainRegistryComponentLink[]): DomainRegistryItemGroup[] {
  const groups = new Map<string, DomainRegistryComponentLink[]>();
  for (const item of items) {
    const bucket = groups.get(item.group);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(item.group, [item]);
    }
  }
  return Array.from(groups, ([name, groupedItems]) => ({ name, items: groupedItems }));
}

function toNamespaceEntry(domain: DomainRegistryEntry): DomainRegistryNamespace {
  const manifestPath = `/r/${domain.id}/registry.json`;
  return {
    id: domain.id,
    title: domain.title,
    summary: domain.summary,
    namespace: `@ekairos-${domain.id}`,
    manifestPath,
    manifestUrl: `${REGISTRY_BASE_URL}${manifestPath}`,
    itemUrlTemplate: `${REGISTRY_BASE_URL}/r/${domain.id}/{name}.json`,
    packageDependency: domain.packageDependency,
    schemaPackage: domain.schemaPackage,
    domain,
    items: domain.components,
    groups: groupItems(domain.components),
    publishedCount: domain.components.filter((item) => item.status === "published").length,
    sourceCount: domain.components.filter((item) => item.status === "source").length,
  };
}

export const domainRegistries: DomainRegistryNamespace[] =
  domainRegistry.map(toNamespaceEntry);

export function getDomainRegistryById(id: string): DomainRegistryNamespace | null {
  return domainRegistries.find((registry) => registry.id === id) ?? null;
}

export function getDomainRegistryItem(
  registry: DomainRegistryNamespace,
  itemName: string,
): DomainRegistryComponentLink | null {
  return (
    registry.items.find(
      (item) => item.registryName === itemName || item.id === itemName,
    ) ?? null
  );
}

export function buildRegistriesConfig(
  registries: DomainRegistryNamespace[] = domainRegistries,
): string {
  const entries = registries
    .map(
      (registry) =>
        `    "${registry.namespace}": "${registry.itemUrlTemplate}"`,
    )
    .join(",\n");
  return `{\n  "registries": {\n${entries}\n  }\n}`;
}
