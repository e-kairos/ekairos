import { contextDomain } from "@ekairos/events"

// The browser only reads Context graph entities. Server-only domain actions and
// Dataset/Sandbox implementation code stay out of the client bundle.
export const workbenchClientSchema = contextDomain.instantSchema()
