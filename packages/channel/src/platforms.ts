import type { ChannelKind, ChannelMessage, ChannelMessageStore } from "./index.js";

/**
 * Platform configuration: one entry per channel to enable. The shape of each
 * config is the platform's credentials/config (bot tokens, signing secrets);
 * it is passed through to the underlying delivery runtime.
 */
export type ChannelPlatformsConfig = Partial<
  Record<"slack" | "teams" | "gchat" | "discord" | "telegram", Record<string, unknown>>
> &
  Record<string, Record<string, unknown> | undefined>;

export type ChannelInbound = {
  channel: ChannelKind;
  /** Stable per-platform conversation key (use it to key agent threads). */
  threadKey: string;
  /** Agent context this conversation maps to. */
  contextId: string;
  /** The persisted canonical inbound message. */
  message: ChannelMessage;
  /** Posts a reply on the same platform thread and persists it. */
  reply: (text: string) => Promise<void>;
  /** Links the channel message to the trigger event item it produced. */
  attachEvent: (eventId: string) => Promise<void>;
};

export type ChannelsRuntimeHandle = {
  db(): Promise<any>;
};

export type CreateChannelsOptions = {
  /**
   * App runtime (EkairosRuntime / reactor runtime handle). All persistence —
   * channel messages, state, attachments — resolves through it, so channels
   * live on the same database and tenancy as the agents they feed.
   */
  runtime: ChannelsRuntimeHandle;
  /** Bot identity across platforms. */
  userName: string;
  platforms: ChannelPlatformsConfig;
  /** Maps a platform conversation to an agent context. */
  resolveContextId: (params: { channel: ChannelKind; threadKey: string }) => Promise<string>;
  /**
   * Reacts to an inbound message (typically: thread.react on the agent
   * domain). Return text to auto-reply, or use inbound.reply for streaming /
   * multi-part replies and return null.
   */
  react: (inbound: ChannelInbound) => Promise<string | null | undefined | void>;
};

export type ChannelsRuntime = {
  /** Platforms that were enabled. */
  platforms: string[];
  /** Webhook handlers to mount per platform (e.g. app/api/channels/[platform]). */
  webhooks: Record<string, (request: Request, options?: Record<string, unknown>) => Promise<Response>>;
  /** Canonical message store, for app-side writes (broadcasts, etc). */
  store: ChannelMessageStore;
  dispose: () => Promise<void>;
};

/**
 * Boots the multichannel runtime: every configured platform feeds the same
 * inbound pipeline (canonical channel_messages on InstantDB → agent reaction
 * → reply through the platform), and exposes one webhook handler per
 * platform. Delivery internals are an implementation detail of this package.
 */
export async function createChannels(options: CreateChannelsOptions): Promise<ChannelsRuntime> {
  const { startPlatformRuntime } = await import("./internal/platform-runtime.js");
  return await startPlatformRuntime(options);
}

export {
  createEmailChannel,
  createWhatsAppChannel,
  // email providers
  mailgunInbound,
  resend,
  resendInbound,
  // whatsapp providers
  kapsoInbound,
  twilio,
  twilioInbound,
  // signature primitives (for custom providers)
  verifyMailgunSignature,
  verifySvixSignature,
  verifyTwilioSignature,
  type ChannelFileRef,
  type ChannelRuntimeHandle,
  type ChannelRuntimeInput,
  type ChannelSendParams,
  type EmailChannelConfig,
  type EmailIdentity,
  type EmailIdentityInput,
  type EmailInboundMessage,
  type EmailInboundProvider,
  type EmailOutboundPayload,
  type EmailOutboundProvider,
  type InboundRouting,
  type NativeChannel,
  type NativeChannelContext,
  type WebhookPayload,
  type WhatsAppChannelConfig,
  type WhatsAppIdentity,
  type WhatsAppIdentityInput,
  type WhatsAppInboundMessage,
  type WhatsAppInboundProvider,
  type WhatsAppInteractiveParams,
  type WhatsAppNativeChannel,
  type WhatsAppOutboundProvider,
  type WhatsAppTemplateParams,
} from "./native.js";

export {
  bindReaction,
  type BindReactionOptions,
  type ChannelAgentRuntime,
  type ReactionEffectOf,
} from "./agent.js";
