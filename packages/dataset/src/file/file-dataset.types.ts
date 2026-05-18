import type { ContextReactor } from "@ekairos/events"
import type { FilePreviewContext } from "./filepreview.types.js"

export type SandboxState = {
  initialized: boolean
  filePath: string
  outputPath?: string
  scriptsDir?: string
  manifestPath?: string
}

export type FileParseContext = {
  datasetId: string
  fileId: string
  instructions: string
  sandboxConfig: {
    filePath: string
    outputPath?: string
    scriptsDir?: string
    manifestPath?: string
  }
  analysis: any[]
  schema: any | null
  plan: any | null
  executionResult: any | null
  errors: string[]
  iterationCount: number
  filePreview?: FilePreviewContext
}

export type FileParseContextParams = {
  fileId?: string
  instructions?: string
  sandboxId?: string
  datasetId?: string
  model?: string
  reactor?: ContextReactor<any, any>
  sandboxState?: SandboxState
  filePreview?: FilePreviewContext
  schema?: any | null
  sourceEventId?: string
  sourcePartIndex?: number
  filename?: string
  mediaType?: string
}

export type FileParseRunOptions = {
  prompt?: string
  durable?: boolean
  initialContent?: Record<string, any>
}

export type FileParseContextBuilder<Env extends { orgId: string }> = {
  datasetId: string
  context: any
}

export type DatasetResult = {
  id: string
  status?: string
  title?: string
  schema?: any
  analysis?: any
  calculatedTotalRows?: number
  actualGeneratedRowCount?: number
  createdAt?: number
  updatedAt?: number
}
