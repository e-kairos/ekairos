"use client";

import { useDemoExperience } from "@/lib/demo/demo-experience";
import { DemoProvisioningChip } from "@/components/ekairos/demo/provisioning-hud";

/**
 * Mounted by domain layouts: entering the domain ensures the temporary
 * database exists and pushes the domain schema, surfacing progress through
 * the shared floating chip.
 */
export function DomainDemoBoot({ domainId }: { domainId: string }) {
  const demo = useDemoExperience({ domainId });
  return <DemoProvisioningChip steps={demo.steps} appId={demo.session?.appId ?? null} />;
}
