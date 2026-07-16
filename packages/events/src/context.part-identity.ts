export const CONTEXT_ID_NAMESPACE = "8be4c3a0-9e67-4f26-b60f-52b5b04d4b8d"

const TEXT_ENCODER = new TextEncoder()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

function sha1(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8
  const totalLength = Math.ceil((bytes.length + 9) / 64) * 64
  const message = new Uint8Array(totalLength)
  message.set(bytes)
  message[bytes.length] = 0x80
  const view = new DataView(message.buffer)
  view.setUint32(totalLength - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(totalLength - 4, bitLength >>> 0, false)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const words = new Uint32Array(80)
  for (let offset = 0; offset < totalLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false)
    }
    for (let index = 16; index < 80; index += 1) {
      words[index] = rotateLeft(
        words[index - 3]! ^ words[index - 8]! ^ words[index - 14]! ^ words[index - 16]!,
        1,
      )
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let index = 0; index < 80; index += 1) {
      const f = index < 20
        ? (b & c) | (~b & d)
        : index < 40
          ? b ^ c ^ d
          : index < 60
            ? (b & c) | (b & d) | (c & d)
            : b ^ c ^ d
      const k = index < 20
        ? 0x5a827999
        : index < 40
          ? 0x6ed9eba1
          : index < 60
            ? 0x8f1bbcdc
            : 0xca62c1d6
      const next = (rotateLeft(a, 5) + f + e + k + words[index]!) >>> 0
      e = d
      d = c
      c = rotateLeft(b, 30)
      b = a
      a = next
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  const output = new Uint8Array(20)
  const outputView = new DataView(output.buffer)
  ;[h0, h1, h2, h3, h4].forEach((value, index) =>
    outputView.setUint32(index * 4, value, false))
  return output
}

function uuidBytes(value: string): Uint8Array {
  const normalized = value.trim().toLowerCase()
  if (!UUID_RE.test(normalized)) throw new Error(`Invalid UUID namespace: ${value}`)
  const hex = normalized.replace(/-/g, "")
  return Uint8Array.from({ length: 16 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16))
}

function formatUuid(bytes: Uint8Array) {
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-")
}

export function uuidV5(name: string, namespace = CONTEXT_ID_NAMESPACE): string {
  const namespaceBytes = uuidBytes(namespace)
  const nameBytes = TEXT_ENCODER.encode(name)
  const input = new Uint8Array(namespaceBytes.length + nameBytes.length)
  input.set(namespaceBytes)
  input.set(nameBytes, namespaceBytes.length)
  const bytes = sha1(input).slice(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return formatUuid(bytes)
}
