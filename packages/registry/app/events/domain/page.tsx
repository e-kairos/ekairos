import { DomainLibraryPage } from "@/components/domain/domain-pages";
import { eventsDomainEntry } from "@/lib/domain-registry";

export const revalidate = 3600;

export default function EventsDomainPage() {
  return <DomainLibraryPage domain={eventsDomainEntry} />;
}
