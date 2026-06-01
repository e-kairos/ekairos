# Ekairos Context Specification

`@ekairos/events` defines a context-first durable execution model.

## Core entities

- `context`
- `execution`
- `step`
- `part`
- `item`

## Persistence

Canonical persistence uses:

- `event_contexts`
- `event_executions`
- `event_steps`
- `event_parts`
- `event_items`

### Durable React Contract

When `react(...)` is called with `durable: true`, the call returns the persisted shell immediately
and also exposes an optional workflow run handle.

Immediate shell:

- `context`
- `trigger`
- `reaction`
- `execution`

Durable handle:

- `run.runId`
- `run.status`
- `run.returnValue`

`run.returnValue` resolves to the final `ContextReactResult` once the durable workflow completes.
This handle is runtime/server state, not canonical persisted domain data.

### Canonical Output Contract

`event_parts` is the canonical persisted representation of produced content.

`event_items` still exists as the stable envelope for input/output history, but for output items:

- `event_items.content.parts` is deprecated as a replay source
- `event_parts` is the authoritative model for step inspection and model reconstruction

### Event Part Semantics

`event_parts.part` must follow a strict semantic contract.

Top-level `part.type` values:

- `message`
- `reasoning`
- `source`
- `action`

Message parts carry `content.text` and optionally `content.blocks`, where each block is one of:

- `text`
- `file`
- `json`
- `source-url`
- `source-document`

Action execution is modeled explicitly and is provider agnostic:

- `action` with `content.status: "started"` carries the requested invocation.
- `action` with `content.status: "completed"` carries the settled output.
- `action` with `content.status: "failed"` carries the failure details.

External model/provider protocols may call these tools, function calls, actions, commands, or MCP
calls. Those names are adapter concerns. Persistence stores the semantic Ekairos action contract.

### Metadata Rule

Provider/model/runtime-specific data must be encapsulated under `metadata`.

Examples:

- provider item ids
- provider-executed flags
- model response ids
- transport-specific chunk references

These values must not leak into first-class semantic fields like `type`, `toolName`, `toolCallId`,
or the `content` entry shapes.

### Replay Rule

The replay pipeline must reconstruct model messages from canonical `event_parts` for output items.

Required projection:

- `message` / `reasoning` / `source` -> assistant or user content
- `action.started` -> provider-specific assistant action/tool call
- `action.completed` / `action.failed` -> provider-specific action/tool result

This rule exists so multipart action outputs, including image artifacts, survive replay without depending
on the deprecated `event_items.content.parts` mirror.

Tracing uses:

- `event_trace_events`
- `event_trace_runs`
- `event_trace_spans`

## Status model

- Context: `open_idle | open_streaming | closed`
- Execution: `executing | completed | failed`
- Step: `running | completed | failed`
- Item: `stored | pending | completed`

## Stream model

The runtime currently exposes context stream helpers, but the durable truth remains the persisted entities above. Clients should treat context state as primary and stream output as live UX.
