import { DomainComponentsPage } from "@/components/domain/domain-pages";
import { eventsDomainEntry } from "@/lib/domain-registry";

export const revalidate = 3600;

export default function EventsComponentsPage() {
  return <DomainComponentsPage domain={eventsDomainEntry} />;
}
