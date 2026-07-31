import {
  DOMAIN_ACTION_FULL_INPUT_TYPE,
  DOMAIN_ACTION_OWNER_TYPE,
  DOMAIN_ACTION_RUNTIME_TYPE,
} from "@ekairos/domain"

import { datasetActions } from "./actions.js"
import { datasetSchemaDomain } from "./schema.js"

export const datasetDomain = datasetSchemaDomain.withActions(datasetActions)





