import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { EkairosRuntime } from "@ekairos/domain"

import { tasksDomain } from "../domain.ts"

type Tx =
  {
    entity: "task_tasks"
    id: string
    op: "update"
    payload: Record<string, unknown>
  }

function taskTx(id: string) {
  return {
    update(payload: Record<string, unknown>): Tx {
      return { entity: "task_tasks", id, op: "update", payload }
    },
  }
}

export function createMemoryTaskDb() {
  const tasks = new Map<string, Record<string, any>>()

  return {
    tasks,
    tx: {
      task_tasks: new Proxy(
        {},
        {
          get(_target, id: string) {
            return taskTx(id)
          },
        },
      ),
    },
    async query(query: any) {
      const taskQuery = query?.task_tasks
      const where = taskQuery?.$?.where ?? {}
      let rows = Array.from(tasks.values())

      if (where.id) {
        rows = rows.filter((row) => row.id === where.id)
      }
      if (where.key) {
        rows = rows.filter((row) => row.key === where.key)
      }

      const limit = typeof taskQuery?.$?.limit === "number"
        ? taskQuery.$.limit
        : rows.length

      return {
        task_tasks: rows.slice(0, limit),
      }
    },
    async transact(txs: Tx[]) {
      for (const tx of txs.flat()) {
        const existing = tasks.get(tx.id) ?? { id: tx.id }
        tasks.set(tx.id, {
          ...existing,
          ...tx.payload,
        })
      }
    },
  }
}

export class MemoryTaskRuntime extends EkairosRuntime<
  Record<string, unknown>,
  any,
  ReturnType<typeof createMemoryTaskDb>
> {
  constructor(public readonly memoryDb = createMemoryTaskDb()) {
    super({})
  }

  protected getDomain() {
    return tasksDomain
  }

  protected resolveDb() {
    return this.memoryDb
  }

  public override async use(subdomain: unknown, options?: unknown): Promise<any> {
    return await super.use(subdomain as never, options as never)
  }

  static [WORKFLOW_SERIALIZE](instance: MemoryTaskRuntime) {
    return {
      env: instance.env,
      tasks: Array.from(instance.memoryDb.tasks.entries()),
    }
  }

  static [WORKFLOW_DESERIALIZE](data: {
    env?: Record<string, unknown>
    tasks?: Array<[string, Record<string, any>]>
  }) {
    const db = createMemoryTaskDb()
    for (const [id, task] of data.tasks ?? []) {
      db.tasks.set(id, task)
    }
    return new MemoryTaskRuntime(db)
  }
}

export function createMemoryTaskRuntime(db = createMemoryTaskDb()) {
  return new MemoryTaskRuntime(db)
}
