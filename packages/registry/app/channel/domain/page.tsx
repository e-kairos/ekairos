import { DomainLibraryPage } from "@/components/domain/domain-pages";
import { channelDomainEntry } from "@/lib/domain-registry";

export const revalidate = 3600;

export default function ChannelDomainPage() {
  return <DomainLibraryPage domain={channelDomainEntry} />;
}
