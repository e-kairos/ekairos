/**
 * Internal platform delivery runtime. Built on Vercel's Chat SDK as an
 * implementation detail: nothing from it leaks into the public API, and all
 * persistence (messages + runtime state) lands on InstantDB through the
 * channel domain. Loaded lazily so apps that never call createChannels pay
 * nothing.
 *
 * Update engineering: the `chat` / `@chat-adapter/*` packages are consumed
 * through dynamic imports against the minimal surface below. Bumping them is
 * a routine dependency update; PLATFORM_RUNTIME_CONTRACT documents the
 * surface that must keep working.
 */
import { createChannelMessage, type ChannelKind } from "../index.js";
import { InstantChannelMessageStore } from "./message-store.js";
import { InstantStateAdapter } from "./state.js";
import type { ChannelInbound, ChannelsRuntime, CreateChannelsOptions } from "../platforms.js";

export const PLATFORM_RUNTIME_CONTRACT = {
  package: "chat",
  version: ">=4.30.0",
  adapters: ["slack", "teams", "gchat", "discord", "telegram"],
  surface: [
    "new Chat({ userName, adapters, state })",
    "chat.onNewMention(handler)",
    "chat.onSubscribedMessage(handler)",
    "chat.webhooks.<platform>(request, options?)",
    "thread.subscribe() / thread.post(text) / thread.id",
    "message.text / message.id / message.author",
    "StateAdapter (locks, kv, lists, queues, subscriptions)",
  ],
} as const;

type AnyRecord = Record<string, unknown>;

type ChatSdkThread = {
  id: string;
  adapter?: { name?: string };
  subscribe: () => Promise<unknown>;
  post: (text: string) => Promise<unknown>;
};

type ChatSdkMessage = {
  id?: string;
  text?: string;
  author?: { id?: string; userName?: string; isBot?: boolean };
};

async function loadAdapterFactory(platform: string): Promise<(config: AnyRecord) => unknown> {
  const moduleName = `@chat-adapter/${platform}`;
  let mod: AnyRecord;
  try {
    mod = (await import(/* @vite-ignore */ moduleName)) as AnyRecord;
  } catch (error) {
    throw new Error(
      `channel_platform_unavailable:${platform} — install ${moduleName} to enable it (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
  for (const value of Object.values(mod)) {
    if (typeof value === "function" && /^create.*Adapter$/.test(value.name)) {
      return value as (config: AnyRecord) => unknown;
    }
  }
  const fallback = mod.default ?? mod[`create${platform[0]?.toUpperCase()}${platform.slice(1)}Adapter`];
  if (typeof fallback === "function") {
    return fallback as (config: AnyRecord) => unknown;
  }
  throw new Error(`channel_platform_adapter_factory_not_found:${platform}`);
}

export async function startPlatformRuntime(options: CreateChannelsOptions): Promise<ChannelsRuntime> {
  let ChatCtor: new (config: AnyRecord) => any;
  try {
    const chatModule = (await import(/* @vite-ignore */ "chat")) as AnyRecord;
    ChatCtor = (chatModule.Chat ?? chatModule.default) as new (config: AnyRecord) => any;
  } catch (error) {
    throw new Error(
      `channel_platform_runtime_unavailable — install the "chat" package (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }

  const adapters: Record<string, unknown> = {};
  for (const [platform, config] of Object.entries(options.platforms)) {
    if (!config) continue;
    const factory = await loadAdapterFactory(platform);
    adapters[platform] = factory(config as AnyRecord);
  }

  const state = new InstantStateAdapter(options.db);
  const store = new InstantChannelMessageStore(options.db);

  const bot = new ChatCtor({
    userName: options.userName,
    adapters,
    state,
  });

  const platformOf = (thread: ChatSdkThread): ChannelKind => {
    const adapterName = thread.adapter?.name;
    if (adapterName) return adapterName as ChannelKind;
    const [prefix] = thread.id.split(":");
    return (prefix || "web") as ChannelKind;
  };

  const handleInbound = async (thread: ChatSdkThread, rawMessage?: ChatSdkMessage) => {
    if (rawMessage?.author?.isBot) return;
    const channel = platformOf(thread);
    const contextId = await options.resolveContextId({ channel, threadKey: thread.id });

    const inboundMessage = await store.saveChannelMessage(
      createChannelMessage({
        channel,
        direction: "inbound",
        role: "user",
        text: rawMessage?.text ?? "",
        externalId: rawMessage?.id,
        participant: rawMessage?.author?.userName ?? rawMessage?.author?.id,
        raw: rawMessage ? { text: rawMessage.text, author: rawMessage.author } : undefined,
        contextId,
      }),
    );

    const inbound: ChannelInbound = {
      channel,
      threadKey: thread.id,
      contextId,
      message: inboundMessage,
      reply: async (text: string) => {
        await thread.post(text);
        await store.saveChannelMessage(
          createChannelMessage({
            channel,
            direction: "outbound",
            role: "assistant",
            text,
            contextId,
          }),
        );
      },
    };

    const replyText = await options.react(inbound);
    if (replyText) {
      await inbound.reply(replyText);
    }
  };

  bot.onNewMention(async (thread: ChatSdkThread, message?: ChatSdkMessage) => {
    await thread.subscribe();
    await handleInbound(thread, message);
  });

  bot.onSubscribedMessage(async (thread: ChatSdkThread, message: ChatSdkMessage) => {
    await handleInbound(thread, message);
  });

  const webhooks: ChannelsRuntime["webhooks"] = {};
  for (const platform of Object.keys(adapters)) {
    const handler = bot.webhooks?.[platform];
    if (typeof handler === "function") {
      webhooks[platform] = (request: Request, webhookOptions?: AnyRecord) =>
        handler.call(bot.webhooks, request, webhookOptions);
    }
  }

  return {
    platforms: Object.keys(adapters),
    webhooks,
    store,
    dispose: async () => {
      await state.disconnect();
    },
  };
}
