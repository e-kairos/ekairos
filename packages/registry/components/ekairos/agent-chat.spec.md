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

## Review Transcript

Workbench and product review surfaces can render an agnostic turn transcript before dropping into raw debug.

- `ContextReviewTranscript` accepts a `ContextValue`-like object and derives input/output turns from events, steps, and parts.
- The transcript renders user input, assistant output, action counts, action errors, file/artifact attachments, and structured JSON answer summaries when available.
- The transcript exposes copy/download Markdown review actions and `buildContextReviewMarkdown(...)` for adapter-controlled export flows.
- Consumers may pass `actions` for explicit inspect/debug controls such as toggling message metadata; those controls must be user-initiated.
- Consumers may pass `resolveCueHref` to make evidence or snapshot cues navigable; the component must treat href generation as adapter-owned.
- The component preserves the event contract: files remain files, actions remain actions, and product-specific payloads only affect optional display summaries.
- Raw ids, step payloads, and part trees stay in Workshop/debug surfaces; the transcript is a review layer, not a replacement for event inspection.
- Use `density="compact"` when the transcript lives inside a product rail or workbench side panel; keep the default density for full-width Workshop review.
- `TemporalEvidenceList` renders source-agnostic timed cues with optional `href`; products decide whether a cue opens a replay timestamp, document source, trace row, or workbench panel.
- `TemporalEvidenceList` may render cues as links or adapter-owned selection buttons through `onSelectItem`; selected state is keyed by the adapter, not by event internals.

## Source Watch Status

Product workbenches can show live source monitoring without baking polling rules into chat UI.

- `SourceWatchStatus` renders an agnostic source state with phases: `checking`, `waiting`, `loading`, `loaded`, `empty`, and `error`.
- The component only displays status, count, timestamp, label, path, and optional open action; source-specific polling/autoload rules stay in product logic.
- Use `waiting` for a candidate that must stabilize before loading, `loading` for automatic ingestion, and `loaded` for the active latest source.
- File watchers, replay folders, imports, webhook streams, and task feeds should share this status shape instead of inventing product-specific chrome.

## Conversation Debug Boundary

The default chat thread is user-facing; raw event metadata belongs in Workshop and explicit debug surfaces.

- Message lists should not render `event`, `status`, or `channel` chips by default; consumers must opt in with `showMessageMetadata` for explicit inspect/debug layouts.
- Sticky streaming review is opt-in through `autoScroll`; consumers provide the constrained scroll rail with `classNames.messageList`.
- Step lists should not render raw `event_step`, iteration, or execution labels by default.
- Event ids, context ids, part payloads, and execution details stay available to adapters and Workshop.
- Product UIs may provide an explicit inspect/open-workshop action, but the message content should remain the primary visual signal.
