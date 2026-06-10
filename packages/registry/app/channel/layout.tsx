import { DomainDemoBoot } from "@/components/ekairos/demo/domain-boot";

export default function ChannelSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <DomainDemoBoot domainId="channel" />
    </>
  );
}
