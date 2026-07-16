# Ekairos Context Persistence Specification

## Canonical entities

- `context_contexts`
- `context_sessions`
- `context_events`
- `context_reactions`
- `context_eventParts`

No other entity is part of the Reaction execution model.

## Session contract

A Session records one invocation of a Reaction definition:

- Context
- trigger Event
- root Reaction
- optional parent Session
- status, sandbox id, and Workflow run id

A child Reaction invocation receives its own Session. It may share the parent
Context or run against another explicitly supplied Context.

## Reaction contract

A Reaction is a causal edge with ordered causes and effects. Root Reactions
represent the whole definition. Child Reactions represent `agent`, `action`,
`dataset`, `workspace`, `shell`, `git`, `emit`, or a nested Reaction boundary.

Cause and effect ids are stored as ordered JSON for deterministic projection and
also linked as real InstantDB relations for traversal.

## Event contract

Every observable result is an Event. Domain Events carry `domain`, `name`,
typed payload, logical links, and physical link metadata. Technical Events use
the `context.*` type namespace and carry operation metadata.

## Event Part contract

`context_eventParts` is the canonical streaming and replay surface. Parts are
ordered by `index`, linked to one Event, and use provider-neutral semantics:

- `message`
- `reasoning`
- `source`
- `action`
- `engine`

Provider-specific identifiers stay under Part metadata. An action uses separate
started and completed/failed Parts with the same action call id.

## Model projection

Each model request is compiled in this order:

1. stable Context content
2. each Event selected by `given(...)`, in supplied order
3. each Event's ordered Parts, including file projections
4. the unresolved instruction

There is no implicit history query. Linked files receive a stable metadata
header; supported text, image, and PDF content follows when available.

## React subscription

Clients subscribe to Context, Sessions, Events, Reactions, and Event Parts.
Optimistic input Events are reconciled by Event id. A Context is `running` while
its current Session is running, `failed` when that Session failed, and otherwise
`idle`.
