## Context Agent Prompt Activity

The context agent prompt owns live activity presentation.

- `PromptBar` renders `ContextActivityIndicator` by default.
- `ContextAgent` should not render a second standalone activity indicator in the conversation rail.
- Consumers can still import `ContextActivityIndicator` for explicit custom layouts, but the registry default chat UI keeps status attached to the input surface.
- `getContextActivityState({ context, isUploading })` owns upload, send, stream, reasoning, action, terminal, and idle activity derivation; product adapters should pass upload state instead of inventing a second status label.
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
- Message-owned previews use `MessageArtifact` as the adapter-owned visual shell.
- Product-specific preview classes and controls belong inside `MessageArtifact.children` or `MessageArtifact.actions`; the outer shell remains source-agnostic.
- `MessageArtifact.actionCallId` marks `data-ek-artifact-anchor` so prompt chips can jump back to the originating artifact.
- `PromptBar` renders that payload as a removable attachment chip.
- On submit, the queued payload is sent as a standard `file` part with domain-specific metadata, alongside any text part.
- Product adapters may choose the payload shape, but the event part remains agnostic.
- Artifact actions must be user-initiated; generated attachments still enter events as standard file parts.

## Review Transcript

Workbench and product review surfaces can render an agnostic turn transcript before dropping into raw debug.

- `ContextReviewTranscript` accepts a `ContextValue`-like object and derives input/output turns from events, steps, and parts.
- The transcript renders user input, assistant output, action counts, action errors, file/artifact attachments, and structured JSON answer summaries when available.
- The transcript exposes copy/download Markdown review actions and `buildContextReviewMarkdown(...)` for adapter-controlled export flows.
- Review transcript defaults to the latest six turns and renders text through Markdown with HTML skipped, so workbench `.md` review and in-app transcript stay aligned.
- Markdown export titles and download filenames stay generic (`Ekairos Context Review`, `context-review.md`); product identity belongs in `reviewLinks`, attachments, and adapter-owned surrounding chrome.
- Consumers may pass `reviewLinks` so copied/downloaded Markdown preserves product or Workshop review URLs needed to reproduce a run.
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
- When `pollIntervalMs` is present, the component renders polling cadence, exposes `data-poll-interval-ms`, and marks checking/waiting/loading phases with `aria-busy`.
- Products may pass phase `labels` and `ariaLabelPrefix`; those are presentation labels, not source-specific state machines.
- Use `waiting` for a candidate that must stabilize before loading, `loading` for automatic ingestion, and `loaded` for the active latest source.
- File watchers, replay folders, imports, webhook streams, and task feeds should share this status shape instead of inventing product-specific chrome.

## Conversation Debug Boundary

The default chat thread is user-facing; raw event metadata belongs in Workshop and explicit debug surfaces.

- Message lists should not render `event`, `status`, or `channel` chips by default; consumers must opt in with `showMessageMetadata` for explicit inspect/debug layouts.
- Sticky streaming review is opt-in through `autoScroll`; consumers provide the constrained scroll rail with `classNames.messageList`.
- Step lists should not render raw `event_step`, iteration, or execution labels by default.
- Event ids, context ids, part payloads, and execution details stay available to adapters and Workshop.
- Product UIs may provide an explicit inspect/open-workshop action, but the message content should remain the primary visual signal.

## Runtime Surface Boundary

Context chat components do not expose provider-specific auth, IPC, or reactor controls.

- Product shells pass context API URLs, request preparation, attachments, and action renderers into the shared chat UI.
- The shared UI reads and renders agnostic events, steps, parts, actions, attachments, and status only.
- User-facing answers and artifact titles should describe the domain result, not the provider, reactor, script mode, or implementation path that produced it.
- Debuggable row refs such as `sourceRef`, evidence links, and trace labels should use domain/data pipeline names, not provider or runtime names.
- Context agent components expose action surfaces (`actionComponents`, action cards, action state). Provider `tool-*` payloads are adapter input only and must be normalized before rendering.
- Provider login, model/runtime selection, sandbox controls, and raw reactor wiring stay outside the component surface unless an explicit debug/workshop adapter owns them.
- Scripted product workbenches should not keep provider-specific bridge objects in the browser global surface just because an older reactor path used them.
- Scripted product packages should not ship unused provider binaries, bridge helpers, or IPC clients; keeping those artifacts around makes the active runtime ambiguous.
