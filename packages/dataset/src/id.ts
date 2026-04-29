export function createDatasetId(): string {
  const uuid = (globalThis.crypto as any)?.randomUUID?.()
  if (typeof uuid === "string" && uuid.length > 0) return uuid
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
