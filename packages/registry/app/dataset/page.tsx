import { DomainLandingPage } from "@/components/domain/domain-pages";
import { datasetDomainEntry } from "@/lib/domain-registry";

export const revalidate = 3600;

export default function DatasetPage() {
  return <DomainLandingPage domain={datasetDomainEntry} />;
}
