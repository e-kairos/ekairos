import { DomainLibraryPage } from "@/components/domain/domain-pages";
import { tasksDomainEntry } from "@/lib/domain-registry";

export const revalidate = 3600;

export default function TaskDomainPage() {
  return <DomainLibraryPage domain={tasksDomainEntry} />;
}
