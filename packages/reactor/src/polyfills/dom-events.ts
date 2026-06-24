if (typeof (globalThis as any).Event === "undefined") {
  class NodeEvent {
    type: string
    constructor(type: string, init?: { [key: string]: unknown }) {
      this.type = type
      if (init && typeof init === "object") {
        Object.assign(this, init)
      }
    }
  }
  ;(globalThis as any).Event = NodeEvent
}
