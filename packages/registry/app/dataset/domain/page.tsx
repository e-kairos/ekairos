import { DomainLibraryPage } from "@/components/domain/domain-pages";
import { datasetDomainEntry } from "@/lib/domain-registry";

export const revalidate = 3600;

export default function DatasetDomainPage() {
  return <DomainLibraryPage domain={datasetDomainEntry} />;
}
