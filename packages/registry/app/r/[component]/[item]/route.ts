import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { GET as getFlatRegistryItem, getRegistry } from "@/app/[component]/route";
import { getDomainRegistryById, getDomainRegistryItem } from "@/lib/domain-registries";

type RequestProps = {
  // The first segment is the domain registry id; Next.js requires it to share
  // the slug name with the sibling /r/[component] route.
  params: Promise<{ component: string; item: string }>;
};

export const GET = async (request: NextRequest, { params }: RequestProps) => {
  const { component: domainParam, item: itemParam } = await params;
  const domainId = domainParam.trim().toLowerCase();
  const itemName = itemParam.replace(".json", "").trim().toLowerCase();

  const registry = getDomainRegistryById(domainId);
  if (!registry) {
    return NextResponse.json(
      { error: `Domain registry "${domainId}" not found.` },
      { status: 404 },
    );
  }

  if (itemName === "registry") {
    const fullRegistry = await getRegistry();
    const domainNames = new Set(registry.items.map((item) => item.registryName));
    return NextResponse.json({
      ...fullRegistry,
      name: `ekairos-${registry.id}`,
      items: fullRegistry.items.filter((item) => domainNames.has(item.name)),
    });
  }

  const item = getDomainRegistryItem(registry, itemName);
  if (!item) {
    return NextResponse.json(
      { error: `Item "${itemName}" is not part of the "${domainId}" registry.` },
      { status: 404 },
    );
  }

  return getFlatRegistryItem(request, {
    params: Promise.resolve({ component: item.registryName }),
  });
};
