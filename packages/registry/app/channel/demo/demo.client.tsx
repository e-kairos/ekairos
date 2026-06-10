"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Pause, Play, RotateCcw } from "lucide-react";

import { ChannelBadge } from "@/components/ekairos/channel/channel-badge";
import { ChannelComposer } from "@/components/ekairos/channel/channel-composer";
import { ChannelTimeline } from "@/components/ekairos/channel/channel-timeline";
import { DemoProvisioningHud } from "@/components/ekairos/demo/provisioning-hud";
import { getChannelDemoDb } from "@/lib/demo/channel-client";
import { useDemoExperience } from "@/lib/demo/demo-experience";

type ScriptStep = {
  delayMs: number;
  channel: string;
  direction: "inbound" | "outbound";
  role: "user" | "assistant";
  participant?: string;
  status?: string;
  text: string;
};

/** Seeded history covers the whatsapp opening; Play streams the rest live. */
const SCRIPT: ScriptStep[] = [
  {
    delayMs: 900,
    channel: "email",
    direction: "outbound",
    role: "assistant",
    participant: "proveedores@acme-seguridad.com",
    status: "sent",
    text: "Subject: RFQ — 200 cascos certificados IRAM 3620\n\nEstimados: solicitamos cotización por 200 cascos de seguridad certificados, entrega en Córdoba antes del 15/07. Adjuntamos especificación técnica.",
  },
  {
    delayMs: 2600,
    channel: "email",
    direction: "inbound",
    role: "user",
    participant: "ventas@acme-seguridad.com",
    text: "Subject: RE: RFQ — 200 cascos\n\nBuenas tardes, cotizamos USD 11.40/unidad, entrega 10 días hábiles, pago 30 días. Validez 15 días.",
  },
  {
    delayMs: 1900,
    channel: "slack",
    direction: "outbound",
    role: "assistant",
    participant: "#compras",
    status: "delivered",
    text: "Oferta recibida de ACME Seguridad: USD 11.40/u × 200, entrega 10 días. Está 8% bajo el último precio de referencia. ¿Aprobamos y pedimos orden de compra?",
  },
  {
    delayMs: 2400,
    channel: "slack",
    direction: "inbound",
    role: "user",
    participant: "laura (compras)",
    text: "Aprobado 👍 generá la OC y avisale al proveedor.",
  },
  {
    delayMs: 1800,
    channel: "email",
    direction: "outbound",
    role: "assistant",
    participant: "ventas@acme-seguridad.com",
    status: "sent",
    text: "Subject: OC-2041 — 200 cascos certificados\n\nConfirmamos la compra según su cotización. Adjuntamos orden de compra OC-2041. Coordinamos entrega con depósito Córdoba.",
  },
  {
    delayMs: 1600,
    channel: "whatsapp",
    direction: "outbound",
    role: "assistant",
    status: "delivered",
    text: "Listo ✅ Pedido confirmado con ACME Seguridad: 200 cascos, USD 11.40/u, entrega en ~10 días hábiles. Te aviso cuando haya tracking.",
  },
];

const ALL_CHANNELS = ["whatsapp", "email", "slack", "web"] as const;

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ChannelDemo() {
  const demo = useDemoExperience({ domainId: "channel", seedId: "channel-demo" });
  const db = useMemo(
    () => (demo.session?.appId ? getChannelDemoDb(demo.session.appId) : null),
    [demo.session?.appId],
  );

  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [filters, setFilters] = useState<string[]>([]);
  const [resetting, setResetting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const writeMessage = useCallback(
    async (step: Omit<ScriptStep, "delayMs">) => {
      if (!db || !demo.contextId) return;
      const now = new Date().toISOString();
      await db.transact([
        db.tx.channel_messages[newId()]
          .update({
            channel: step.channel,
            direction: step.direction,
            role: step.role,
            text: step.text,
            participant: step.participant,
            status: step.status,
            createdAt: now,
            updatedAt: now,
          })
          .link({ context: demo.contextId }),
      ]);
    },
    [db, demo.contextId],
  );

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    if (!playing || !demo.ready) {
      clearTimer();
      return;
    }
    if (cursor >= SCRIPT.length) {
      setPlaying(false);
      return;
    }
    const step = SCRIPT[cursor];
    timerRef.current = setTimeout(() => {
      void writeMessage(step).then(() => {
        setCursor((current) => current + 1);
      });
    }, step.delayMs);
    return clearTimer;
  }, [playing, cursor, demo.ready, writeMessage]);

  const reset = useCallback(async () => {
    clearTimer();
    setPlaying(false);
    setResetting(true);
    try {
      await demo.reseed();
      setCursor(0);
    } finally {
      setResetting(false);
    }
  }, [demo]);

  const toggleFilter = (channel: string) => {
    setFilters((current) =>
      current.includes(channel)
        ? current.filter((kind) => kind !== channel)
        : [...current, channel],
    );
  };

  const handleSent = useCallback(
    ({ channel, text }: { channel: string; text: string }) => {
      void writeMessage({ channel, direction: "outbound", role: "user", text, status: "sent" });
      setTimeout(() => {
        void writeMessage({
          channel,
          direction: "inbound",
          role: "assistant",
          participant: "agent",
          text: "Anotado en el thread — en producción esto dispara la reaction del agente sobre el mismo context.",
        });
      }, 900);
    },
    [writeMessage],
  );

  const done = cursor >= SCRIPT.length;
  const visibleChannels = useMemo(() => (filters.length ? filters : undefined), [filters]);

  return (
    <div className="grid gap-4">
      <DemoProvisioningHud
        steps={demo.steps}
        appId={demo.session?.appId ?? null}
        error={demo.error}
        onRetry={demo.retry}
      />

      <div className="grid gap-0 border border-border">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-4 py-3">
          <button
            type="button"
            disabled={!demo.ready || resetting}
            onClick={() => (done ? void reset() : setPlaying(!playing))}
            className="inline-flex h-8 items-center gap-2 border border-foreground bg-foreground px-3 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {done ? (
              <>
                <RotateCcw className="h-3.5 w-3.5" /> Replay
              </>
            ) : playing ? (
              <>
                <Pause className="h-3.5 w-3.5" /> Pause
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" /> {cursor === 0 ? "Play conversation" : "Resume"}
              </>
            )}
          </button>
          <button
            type="button"
            disabled={!demo.ready || resetting}
            onClick={() => void reset()}
            className="inline-flex h-8 items-center border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            {resetting ? "Reseeding…" : "Reset"}
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {cursor}/{SCRIPT.length} live steps
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {ALL_CHANNELS.map((channel) => (
              <button
                key={channel}
                type="button"
                onClick={() => toggleFilter(channel)}
                className={
                  filters.length === 0 || filters.includes(channel)
                    ? "opacity-100"
                    : "opacity-35 hover:opacity-70"
                }
                aria-pressed={filters.includes(channel)}
              >
                <ChannelBadge channel={channel} />
              </button>
            ))}
          </div>
        </div>

        <div ref={scrollRef} className="h-[28rem] overflow-y-auto px-4 py-5">
          {demo.ready && db && demo.contextId ? (
            <ChannelTimeline
              db={db}
              contextId={demo.contextId}
              channels={visibleChannels}
              emptyState={
                <span>
                  Press <strong className="text-foreground">Play conversation</strong> — every
                  message is a real write to your temporary database.
                </span>
              }
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Provisioning your temporary database…
            </div>
          )}
        </div>

        <div className="border-t border-border bg-muted/20 px-4 py-3">
          <ChannelComposer
            endpoint="/api/examples/channel/send"
            contextId={demo.contextId ?? undefined}
            channels={["web", "whatsapp", "email"]}
            placeholder="Join the thread on any channel"
            onSent={handleSent}
          />
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            This is live: the timeline is the real{" "}
            <code className="text-foreground">ChannelTimeline</code> running a reactive InstantDB
            query against <strong className="text-foreground">your</strong> temporary database —
            every play step and every composer send is a canonical{" "}
            <code className="text-foreground">channel_messages</code> write.{" "}
            <Link href="/channel/docs/quickstart" className="underline underline-offset-4">
              Build it in four steps →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
