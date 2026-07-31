*** Begin ECU Change
Key: flat-session-execution-api
Title: Flat Context session execution API
Purpose: Replace the public callback/given execution surface with the approved flat Context/session/from API while preserving durable sessions, reactions, events, causality, streams, and operation internals.

*** Begin Context
Checkpoint: 1341b02 (working tree).
Scope: packages/events, packages/reactor, packages/dataset, packages/openai-reactor, related tests and DOMAIN.md files.
Hard exclusions: packages/registry and packages/workbench-v3.
Approved invariants: Context owns the durable git-like timeline; Session owns execution configuration; from(event | events) supplies causal material and reaction cause points; every operation retains its reaction record and existing storage model; the old public defineReaction callback API, app-facing executeReaction entry, GivenOperations, and given are deleted without compatibility; dispatch/subscriptions remain out of scope; gaps are reported rather than invented.
*** End Context
*** End ECU Change
