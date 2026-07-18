const MODEL_ACTION_NAME = /^[a-zA-Z0-9_-]+$/
const MODEL_ACTION_NAME_MAX_LENGTH = 64

export function toModelActionName(canonicalName: string): string {
  if (
    canonicalName.length <= MODEL_ACTION_NAME_MAX_LENGTH &&
    MODEL_ACTION_NAME.test(canonicalName)
  ) {
    return canonicalName
  }

  const suffix = `_${stableHash(canonicalName)}`
  const base = canonicalName
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "action"
  return `${base.slice(0, MODEL_ACTION_NAME_MAX_LENGTH - suffix.length)}${suffix}`
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(36)
}
