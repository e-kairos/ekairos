# Workbench Domain

`workbench` is a local review surface for the Context causal graph and a
production-shaped integration fixture for Reactor.

It composes `contextDomain`, `datasetDomain`, and `sandboxDomain`. It owns the
durable `workbench_reviews` entity and defines five facts:

- `workbench.messageReceived`: a chat or causal-review request entered the Context.
- `workbench.messageAnswered`: a Reaction completed with an answer.
- `workbench.reviewCompleted`: a formal Dataset was reviewed and its durable
  review was recorded.
- `workbench.reviewVerificationRequested`: verification began for a recorded
  review.
- `workbench.reviewVerificationCompleted`: verification finished.

`workbench.recordReview` accepts `dataset(workbenchItemSchema)`. Domain action
preparation therefore validates that the referenced Dataset exists and matches
the declared row type before the action implementation writes the review.

The HTTP adapter writes `messageReceived` through `Events(runtime).emit(...)`
to preserve channel parts and the caller event id. Session flows append their
terminal domain facts through `session.context.append(...)`. Reactor creates
Sessions, Reactions, operation Events, Event Parts, and the optional InstantDB
stream owned by each streaming Reaction.

Workflow is an explicit adapter boundary. The route calls `workflow.start(...)`
and returns `202`; the Workflow function calls a normal orchestration function
that opens `Context(runtime).session(...)`. The Session stores `workflowRunId`,
while semantic operation Reactions provide the durable timeline rendered by the
Workbench Gantt.

The read path is InstantDB-native. `useContext` queries Contexts with Sessions,
Reactions, Events, and Event Parts and consumes linked `$streams`; Workbench does
not query the Workflow control plane to build conversation or Gantt state.

The causal-review Session fans out Dataset materialization, requirement
extraction, and risk analysis with `Promise.all`; joins those three Events for a
decision; executes `recordReview`; and appends `reviewCompleted`.

The adapter resolves the sandbox lease before starting the review Session. A
Daytona sandbox that no longer exists is replaced while preserving the same
application and Context; failures unrelated to absence are propagated unchanged.

`workbench.recordReview` receives only domain input. Its optional second execute
argument provides `{ context, sessionId, reactionId, causeIds }`; the action uses
the ambient Context key to open a verification Session from a
`reviewVerificationRequested` draft. No execution identity is duplicated in the
action input.
