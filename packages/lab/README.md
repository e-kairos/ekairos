# @ekairos/lab

Ekairos Lab contains concrete reactions for operating on code workspaces through
`@ekairos/reactor` and a durable sandbox ID.

The package intentionally stays thin: context and execution persistence belong
to `@ekairos/events` / `@ekairos/reactor`, while sandbox provisioning belongs to
`@ekairos/sandbox`.
