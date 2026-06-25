import { join } from "node:path"

import type { StoredContextResource } from "./context.store.js"

export const CONTEXT_LOCAL_SEGMENT_MAX_LENGTH = 160

export function safeContextLocalSegment(value: string, fallback: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/\.\.+/g, "_")
    .replace(/\.+$/g, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, CONTEXT_LOCAL_SEGMENT_MAX_LENGTH)

  return normalized || fallback
}

export function safeContextLocalFilename(filename: string | undefined, fallback: string) {
  return safeContextLocalSegment(filename ?? fallback, fallback)
}

export function safeContextResourceLocalSegment(resource: StoredContextResource) {
  return safeContextLocalSegment(resource.storageKey ?? resource.key, "resource")
}

export function getContextLocalRoot(params: { basePath: string; contextId: string }) {
  return join(
    params.basePath,
    "contexts",
    safeContextLocalSegment(params.contextId, "context"),
  )
}

export function getContextResourceLocalRoot(params: {
  basePath: string
  contextId: string
  resourceKey: string
}) {
  return join(
    getContextLocalRoot(params),
    "resources",
    safeContextLocalSegment(params.resourceKey, "resource"),
  )
}

export function getContextExecutionLocalRoot(params: {
  basePath: string
  contextId: string
  executionId: string
}) {
  return join(
    getContextLocalRoot(params),
    "executions",
    safeContextLocalSegment(params.executionId, "execution"),
  )
}

export function getContextStepLocalRoot(params: {
  basePath: string
  contextId: string
  executionId: string
  stepId: string
}) {
  return join(
    getContextExecutionLocalRoot(params),
    "steps",
    safeContextLocalSegment(params.stepId, "step"),
  )
}

export function getContextPartLocalRoot(params: {
  basePath: string
  contextId: string
  executionId: string
  stepId: string
  partId: string
}) {
  return join(
    getContextStepLocalRoot(params),
    "parts",
    safeContextLocalSegment(params.partId, "part"),
  )
}
