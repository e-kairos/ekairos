import type { ChannelMessage, ChannelMessageStore } from "../index.js";

type AnyDb = {
  query: (q: Record<string, unknown>) => Promise<any>;
  transact: (chunks: unknown) => Promise<unknown>;
  tx: any;
};

/**
 * ChannelMessageStore over InstantDB: persists canonical channel_messages on
 * the channel domain and links them to the agent context (and item, when
 * known). Internal module: apps get it wired by createChannels.
 */
export class InstantChannelMessageStore implements ChannelMessageStore {
  #db: AnyDb;

  constructor(db: AnyDb) {
    this.#db = db;
  }

  async saveChannelMessage(message: ChannelMessage): Promise<ChannelMessage> {
    const { id, contextId, itemId, ...fields } = message;
    let chunk = this.#db.tx.channel_messages[id].update({
      ...fields,
      createdAt: new Date(message.createdAt),
      updatedAt: message.updatedAt ? new Date(message.updatedAt) : new Date(),
    });
    if (contextId) {
      chunk = chunk.link({ context: contextId });
    }
    if (itemId) {
      chunk = chunk.link({ item: itemId });
    }
    await this.#db.transact([chunk]);
    return message;
  }

  async getChannelMessages(params: { contextId: string }): Promise<ChannelMessage[]> {
    const result = await this.#db.query({
      channel_messages: {
        $: {
          where: { "context.id": params.contextId },
          order: { createdAt: "asc" },
        },
        item: {},
      },
    });
    const rows = Array.isArray(result?.channel_messages) ? result.channel_messages : [];
    return rows.map((row: any) => ({
      ...row,
      contextId: params.contextId,
      itemId: Array.isArray(row.item) ? row.item?.[0]?.id : row.item?.id,
    }));
  }
}
