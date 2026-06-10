export { channelDomain } from "./schema.js";
// NOTE: createChannels (platform delivery) is intentionally NOT re-exported
// here. It lives in the server-only "@ekairos/channel/platforms" subpath so
// the root stays safe to import from client bundles.
export type {
  ChannelInbound,
  ChannelPlatformsConfig,
  ChannelsRuntime,
  CreateChannelsOptions,
} from "./platforms.js";

export const WEB_CHANNEL = "web";
export const EMAIL_CHANNEL = "email";
export const WHATSAPP_CHANNEL = "whatsapp";

/** Open union: known channels get literal types, custom channels are allowed. */
export type ChannelKind = "web" | "email" | "whatsapp" | (string & {});

export type ChannelDirection = "inbound" | "outbound";

export type ChannelMessageStatus =
  | "pending"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | (string & {});

/**
 * Canonical message crossing any channel. Mirrors the `channel_messages`
 * entity; provider payloads live in `raw` and provider ids in `externalId`.
 */
export type ChannelMessage = {
  id: string;
  channel: ChannelKind;
  direction: ChannelDirection;
  role?: "user" | "assistant" | "system";
  text?: string;
  parts?: unknown[];
  status?: ChannelMessageStatus;
  externalId?: string;
  /** Resolved identity of the counterpart (phone, email address, user id). */
  participant?: string;
  raw?: unknown;
  createdAt: string;
  updatedAt?: string;
  /** Links into the agent context, when attached. */
  contextId?: string;
  itemId?: string;
};

export type ChannelOutboundMessage = Omit<ChannelMessage, "id" | "createdAt" | "direction"> & {
  direction?: "outbound";
};

export type ChannelSendResult = {
  externalId?: string;
  status: ChannelMessageStatus;
  raw?: unknown;
};

/**
 * Provider plugin contract. Implementations (Resend email, Twilio whatsapp,
 * push, ...) live in apps or provider packages and register by kind.
 */
export interface ChannelAdapter {
  readonly kind: ChannelKind;
  send(message: ChannelOutboundMessage): Promise<ChannelSendResult>;
}

/**
 * Persistence contract for channel messages. InstantDB deployments back this
 * with `channel_messages`; local runtimes can keep it in memory.
 */
export interface ChannelMessageStore {
  saveChannelMessage(message: ChannelMessage): Promise<ChannelMessage>;
  getChannelMessages(params: { contextId: string }): Promise<ChannelMessage[]>;
}

function generateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createChannelMessage(
  input: Omit<ChannelMessage, "id" | "createdAt"> & { id?: string; createdAt?: string },
): ChannelMessage {
  return {
    ...input,
    id: input.id ?? generateId(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export class ChannelRegistry {
  #adapters = new Map<string, ChannelAdapter>();

  register(adapter: ChannelAdapter): this {
    this.#adapters.set(adapter.kind, adapter);
    return this;
  }

  get(kind: ChannelKind): ChannelAdapter | null {
    return this.#adapters.get(kind) ?? null;
  }

  kinds(): ChannelKind[] {
    return [...this.#adapters.keys()];
  }

  async send(message: ChannelOutboundMessage): Promise<ChannelSendResult> {
    const adapter = this.get(message.channel);
    if (!adapter) {
      throw new Error(`channel_adapter_not_registered:${message.channel}`);
    }
    return await adapter.send(message);
  }
}
