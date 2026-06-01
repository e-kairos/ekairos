## Context Agent Prompt Activity

The context agent prompt owns live activity presentation.

- `PromptBar` renders `ContextActivityIndicator` by default.
- `ContextAgent` should not render a second standalone activity indicator in the conversation rail.
- Consumers can still import `ContextActivityIndicator` for explicit custom layouts, but the registry default chat UI keeps status attached to the input surface.
- `getContextActivityState({ context, isUploading })` owns upload, send, stream, reasoning, action, terminal, and idle activity derivation; product adapters should pass upload state instead of inventing a second status label.
- `ContextActivityIndicator` exposes `data-context-activity`, `data-activity-phase`, `data-activity-label`, `data-activity-title`, `data-activity-tone`, `data-activity-pattern`, `data-activity-density`, `data-activity-animated`, and `data-activity-fading` for workbench and product smoke assertions.
- The default live states are: `Enviando`, `Iniciando`, `Preparando`, `Pensando`, `Respondiendo`, `Trabajando`, `Finalizando`, `Listo`, and `Error`.

## Prompt Composer Contract

The registry prompt composer is the shared baseline for context agents.

- The composer uses an autosizing textarea, not a single-line input.
- The toolbar owns attach, web search, reasoning, status, send, and stop controls.
- In compact density, toolbar controls use icon-first chrome; reasoning keeps its accessible label and tooltip but may hide the visible text label.
- File, pasted large-text, and virtual-context attachments render as removable chips above the textarea.
- Attachment chips expose `data-prompt-attachment`, `data-attachment-kind`, `data-attachment-status`, `data-attachment-name`, `data-attachment-media-type`, `data-attachment-size`, `data-attachment-has-file-part`, `data-attachment-has-return-action`, `data-prompt-attachment-main`, and `data-prompt-attachment-remove` so products can verify queued prompt context without reading provider payloads.
- Sending is valid when there is text or at least one ready non-text part.
- The send/stop control exposes `data-prompt-send`, `data-prompt-send-status`, and `data-prompt-send-variant` so products can verify compact and streaming chrome without binding to product CSS.
- The rendered prompt surface exposes `data-prompt-surface`, `data-prompt-status`, `data-prompt-status-label`, `data-prompt-busy`, `data-prompt-density`, and `data-prompt-attachment-count` so Workshop and product smoke tests can inspect composer state without product-specific selectors.
- `ContextAgent` root `data-context-prompt-density` must match the rendered prompt `data-prompt-density`.
- The persistent composer wrapper exposes `data-agent-prompt-shell` and `data-prompt-density` so products can locate the prompt rail without binding to layout classes.
- The visible prompt status label is a polite live status region (`role="status"`, `aria-live="polite"`), so send/upload/stream changes are accessible without raw event debug.
- Clicking non-interactive space inside the prompt surface focuses the textarea; interactive controls and attachment chips keep their own click behavior.
- Consumers may adapt storage, upload, or virtual attachment adapters, but the rendered event part contract stays agnostic: text parts and file parts are passed to `context.append(...)`.

## Artifact Prompt Bridge

Message artifacts can queue virtual prompt context without coupling the message renderer to storage.

- Artifact renderers emit a typed payload through the prompt bridge.
- Message-owned previews use `MessageArtifact` as the adapter-owned visual shell.
- `MessageArtifact` exposes `data-message-artifact`, optional `data-artifact-title` / `data-artifact-eyebrow`, `data-has-actions`, and `data-has-description` for product/workshop smoke assertions.
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
- The transcript root exposes `data-context-review-transcript`, `data-review-event-count`, `data-review-turn-count`, `data-review-status`, `data-review-send-status`, `data-review-max-turns`, `data-review-link-count`, and `data-review-markdown-ready`.
- Review turn cards expose `data-review-turn`, `data-review-turn-id`, `data-review-turn-status`, `data-action-count`, `data-action-error-count`, `data-attachment-count`, and `data-has-analysis`.
- Review message panels expose `data-review-message`, `data-kind`, `data-text-length`, `data-attachment-count`, `data-has-action-errors`, and `data-has-analysis`.
- Structured analysis summaries expose `data-review-analysis`, `data-analysis-comment-count`, `data-analysis-evidence-count`, `data-analysis-control-count`, `data-analysis-snapshot-count`, `data-analysis-cue-count`, and `data-analysis-has-imagegen`; linked evidence/snapshot cues expose `data-review-cue-list`, `data-review-cue`, `data-cue-kind`, `data-cue-index`, and `data-cue-time`.
- Markdown buttons expose `data-review-action="copy-markdown"` / `data-review-action="download-markdown"`; copy also exposes `data-review-copy-state`.
- Review transcript defaults to the latest six turns and renders text through Markdown with HTML skipped, so workbench `.md` review and in-app transcript stay aligned.
- Markdown export titles and download filenames stay generic (`Ekairos Context Review`, `context-review.md`); product identity belongs in `reviewLinks`, attachments, and adapter-owned surrounding chrome.
- Consumers may pass `reviewLinks` so copied/downloaded Markdown preserves product or Workshop review URLs needed to reproduce a run.
- Consumers may pass `actions` for explicit inspect/debug controls such as toggling message metadata; those controls must be user-initiated.
- Consumers may pass `resolveCueHref` to make evidence or snapshot cues navigable; the component must treat href generation as adapter-owned.
- The component preserves the event contract: files remain files, actions remain actions, and product-specific payloads only affect optional display summaries.
- Raw ids, step payloads, and part trees stay in Workshop/debug surfaces; the transcript is a review layer, not a replacement for event inspection.
- Use `density="compact"` when the transcript lives inside a product rail or workbench side panel; keep the default density for full-width Workshop review.
- `TemporalEvidenceList` renders source-agnostic timed cues with optional `href`; products decide whether a cue opens a replay timestamp, document source, trace row, or workbench panel.
- `TemporalEvidenceList` exposes `data-temporal-evidence-list`, `data-evidence-count`, `data-visible-evidence-count`, `data-max-items`, and per-cue `data-temporal-evidence-cue`, `data-cue-kind`, `data-cue-time`, and `data-cue-selected` attributes.
- `TemporalEvidenceList` may render cues as links or adapter-owned selection buttons through `onSelectItem`; selected state is keyed by the adapter, not by event internals.

## Source Watch Status

Product workbenches can show live source monitoring without baking polling rules into chat UI.

- `SourceWatchStatus` renders an agnostic source state with phases: `checking`, `waiting`, `loading`, `loaded`, `empty`, and `error`.
- The component only displays status, count, timestamp, label, path, and optional open action; source-specific polling/autoload rules stay in product logic.
- `SourceWatchStatus` exposes `data-source-watch-status`, `data-source-phase`, `data-source-count`, `data-source-label`, `data-source-detail`, `data-source-path`, `data-source-checked-at`, `data-source-busy`, and `data-source-has-open-action`.
- When `pollIntervalMs` is present, the component renders polling cadence, exposes `data-poll-interval-ms`, and marks checking/waiting/loading phases with `aria-busy`.
- Products may pass phase `labels` and `ariaLabelPrefix`; those are presentation labels, not source-specific state machines.
- Use `waiting` for a candidate that must stabilize before loading, `loading` for automatic ingestion, and `loaded` for the active latest source.
- File watchers, replay folders, imports, webhook streams, and task feeds should share this status shape instead of inventing product-specific chrome.

## Conversation Debug Boundary

The default chat thread is user-facing; raw event metadata belongs in Workshop and explicit debug surfaces.

- Message lists render as an agnostic transcript log (`role="log"`) with `aria-live`, `data-message-count`, `data-visible-message-count`, `data-turn-streaming`, and `data-at-bottom` so products and Workshop can inspect scroll/stream state without event-shape assumptions.
- Rendered text blocks expose `data-message-text`, `data-message-role`, `data-message-surface`, `data-message-streaming`, `data-text-length`, and `data-has-analysis`; message buttons expose `data-message-action` for actions such as `copy` or adapter-owned analysis playback.
- Message part containers expose `data-message-parts`, `data-message-role`, `data-message-surface`, `data-part-count`, `data-action-count`, `data-attachment-count`, and `data-unknown-part-count`; these counts describe rendered event parts, not provider internals.
- Default action rows expose `data-context-action`, `data-action-name`, `data-action-call-id`, `data-action-state`, `data-action-status`, `data-has-input`, `data-has-output`, and `data-has-error`; these describe normalized actions, not provider tool payloads.
- Action detail panels expose `data-action-detail="input" | "output" | "error"`, `data-action-detail-length`, and `data-action-detail-empty` so tests can assert normalized action detail availability without parsing raw JSON.
- Step lists expose `data-context-step-list`, `data-step-count`, `data-running-step-count`, `data-show-reasoning`, and `data-debug-enabled`; rendered steps expose `data-context-step`, `data-step-status`, `data-step-live`, `data-step-part-count`, `data-step-action-count`, and `data-step-has-debug` without raw step or execution ids.
- Message lists should not render `event`, `status`, or `channel` chips by default; consumers must opt in with `showMessageMetadata` for explicit inspect/debug layouts.
- Sticky streaming review is opt-in through `autoScroll`; consumers provide the constrained scroll rail with `classNames.messageList`.
- Step lists should not render raw `event_step`, iteration, or execution labels by default.
- Event ids, context ids, part payloads, and execution details stay available to adapters and Workshop.
- Unknown provider/runtime parts increment `data-unknown-part-count` but do not render raw payloads in the default chat thread.
- Product UIs may provide an explicit inspect/open-workshop action, but the message content should remain the primary visual signal.

## Runtime Surface Boundary

Context chat components do not expose provider-specific auth, IPC, or reactor controls.

- Product shells pass context API URLs, request preparation, attachments, and action renderers into the shared chat UI.
- The shared UI reads and renders agnostic events, steps, parts, actions, attachments, and status only.
- `ContextAgent` root exposes `data-context-agent`, `data-context-id`, `data-context-key`, `data-context-status`, `data-context-send-status`, `data-context-event-count`, `data-context-empty`, `data-context-has-activity`, `data-context-has-visible-events`, `data-context-loading`, `data-context-has-error`, `data-context-read-only`, and `data-context-prompt-density` so Workbench and product smoke tests can inspect shell state without raw provider event internals.
- User-facing answers and artifact titles should describe the domain result, not the provider, reactor, script mode, or implementation path that produced it.
- Debuggable row refs such as `sourceRef`, evidence links, and trace labels should use domain/data pipeline names, not provider or runtime names.
- Context agent components expose action surfaces (`actionComponents`, action cards, action state). Provider `tool-*` payloads are adapter input only and must be normalized before rendering.
- Provider login, model/runtime selection, sandbox controls, and raw reactor wiring stay outside the component surface unless an explicit debug/workshop adapter owns them.
- Scripted product workbenches should not keep provider-specific bridge objects in the browser global surface just because an older reactor path used them.
- Scripted product packages should not ship unused provider binaries, bridge helpers, or IPC clients; keeping those artifacts around makes the active runtime ambiguous.
