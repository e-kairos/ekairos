import { clearDataset } from "./clearDataset.tool.js"
import { completeDataset } from "./completeDataset.tool.js"
import { defineNotation } from "./defineNotation.tool.js"
import { executeCommand } from "./executeCommand.tool.js"
import { generateSchema } from "./file/generateSchema.tool.js"
import {
  prepareFileMaterialization,
  prepareTransformMaterialization,
} from "./materialization.actions.js"
import { completeObject, replaceRows } from "./writeDatasetRows.tool.js"

export const datasetActions: {
  readonly executeCommand: typeof executeCommand
  readonly completeDataset: typeof completeDataset
  readonly clearDataset: typeof clearDataset
  readonly defineNotation: typeof defineNotation
  readonly generateSchema: typeof generateSchema
  readonly replaceRows: typeof replaceRows
  readonly completeObject: typeof completeObject
  readonly prepareFileMaterialization: typeof prepareFileMaterialization
  readonly prepareTransformMaterialization: typeof prepareTransformMaterialization
} = {
  executeCommand,
  completeDataset,
  clearDataset,
  defineNotation,
  generateSchema,
  replaceRows,
  completeObject,
  prepareFileMaterialization,
  prepareTransformMaterialization,
}

export {
  clearDataset,
  completeDataset,
  completeObject,
  defineNotation,
  executeCommand,
  generateSchema,
  replaceRows,
  prepareFileMaterialization,
  prepareTransformMaterialization,
}

export {
  prepareFileMaterializationInputSchema,
  prepareFileMaterializationOutputSchema,
  prepareTransformMaterializationInputSchema,
  prepareTransformMaterializationOutputSchema,
} from "./materialization.actions.js"

export {
  clearDatasetInputSchema,
  clearDatasetOutputSchema,
} from "./clearDataset.tool.js"
export {
  completeDatasetInputSchema,
  completeDatasetOutputSchema,
} from "./completeDataset.tool.js"
export {
  defineNotationInputSchema,
  defineNotationOutputSchema,
  notationPredicateSchema,
  notationSymbolSchema,
} from "./defineNotation.tool.js"
export {
  datasetSourceInputSchema,
  executeCommandInputSchema,
  executeCommandOutputSchema,
  materializedSourceSchema,
} from "./executeCommand.tool.js"
export {
  generateSchemaInputSchema,
  generateSchemaOutputSchema,
} from "./file/generateSchema.tool.js"
export {
  completeObjectInputSchema,
  datasetRowsActionOutputSchema,
  replaceRowsInputSchema,
} from "./writeDatasetRows.tool.js"
