import type { ChannelMessage, ChannelMessageStore } from "../index.js";

type AnyDb = {
  query: (q: Record<string, unknown>) => Promise<any>;
  transact: (chunks: unknown) => Promise<unknown>;
  tx: any;
};

/**
 * ChannelMessageStore over InstantDB: persists canonical channel_messages on
 * the channel domain and links them to the Context and Event, when
 * known). Internal module: apps get it wired by createChannels.
 */
export class InstantChannelMessageStore implements ChannelMessageStore {
  #db: AnyDb;

  constructor(db: AnyDb) {
    this.#db = db;
  }

  async saveChannelMessage(message: ChannelMessage): Promise<ChannelMessage> {
    const { id, contextId, eventId, ...fields } = message;
    let chunk = this.#db.tx.channel_messages[id].update({
      ...fields,
      createdAt: new Date(message.createdAt),
      updatedAt: message.updatedAt ? new Date(message.updatedAt) : new Date(),
    });
    if (contextId) {
      chunk = chunk.link({ context: contextId });
    }
    if (eventId) {
      chunk = chunk.link({ event: eventId });
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
        event: {},
      },
    });
    const rows = Array.isArray(result?.channel_messages) ? result.channel_messages : [];
    return rows.map((row: any) => ({
      ...row,
      contextId: params.contextId,
      eventId: Array.isArray(row.event) ? row.event?.[0]?.id : row.event?.id,
    }));
  }
}
