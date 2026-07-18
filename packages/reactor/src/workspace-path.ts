const REACTOR_PATH = Symbol("@ekairos/reactor/path")

export type ReactorPath = string & Readonly<{ [REACTOR_PATH]: true }>

export function workspaceKey(value: string) {
  const text = String(value).trim()
  if (!text) throw new Error("reaction_path_segment_required")
  return encodeURIComponent(text).replace(/\./g, "%2E")
}

function literalSegment(value: string) {
  const text = String(value).trim()
  if (!text || text === "." || text === ".." || /[\\/]/.test(text)) {
    throw new Error(`reaction_path_segment_invalid:${value}`)
  }
  return text
}

function normalizeLogicalPath(value: string): string {
  const text = String(value).trim()
  if (/^[a-zA-Z]:[\\/]/.test(text) || text.startsWith("/") || text.startsWith("\\")) {
    throw new Error(`reaction_path_must_be_relative:${value}`)
  }
  if (text.includes("\\")) throw new Error(`reaction_path_invalid:${value}`)
  const parts = text.split("/")
  if (parts.length === 0 || parts.some(part => !part || part === "." || part === "..")) {
    throw new Error(`reaction_path_invalid:${value}`)
  }
  return parts.join("/")
}

export function contextWorkspacePath(
  contextId: string,
  ...segments: readonly string[]
): ReactorPath {
  const parts = ["contexts", workspaceKey(contextId), ...segments.map(literalSegment)]
  return parts.join("/") as ReactorPath
}

export function appendWorkspacePath(
  base: ReactorPath,
  ...segments: readonly string[]
): ReactorPath {
  return `${normalizeLogicalPath(base)}/${segments.map(literalSegment).join("/")}` as ReactorPath
}

export function resolveContextWorkspacePath(
  providerRoot: string,
  contextId: string,
  value?: ReactorPath,
): string {
  const logical = normalizeLogicalPath(value ?? contextWorkspacePath(contextId))
  const contextRoot = contextWorkspacePath(contextId)
  if (logical !== contextRoot && !logical.startsWith(`${contextRoot}/`)) {
    throw new Error(`reaction_path_outside_context:${logical}`)
  }
  const windows = /^[a-zA-Z]:[\\/]/.test(providerRoot) || providerRoot.includes("\\")
  const separator = windows ? "\\" : "/"
  const root = providerRoot.replace(/[\\/]+$/, "")
  return [root, ...logical.split("/")].join(separator)
}

export function relativeWorkspaceFile(value: string) {
  return normalizeLogicalPath(value)
}
