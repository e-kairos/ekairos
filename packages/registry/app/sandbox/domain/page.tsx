import { DomainLibraryPage } from "@/components/domain/domain-pages";
import { sandboxDomainEntry } from "@/lib/domain-registry";

export const revalidate = 3600;

export default function SandboxDomainPage() {
  return <DomainLibraryPage domain={sandboxDomainEntry} />;
}
