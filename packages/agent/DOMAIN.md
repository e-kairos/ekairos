# Agent Projection Domain

Module: `@ekairos/agent`

Canonical domain: `agentDomain`

Agent owns one durable projection: `agent_threads` linked one-to-one to an
`context_contexts` Context. It exists for conversational navigation and UI query
shape.

Agent does not own model execution, tools, stores, transports, or an autonomous
runner. Applications define domain Events and Reactions with
`@ekairos/reactor`; Channel binds transport input to those Reactions. The public
runtime surface is the domain plus thread timeline projection helpers. Streaming
is projected from `context_events.eventParts`; Agent owns no parallel stream state.
