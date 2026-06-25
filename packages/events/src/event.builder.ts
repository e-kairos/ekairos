import {
  INPUT_ITEM_TYPE,
  WEB_CHANNEL,
} from "./context.events.js"
import type {
  Channel,
  ItemType,
} from "./context.contract.js"
import {
  contextPartEnvelopeSchema,
  type ContextInlineContent,
  type ContextPartEnvelope,
} from "./context.parts.js"
import type { ContextItem } from "./context.store.js"
import {
  getContextRuntimeServices,
  type ContextRuntimeServiceHandle,
} from "./context.runtime.js"

export type EventCreateInput = {
  id?: string
  type?: ItemType
  channel?: Channel
  createdAt?: string | Date
  status?: ContextItem["status"]
  content?: Omit<ContextItem["content"], "parts"> & Record<string, unknown>
}

export type EventBuilderStepInput = {
  iteration?: number
}

type EventBuilderStep = {
  iteration?: number
  parts: ContextPartEnvelope[]
}

function createId() {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID()
  }

  return "evt_" + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function normalizeCreatedAt(value: EventCreateInput["createdAt"]) {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string" && value.trim().length > 0) return value
  return new Date().toISOString()
}

function normalizeEvent(input: EventCreateInput = {}): ContextItem {
  return {
    id: input.id ?? createId(),
    type: input.type ?? INPUT_ITEM_TYPE,
    channel: input.channel ?? WEB_CHANNEL,
    createdAt: normalizeCreatedAt(input.createdAt),
    status: input.status,
    content: {
      ...(input.content ?? {}),
    },
  }
}

export class Part {
  static new(part: ContextPartEnvelope): ContextPartEnvelope {
    return contextPartEnvelopeSchema.parse(part)
  }

  static message(
    input:
      | string
      | {
          text?: string
          blocks?: ContextInlineContent[]
        },
  ): ContextPartEnvelope {
    const content = typeof input === "string" ? { text: input } : input
    return Part.new({
      type: "message",
      content,
    })
  }

  static file(input: {
    mediaType: string
    filename?: string
    data?: string
    url?: string
    fileId?: string
  }): ContextPartEnvelope {
    return Part.message({
      blocks: [
        {
          type: "file",
          mediaType: input.mediaType,
          filename: input.filename,
          data: input.data,
          url: input.url,
          fileId: input.fileId,
        },
      ],
    })
  }

  static json(value: unknown): ContextPartEnvelope {
    return Part.message({
      blocks: [
        {
          type: "json",
          value,
        },
      ],
    })
  }
}

export class EventBuilder {
  private steps: EventBuilderStep[] = []
  private currentStep: EventBuilderStep | null = null

  constructor(
    private readonly runtime: ContextRuntimeServiceHandle,
    private readonly input: EventCreateInput = {},
  ) {}

  simple(...parts: ContextPartEnvelope[]) {
    this.steps = []
    this.currentStep = null
    this.step()
    for (const part of parts) {
      this.part(part)
    }
    return this
  }

  step(input: EventBuilderStepInput = {}) {
    const next: EventBuilderStep = {
      iteration: input.iteration,
      parts: [],
    }
    this.steps.push(next)
    this.currentStep = next
    return this
  }

  part(part: ContextPartEnvelope) {
    if (!this.currentStep) {
      this.step()
    }
    this.currentStep?.parts.push(Part.new(part))
    return this
  }

  async create(): Promise<ContextItem> {
    const { store } = await getContextRuntimeServices(this.runtime)
    const parts = this.steps.flatMap((step) => step.parts)
    return await store.saveEvent(normalizeEvent({
      ...this.input,
      content: {
        ...(this.input.content ?? {}),
        ...(parts.length > 0 ? { parts } : {}),
      },
    }))
  }
}

export class EventsClient {
  constructor(private readonly runtime: ContextRuntimeServiceHandle) {}

  async create(input: EventCreateInput): Promise<ContextItem> {
    const { store } = await getContextRuntimeServices(this.runtime)
    return await store.saveEvent(normalizeEvent(input))
  }

  builder(input: EventCreateInput = {}) {
    return new EventBuilder(this.runtime, input)
  }
}

export function Events(runtime: ContextRuntimeServiceHandle) {
  return new EventsClient(runtime)
}
