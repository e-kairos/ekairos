export const DATASET_OUTPUT_FILE_NAME = "output.jsonl"

const DATASET_WORKDIR_BASE = "/tmp/ekairos/dataset"

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

export function getDatasetWorkdirBase(): string {
  return trimTrailingSlash(DATASET_WORKDIR_BASE)
}

export function getDatasetWorkstation(datasetId: string): string {
  return `${getDatasetWorkdirBase()}/${datasetId}`
}

export function getDatasetResourcesDir(datasetId: string): string {
  return `${getDatasetWorkstation(datasetId)}/resources`
}

export function getDatasetScriptsDir(datasetId: string): string {
  return `${getDatasetWorkstation(datasetId)}/scripts`
}

export function getDatasetArtifactsDir(datasetId: string): string {
  return `${getDatasetWorkstation(datasetId)}/artifacts`
}

export function getDatasetLogsDir(datasetId: string): string {
  return `${getDatasetWorkstation(datasetId)}/logs`
}

export function getDatasetStandardDirs(datasetId: string): string[] {
  return [
    getDatasetWorkstation(datasetId),
    getDatasetResourcesDir(datasetId),
    getDatasetScriptsDir(datasetId),
    getDatasetArtifactsDir(datasetId),
    getDatasetLogsDir(datasetId),
  ]
}

export function getDatasetOutputPath(datasetId: string): string {
  return `${getDatasetWorkstation(datasetId)}/${DATASET_OUTPUT_FILE_NAME}`
}
