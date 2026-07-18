# Workbench Domain

`workbench` is a local review surface for the Context causal graph and a
production-shaped integration fixture for Reactor.

It composes `contextDomain`, `datasetDomain`, and `sandboxDomain`. It owns the
durable `workbench_reviews` entity and defines three facts:

- `workbench.messageReceived`: a chat or causal-review request entered the Context.
- `workbench.messageAnswered`: a Reaction completed with an answer.
- `workbench.reviewCompleted`: a formal Dataset was reviewed and its durable
  review was recorded.

`workbench.recordReview` accepts `dataset(workbenchItemSchema)`. Domain action
preparation therefore validates that the referenced Dataset exists and matches
the declared row type before the action implementation writes the review.

The application writes those facts through `Events(runtime).emit(...)`. Reactor
creates Sessions, Reactions, operation Events, Event Parts, and the optional
InstantDB stream owned by each streaming Reaction. A Reaction has zero or one
stream; non-streaming Reactions do not create placeholder streams.

Workflow is an explicit adapter boundary. The route calls `workflow.start(...)`
and returns `202`; the Workflow function calls `context.react(...)`. The Session
stores `workflowRunId`, while semantic operation Reactions provide the durable
timeline rendered by the Workbench Gantt. Lifecycle checkpoints remain runtime
details and are not presented as domain operations.

The read path is InstantDB-native. `useContext` queries Contexts with Sessions,
Reactions, Events, and Event Parts and consumes linked `$streams`; Workbench does
not query the Workflow control plane to build conversation or Gantt state.

The causal-review Reaction fans out Dataset materialization, requirement
extraction, and risk analysis with `Promise.all`; joins those three Events for a
decision; executes `recordReview`; and emits `reviewCompleted`. Dataset owns a
child Session linked to the parent materialization Reaction.

The Reaction resolves its sandbox lease at execution start. A Daytona sandbox
that no longer exists is replaced while preserving the same application and
Context; failures unrelated to absence are propagated unchanged.

`workbench.recordReview` receives only its originating `reactionId`. It resolves
the owning Context, emits `reviewVerificationRequested`, and starts the
verification child Reaction through that Context. No Reactor execution helpers
or capabilities enter the action implementation.
