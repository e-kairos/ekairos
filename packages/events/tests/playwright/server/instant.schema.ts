/**
 * Story workflow smoke InstantDB schema entrypoint.
 */

import { domain } from "@ekairos/domain";
import { contextDomain } from "@ekairos/events";

const appDomain = domain("story-workflow-smoke")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} });

const schema = appDomain.instantSchema();

export type AppSchema = typeof schema;
export default schema;
