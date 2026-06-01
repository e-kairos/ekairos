## Context Agent Prompt Activity

The context agent prompt owns live activity presentation.

- `PromptBar` renders `ContextActivityIndicator` by default.
- `ContextAgent` should not render a second standalone activity indicator in the conversation rail.
- Consumers can still import `ContextActivityIndicator` for explicit custom layouts, but the registry default chat UI keeps status attached to the input surface.
- The default live states are: `Enviando`, `Iniciando`, `Preparando`, `Pensando`, `Respondiendo`, `Trabajando`, `Finalizando`, `Listo`, and `Error`.
