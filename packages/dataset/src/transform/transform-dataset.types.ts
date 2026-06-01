import type { ContextReactor } from "@ekairos/events"
import type { TransformInputPreviewContext } from "./filepreview.js"

export type { TransformInputPreviewContext } from "./filepreview.js"

export type TransformSandboxState = {
  initialized: boolean
  inputPaths: Array<{ datasetId: string; path: string }>
}

export type TransformDatasetContext = {
  datasetId: string
  inputDatasetIds: string[]
  outputSchema: any
  sandboxConfig: {
    inputPaths: Array<{ datasetId: string; path: string }>
    outputPath: string
  }
  inputPreviews?: Array<{ datasetId: string; preview: TransformInputPreviewContext }>
  errors: string[]
  iterationCount: number
  instructions?: string
}

export type TransformDatasetAgentParams = {
  inputDatasetIds?: string[]
  outputSchema?: any
  instructions?: string
  datasetId?: string
  model?: string
  sandboxId?: string
  reactor?: ContextReactor<any, any>
  sandboxState?: TransformSandboxState
  inputPreviews?: Array<{ datasetId: string; preview: TransformInputPreviewContext }>
}

export type TransformDatasetRunOptions = {
  prompt?: string
  durable?: boolean
  initialContent?: Record<string, any>
}

export type TransformDatasetResult = {
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

export type TransformPromptContext = {
  datasetId: string
  inputDatasetIds: string[]
  outputSchema: any
  sandboxConfig: {
    inputPaths: Array<{ datasetId: string; path: string }>
    outputPath: string
  }
  inputPreviews?: Array<{
    datasetId: string
    preview: {
      totalRows: number
      metadata?: {
        description: string
        script: string
        command: string
        stdout: string
        stderr: string
      }
      head?: {
        description: string
        script: string
        command: string
        stdout: string
        stderr: string
      }
    }
  }>
  errors: string[]
}
