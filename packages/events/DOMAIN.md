# Events, Context And Reaction Domains

Module: `@ekairos/events`

Exports:

- `eventsDomain`
- `contextDomain`
- `reactionDomain`
- event builders
- context handles and local materialization helpers
- runtime helpers for store resolution

`eventsDomain` is the clean event primitive. It owns durable facts that can be
attached to one or more contexts.

`contextDomain` composes `eventsDomain` and `reactionDomain`. It owns the
context itself and the relationships between contexts, events, and active
reaction executions.

`reactionDomain` owns execution state: executions, steps, parts, streams, and
trace rows. Steps and parts belong to a reaction execution, not to the event.
