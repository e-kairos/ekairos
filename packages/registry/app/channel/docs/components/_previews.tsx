"use client";

import { useState } from "react";
import type { ChannelMessage } from "@ekairos/channel";
import { ChannelBadge } from "@/components/ekairos/channel/channel-badge";
import { ChannelComposer } from "@/components/ekairos/channel/channel-composer";
import { ChannelMessageBubble } from "@/components/ekairos/channel/channel-message";
import { ChannelTimeline } from "@/components/ekairos/channel/channel-timeline";

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

export const SAMPLE_MESSAGES: ChannelMessage[] = [
  { id: "m1", channel: "whatsapp", direction: "inbound", role: "user", participant: "+54 9 11 5555-0147", text: "Hola! Necesito cotizar 200 cascos certificados.", createdAt: at(48) },
  { id: "m2", channel: "whatsapp", direction: "outbound", role: "assistant", status: "delivered", text: "Tomo el pedido: 200 cascos IRAM 3620. ¿Fecha límite?", createdAt: at(46) },
  { id: "m3", channel: "email", direction: "outbound", role: "assistant", participant: "ventas@acme.com", status: "sent", text: "Subject: RFQ — 200 cascos certificados\n\nSolicitamos cotización por 200 unidades.", createdAt: at(30) },
  { id: "m4", channel: "email", direction: "inbound", role: "user", participant: "ventas@acme.com", text: "Cotizamos USD 11.40/u, entrega 10 días hábiles.", createdAt: at(12) },
  { id: "m5", channel: "slack", direction: "inbound", role: "user", participant: "laura (compras)", text: "Aprobado 👍 generá la OC.", createdAt: at(3) },
];

export function BadgeRowPreview() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {["web", "email", "whatsapp", "slack", "teams", "discord", "telegram", "sms"].map((kind) => (
        <ChannelBadge key={kind} channel={kind} />
      ))}
    </div>
  );
}

export function BubbleBasicPreview() {
  return (
    <div className="grid gap-3">
      <ChannelMessageBubble message={SAMPLE_MESSAGES[0]} />
      <ChannelMessageBubble message={SAMPLE_MESSAGES[1]} />
    </div>
  );
}

export function BubbleChannelsPreview() {
  return (
    <div className="grid gap-3">
      <ChannelMessageBubble message={SAMPLE_MESSAGES[3]} />
      <ChannelMessageBubble message={SAMPLE_MESSAGES[4]} />
      <ChannelMessageBubble message={SAMPLE_MESSAGES[2]} hideChannel />
    </div>
  );
}

export function TimelineBasicPreview() {
  return <ChannelTimeline messages={SAMPLE_MESSAGES} />;
}

export function TimelineFilteredPreview() {
  const [channels, setChannels] = useState<string[]>(["email"]);
  return (
    <div className="grid gap-4">
      <div className="flex gap-1.5">
        {["whatsapp", "email", "slack"].map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() =>
              setChannels((cur) => (cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind]))
            }
            className={channels.includes(kind) ? "opacity-100" : "opacity-40 hover:opacity-70"}
          >
            <ChannelBadge channel={kind} />
          </button>
        ))}
      </div>
      <ChannelTimeline messages={SAMPLE_MESSAGES} channels={channels.length ? channels : undefined} />
    </div>
  );
}

export function ComposerBasicPreview() {
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      <ChannelComposer
        endpoint="/api/examples/channel/send"
        channels={["web"]}
        onSent={({ text }) => setSent(text)}
      />
      {sent ? <p className="font-mono text-xs text-muted-foreground">sent: “{sent}”</p> : null}
    </div>
  );
}

export function ComposerMultiPreview() {
  const [last, setLast] = useState<{ channel: string; text: string } | null>(null);
  return (
    <div className="grid gap-3">
      <ChannelComposer
        endpoint="/api/examples/channel/send"
        channels={["web", "whatsapp", "email"]}
        placeholder="Pick a channel, then write"
        onSent={setLast}
      />
      {last ? (
        <p className="font-mono text-xs text-muted-foreground">
          sent via {last.channel}: “{last.text}”
        </p>
      ) : null}
    </div>
  );
}
