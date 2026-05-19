# @ekairos/tasks

Durable tasks with typed outcomes.

`@ekairos/tasks` is intentionally small. It owns task lifecycle and typed outcomes. Approval
policies, approvers, assignments, notifications, and domain-specific links remain app/domain
concerns layered above it.

```ts
const task = await Task.open(runtime, {
  kind: "approval",
  key: "requisition:approve:123",
  outcome: approvalOutcomeSchema,
  instructions: "Review this requisition before the step continues.",
  context: { requisitionId: "123" },
})

const outcome = await task.outcome()
```
