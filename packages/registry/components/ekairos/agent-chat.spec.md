## Context Agent Prompt Activity

The context agent prompt owns live activity presentation.

- `PromptBar` renders `ContextActivityIndicator` by default.
- `ContextAgent` should not render a second standalone activity indicator in the conversation rail.
- Consumers can still import `ContextActivityIndicator` for explicit custom layouts, but the registry default chat UI keeps status attached to the input surface.
- The default live states are: `Enviando`, `Iniciando`, `Preparando`, `Pensando`, `Respondiendo`, `Trabajando`, `Finalizando`, `Listo`, and `Error`.

## Prompt Composer Contract

The registry prompt composer is the shared baseline for context agents.

- The composer uses an autosizing textarea, not a single-line input.
- The toolbar owns attach, web search, reasoning, status, send, and stop controls.
- File, pasted large-text, and virtual-context attachments render as removable chips above the textarea.
- Sending is valid when there is text or at least one ready non-text part.
- Consumers may adapt storage, upload, or virtual attachment adapters, but the rendered event part contract stays agnostic: text parts and file parts are passed to `context.append(...)`.

## Artifact Prompt Bridge

Message artifacts can queue virtual prompt context without coupling the message renderer to storage.

- Artifact renderers emit a typed payload through the prompt bridge.
- `PromptBar` renders that payload as a removable attachment chip.
- On submit, the queued payload is sent as a standard `file` part with domain-specific metadata, alongside any text part.
- Product adapters may choose the payload shape, but the event part remains agnostic.

## Conversation Debug Boundary

The default chat thread is user-facing; raw event metadata belongs in Workshop and explicit debug surfaces.

- Message lists should not render `event`, `status`, or `channel` chips by default.
- Step lists should not render raw `event_step`, iteration, or execution labels by default.
- Event ids, context ids, part payloads, and execution details stay available to adapters and Workshop.
- Product UIs may provide an explicit inspect/open-workshop action, but the message content should remain the primary visual signal.
