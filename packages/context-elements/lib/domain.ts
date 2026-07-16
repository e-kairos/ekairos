import { domain } from "@ekairos/domain";
import { datasetDomain } from "@ekairos/dataset/domain";
import { contextDomain } from "@ekairos/events/schema";

const appDomain = domain("context-elements")
  .includes(contextDomain)
  .includes(datasetDomain)
  .withSchema({
    entities: {},
    links: {},
    rooms: {},
  })
  .withActions(datasetDomain.actions);

export default appDomain;
