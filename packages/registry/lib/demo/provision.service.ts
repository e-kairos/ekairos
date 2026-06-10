import "server-only";

import { init as initAdmin } from "@instantdb/admin";
import { channelDomain } from "@ekairos/channel/schema";
import { eventsDomain } from "@ekairos/events/schema";

import { getPlatformApi } from "./tenant.service";

/**
 * General demo pattern for the registry site:
 *   1. entering the registry creates a temporary InstantDB app (tenant.service)
 *   2. entering a domain pushes that domain's schema into the app
 *   3. entering a page seeds that page's demo data
 *
 * Schema pushes are additive; the per-instance caches only avoid repeated
 * pushes — a push of an already-loaded domain is a fast no-op on Instant.
 */

const DOMAIN_SCHEMAS: Record<string, () => unknown> = {
  events: () => eventsDomain.toInstantSchema(),
  channel: () => channelDomain.toInstantSchema(),
};

const pushedDomainsByApp = new Map<string, Set<string>>();

export async function ensureDomainSchema(params: {
  appId: string;
  domainId: string;
}): Promise<{ appId: string; domainId: string; pushed: boolean }> {
  const appId = params.appId.trim();
  const domainId = params.domainId.trim().toLowerCase();
  if (!appId) throw new Error("appId is required.");

  const schemaFactory = DOMAIN_SCHEMAS[domainId];
  if (!schemaFactory) {
    // Domains without a registered demo schema are covered by the base app
    // schema created with the tenant.
    return { appId, domainId, pushed: false };
  }

  const pushed = pushedDomainsByApp.get(appId) ?? new Set<string>();
  if (pushed.has(domainId)) {
    return { appId, domainId, pushed: false };
  }

  const api = getPlatformApi();
  await api.schemaPush(appId, { schema: schemaFactory() as any });

  pushed.add(domainId);
  pushedDomainsByApp.set(appId, pushed);
  return { appId, domainId, pushed: true };
}

// ---------------------------------------------------------------------------
// Page-level demo seeds
// ---------------------------------------------------------------------------

export const CHANNEL_DEMO_CONTEXT_KEY = "demo.channel.procurement";

type SeedResult = {
  seedId: string;
  contextId: string;
  seeded: boolean;
};

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function channelAdminDb(appId: string, adminToken: string) {
  return initAdmin({
    appId,
    adminToken,
    schema: channelDomain.toInstantSchema() as any,
    useDateObjects: true,
  });
}

const CHANNEL_SEED_MESSAGES = [
  {
    channel: "whatsapp",
    direction: "inbound",
    role: "user",
    participant: "+54 9 11 5555-0147",
    text: "Hola! Necesito cotizar 200 cascos de seguridad certificados, entrega en Córdoba.",
  },
  {
    channel: "whatsapp",
    direction: "outbound",
    role: "assistant",
    status: "delivered",
    text: "Hola! Soy el agente de compras. Tomo el pedido: 200 cascos certificados (IRAM 3620), entrega Córdoba. ¿Tenés fecha límite de entrega?",
  },
  {
    channel: "whatsapp",
    direction: "inbound",
    role: "user",
    participant: "+54 9 11 5555-0147",
    text: "Antes del 15 del mes que viene.",
  },
] as const;

export async function seedChannelDemo(params: {
  appId: string;
  adminToken: string;
  reset?: boolean;
}): Promise<SeedResult> {
  const db = channelAdminDb(params.appId, params.adminToken);

  const existing = await db.query({
    event_contexts: { $: { where: { key: CHANNEL_DEMO_CONTEXT_KEY } } },
  });
  const existingContext = (existing as any)?.event_contexts?.[0] ?? null;
  const contextId: string = existingContext?.id ?? newId();

  if (params.reset && existingContext) {
    const messages = await db.query({
      channel_messages: { $: { where: { "context.id": contextId } } },
    });
    const rows: Array<{ id: string }> = (messages as any)?.channel_messages ?? [];
    if (rows.length > 0) {
      await db.transact(rows.map((row) => db.tx.channel_messages[row.id].delete()));
    }
  } else if (existingContext) {
    return { seedId: "channel-demo", contextId, seeded: false };
  }

  const now = Date.now();
  const transactions: any[] = [];
  if (!existingContext) {
    transactions.push(
      db.tx.event_contexts[contextId].update({
        key: CHANNEL_DEMO_CONTEXT_KEY,
        name: "Channel demo — procurement",
        status: "open_idle",
        createdAt: new Date(now - 60_000),
      }),
    );
  }
  CHANNEL_SEED_MESSAGES.forEach((message, index) => {
    transactions.push(
      db.tx.channel_messages[newId()]
        .update({
          channel: message.channel,
          direction: message.direction,
          role: message.role,
          text: message.text,
          participant: (message as { participant?: string }).participant,
          status: (message as { status?: string }).status,
          createdAt: new Date(now - 45_000 + index * 9_000),
          updatedAt: new Date(now - 45_000 + index * 9_000),
        })
        .link({ context: contextId }),
    );
  });

  await db.transact(transactions);
  return { seedId: "channel-demo", contextId, seeded: true };
}

export async function runDemoSeed(params: {
  seedId: string;
  appId: string;
  adminToken: string;
  reset?: boolean;
}): Promise<SeedResult> {
  switch (params.seedId) {
    case "channel-demo":
      return await seedChannelDemo(params);
    default:
      throw new Error(`unknown_demo_seed:${params.seedId}`);
  }
}
