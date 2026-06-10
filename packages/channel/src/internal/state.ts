/**
 * InstantDB-backed implementation of the platform runtime's StateAdapter
 * (locks, KV with TTL, lists, queues, subscriptions), persisted on the
 * channel domain entities. Internal module: not part of the public exports.
 *
 * Atomicity notes: locks and set-if-not-exists lean on the unique index of
 * `channel_locks.threadId` / `channel_state.key`; expiry is enforced on read.
 */

type AnyDb = {
  query: (q: Record<string, unknown>) => Promise<any>;
  transact: (chunks: unknown) => Promise<unknown>;
  tx: any;
};

type Lock = { expiresAt: number; threadId: string; token: string };
type QueueEntry = Record<string, unknown>;

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function now(): number {
  return Date.now();
}

export class InstantStateAdapter {
  #db: AnyDb;
  #queueSeq = 0;

  constructor(db: AnyDb) {
    this.#db = db;
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  // --- KV ------------------------------------------------------------------

  async #getStateRow(key: string): Promise<any | null> {
    const result = await this.#db.query({
      channel_state: { $: { where: { key } } },
    });
    const row = result?.channel_state?.[0] ?? null;
    if (!row) return null;
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= now()) {
      await this.#db.transact([this.#db.tx.channel_state[row.id].delete()]);
      return null;
    }
    return row;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const row = await this.#getStateRow(key);
    return row ? ((row.value as T) ?? null) : null;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    const existing = await this.#getStateRow(key);
    const id = existing?.id ?? newId();
    await this.#db.transact([
      this.#db.tx.channel_state[id].update({
        key,
        value,
        expiresAt: ttlMs ? new Date(now() + ttlMs) : null,
        updatedAt: new Date(),
      }),
    ]);
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    const existing = await this.#getStateRow(key);
    if (existing) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  async delete(key: string): Promise<void> {
    const result = await this.#db.query({ channel_state: { $: { where: { key } } } });
    const row = result?.channel_state?.[0];
    if (row) {
      await this.#db.transact([this.#db.tx.channel_state[row.id].delete()]);
    }
  }

  // --- Lists ---------------------------------------------------------------

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number },
  ): Promise<void> {
    const row = await this.#getStateRow(key);
    const current: unknown[] = Array.isArray(row?.value) ? row.value : [];
    let next = [...current, value];
    if (options?.maxLength && next.length > options.maxLength) {
      next = next.slice(next.length - options.maxLength);
    }
    const id = row?.id ?? newId();
    await this.#db.transact([
      this.#db.tx.channel_state[id].update({
        key,
        value: next,
        expiresAt: options?.ttlMs ? new Date(now() + options.ttlMs) : (row?.expiresAt ?? null),
        updatedAt: new Date(),
      }),
    ]);
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    const row = await this.#getStateRow(key);
    return Array.isArray(row?.value) ? (row.value as T[]) : [];
  }

  // --- Locks ---------------------------------------------------------------

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const result = await this.#db.query({ channel_locks: { $: { where: { threadId } } } });
    const existing = result?.channel_locks?.[0];
    const expiresAt = now() + ttlMs;
    const token = newId();

    if (existing) {
      const existingExpiry = new Date(existing.expiresAt).getTime();
      if (existingExpiry > now()) {
        return null;
      }
      await this.#db.transact([
        this.#db.tx.channel_locks[existing.id].update({
          token,
          expiresAt: new Date(expiresAt),
        }),
      ]);
      return { threadId, token, expiresAt };
    }

    try {
      await this.#db.transact([
        this.#db.tx.channel_locks[newId()].update({
          threadId,
          token,
          expiresAt: new Date(expiresAt),
        }),
      ]);
      return { threadId, token, expiresAt };
    } catch {
      // unique(threadId) raced with another acquirer
      return null;
    }
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const result = await this.#db.query({
      channel_locks: { $: { where: { threadId: lock.threadId } } },
    });
    const existing = result?.channel_locks?.[0];
    if (!existing || existing.token !== lock.token) return false;
    await this.#db.transact([
      this.#db.tx.channel_locks[existing.id].update({ expiresAt: new Date(now() + ttlMs) }),
    ]);
    return true;
  }

  async releaseLock(lock: Lock): Promise<void> {
    const result = await this.#db.query({
      channel_locks: { $: { where: { threadId: lock.threadId } } },
    });
    const existing = result?.channel_locks?.[0];
    if (existing && existing.token === lock.token) {
      await this.#db.transact([this.#db.tx.channel_locks[existing.id].delete()]);
    }
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    const result = await this.#db.query({ channel_locks: { $: { where: { threadId } } } });
    const existing = result?.channel_locks?.[0];
    if (existing) {
      await this.#db.transact([this.#db.tx.channel_locks[existing.id].delete()]);
    }
  }

  // --- Subscriptions -------------------------------------------------------

  async subscribe(threadId: string): Promise<void> {
    const result = await this.#db.query({
      channel_subscriptions: { $: { where: { threadId } } },
    });
    if (result?.channel_subscriptions?.[0]) return;
    await this.#db.transact([
      this.#db.tx.channel_subscriptions[newId()].update({
        threadId,
        createdAt: new Date(),
      }),
    ]);
  }

  async unsubscribe(threadId: string): Promise<void> {
    const result = await this.#db.query({
      channel_subscriptions: { $: { where: { threadId } } },
    });
    const existing = result?.channel_subscriptions?.[0];
    if (existing) {
      await this.#db.transact([this.#db.tx.channel_subscriptions[existing.id].delete()]);
    }
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    const result = await this.#db.query({
      channel_subscriptions: { $: { where: { threadId } } },
    });
    return Boolean(result?.channel_subscriptions?.[0]);
  }

  // --- Queues --------------------------------------------------------------

  async enqueue(threadId: string, entry: QueueEntry, maxSize: number): Promise<number> {
    const depth = await this.queueDepth(threadId);
    if (depth >= maxSize) {
      return depth;
    }
    this.#queueSeq = Math.max(this.#queueSeq + 1, now() * 1000);
    await this.#db.transact([
      this.#db.tx.channel_queues[newId()].update({
        threadId,
        seq: this.#queueSeq,
        entry,
        createdAt: new Date(),
      }),
    ]);
    return depth + 1;
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    const result = await this.#db.query({
      channel_queues: {
        $: { where: { threadId }, order: { seq: "asc" }, limit: 1 },
      },
    });
    const head = result?.channel_queues?.[0];
    if (!head) return null;
    await this.#db.transact([this.#db.tx.channel_queues[head.id].delete()]);
    return (head.entry as QueueEntry) ?? null;
  }

  async queueDepth(threadId: string): Promise<number> {
    const result = await this.#db.query({ channel_queues: { $: { where: { threadId } } } });
    return Array.isArray(result?.channel_queues) ? result.channel_queues.length : 0;
  }
}
