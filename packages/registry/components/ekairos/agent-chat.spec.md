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
