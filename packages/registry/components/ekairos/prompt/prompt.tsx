import React from "react"
import PromptTextarea from "./prompt-textarea"
import PromptWebButton from "./prompt-button-web"
import PromptReasoningButton from "./prompt-button-reasoning"
import PromptVoiceButton from "./prompt-button-voice"
import PromptSendButton from "./prompt-button-send"
import PromptAttachButton from "./prompt-button-attach"
import PromptFileChip, { type PromptAttachment } from "./prompt-file-chip"
import { cn } from "@/lib/utils"

type PromptFileSelection = FileList | File[]

const LARGE_TEXT_PASTE_THRESHOLD = 1800

function hasFiles(files: PromptFileSelection | null | undefined) {
  return Boolean(files && files.length > 0)
}

function getClipboardFiles(event: React.ClipboardEvent<HTMLTextAreaElement>) {
  const items = event.clipboardData?.items
  if (!items) return []

  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}

function createPastedTextFile(text: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return new File([text], `pasted-text-${stamp}.txt`, {
    type: "text/plain",
  })
}

type PromptProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  onToggleVoice?: () => void
  onStop?: () => void
  reasoningLevel?: "off" | "low" | "medium" | "high"
  onChangeReasoning?: (v: "off" | "low" | "medium" | "high") => void
  webSearch?: boolean
  onToggleWeb?: () => void
  status?: "idle" | "submitted" | "streaming" | "error"
  onFilesSelected?: (files: PromptFileSelection) => void
  isUploading?: boolean
  attachments?: PromptAttachment[]
  onRemoveAttachment?: (id: string) => void
  /** Allow send when textarea is empty but attachments / virtual context are present. */
  hasNonTextSendPayload?: boolean
  className?: string
  placeholder?: string
  disabled?: boolean
  inputDisabled?: boolean
  /** Embedded / floating chat: tighter padding and smaller chrome. */
  density?: "default" | "compact"
  contextLabel?: string
}

export function Prompt({
  value,
  onChange,
  onSubmit,
  onToggleVoice,
  onStop,
  reasoningLevel,
  onChangeReasoning,
  webSearch,
  onToggleWeb,
  status,
  onFilesSelected,
  isUploading,
  attachments,
  onRemoveAttachment,
  hasNonTextSendPayload = false,
  className,
  placeholder,
  disabled = false,
  inputDisabled,
  density = "default",
  contextLabel,
}: PromptProps) {
  const compact = density === "compact"
  const normalizedValue = typeof value === "string" ? value : String(value ?? "")
  const isDirty =
    normalizedValue.trim().length > 0 || Boolean(hasNonTextSendPayload)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const isBusy = status === "submitted" || status === "streaming"
  const promptBusy = isBusy || Boolean(isUploading)
  const promptStatus = isUploading && (!status || status === "idle") ? "uploading" : status ?? "idle"
  const canStop = status === "streaming" && typeof onStop === "function"
  const controlsDisabled = disabled || isBusy
  const textareaDisabled = inputDisabled ?? controlsDisabled
  const sendDisabled =
    canStop ? false : disabled || status === "submitted" || !isDirty || Boolean(isUploading)
  const attachmentList = Array.isArray(attachments) ? attachments : []
  const handleTextareaChange = React.useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event.target.value ?? "")
    },
    [onChange],
  )

  const submitFiles = React.useCallback(
    (files: PromptFileSelection | null | undefined) => {
      if (!hasFiles(files) || !onFilesSelected) return
      onFilesSelected(files as PromptFileSelection)
    },
    [onFilesSelected],
  )

  function handleAttachClick() {
    fileInputRef.current?.click()
  }

  const handlePromptSurfaceClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    if (target?.closest("button, [role='button'], input, textarea, a")) return
    textareaRef.current?.focus()
  }, [])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files) {
      submitFiles(files)
      e.currentTarget.value = ""
    }
  }

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardFiles = getClipboardFiles(event)
      if (clipboardFiles.length > 0) {
        event.preventDefault()
        submitFiles(clipboardFiles)
        return
      }

      const pastedText = event.clipboardData?.getData("text/plain") ?? ""
      if (pastedText.length >= LARGE_TEXT_PASTE_THRESHOLD) {
        event.preventDefault()
        submitFiles([createPastedTextFile(pastedText)])
      }
    },
    [submitFiles],
  )

  function handleDragOver(event: React.DragEvent<HTMLFormElement>) {
    if (!onFilesSelected || controlsDisabled) return
    if (!Array.from(event.dataTransfer.types).includes("Files")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setIsDragging(true)
  }

  function handleDragLeave(event: React.DragEvent<HTMLFormElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsDragging(false)
  }

  function handleDrop(event: React.DragEvent<HTMLFormElement>) {
    if (!onFilesSelected || controlsDisabled) return
    event.preventDefault()
    setIsDragging(false)
    submitFiles(event.dataTransfer.files)
  }

  const statusText =
    status === "streaming"
      ? "Respondiendo"
      : status === "submitted"
        ? "Enviando"
        : status === "error"
          ? "Error al enviar"
          : isUploading
            ? "Subiendo adjuntos"
            : contextLabel
              ? contextLabel
              : "Listo"

  return (
    <form 
      onSubmit={onSubmit} 
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "relative flex flex-col w-full max-w-3xl mx-auto",
        compact && "max-w-none mx-0",
        className
      )}
    >
      <div
        aria-busy={promptBusy || undefined}
        className={cn(
          "relative flex w-full flex-col overflow-hidden border bg-background/95 shadow-[0_18px_60px_-36px_rgba(15,23,42,0.55),0_2px_10px_-6px_rgba(15,23,42,0.22)] backdrop-blur-md transition-[background-color,border-color,box-shadow]",
          compact
            ? "cursor-text rounded-b-xl rounded-t-none border-transparent border-t-slate-200/80 shadow-none focus-within:border-transparent focus-within:border-t-slate-300 focus-within:shadow-none"
            : "rounded-[1.35rem] border-border/65 focus-within:border-ring/35 focus-within:shadow-[0_24px_70px_-38px_rgba(15,23,42,0.62),0_0_0_1px_hsl(var(--ring)/0.14)]",
          !compact && "dark:shadow-[0_20px_64px_-34px_rgba(0,0,0,0.82),0_1px_8px_-5px_rgba(0,0,0,0.6)]",
          isDragging && "border-ring/65 shadow-[0_22px_62px_-34px_rgba(15,23,42,0.64),0_0_0_1px_hsl(var(--ring)/0.2)]",
        )}
        data-prompt-attachment-count={attachmentList.length}
        data-prompt-busy={promptBusy ? "true" : "false"}
        data-prompt-density={density}
        data-prompt-status={promptStatus}
        data-prompt-status-label={statusText}
        data-prompt-surface
        onClick={handlePromptSurfaceClick}
      >
        {isDragging ? (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-background/85 text-xs font-medium text-foreground backdrop-blur-md">
            Soltar archivos para adjuntar
          </div>
        ) : null}
        
        {/* File Attachments Area */}
        {attachmentList.length > 0 && (
          <div className={cn(
            "flex flex-wrap gap-2 border-b border-border/45",
            compact ? "bg-transparent" : "bg-muted/[0.18]",
            compact ? "gap-1.5 p-2.5" : "gap-2 p-3",
          )}
          data-prompt-attachments
          data-prompt-density={density}
          >
            {attachmentList.map((f) => (
              <PromptFileChip key={f.id} file={f} onRemove={onRemoveAttachment} />
            ))}
          </div>
        )}
        
        {/* Text Area */}
        <PromptTextarea 
          ref={textareaRef}
          value={normalizedValue} 
          onChange={handleTextareaChange} 
          onPaste={handlePaste}
          disabled={textareaDisabled}
          placeholder={compact ? "Escribe un mensaje..." : placeholder ?? "Pedir cambios o hacer una pregunta..."}
          minHeight={compact ? 40 : 52}
          maxHeight={compact ? 120 : 180}
          className={cn(
            "leading-relaxed text-sm",
            compact ? "min-h-[38px] px-3 pb-2.5 pt-7" : "min-h-[66px] px-[18px] py-4",
          )}
        />
        
        {/* Toolbar */}
        <div className={cn(
          "flex items-center justify-between gap-2",
          !compact && "border-t border-border/35",
          compact ? "bg-transparent" : "bg-muted/[0.16]",
          compact ? "px-2 pb-4 pt-1.5" : "p-2.5 pl-3.5 pr-2.5",
        )}
        data-prompt-density={density}
        data-prompt-toolbar
        >
          <div className="flex min-w-0 items-center gap-1">
            <input ref={fileInputRef} type="file" className="hidden" multiple onChange={handleFileChange} disabled={controlsDisabled} />
            <PromptAttachButton onClick={handleAttachClick} disabled={controlsDisabled} variant={compact ? "ghost" : "default"} />
            <PromptWebButton active={Boolean(webSearch)} onToggle={onToggleWeb} disabled={controlsDisabled} variant={compact ? "ghost" : "default"} />
            <PromptReasoningButton value={reasoningLevel} onChange={onChangeReasoning} disabled={controlsDisabled} variant={compact ? "ghost" : "default"} iconOnly={compact} />
            <div
              aria-live="polite"
              className="ml-1 hidden min-w-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground sm:flex"
              data-prompt-status-label={statusText}
              data-status={promptStatus}
              role="status"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  status === "error"
                    ? "bg-destructive"
                    : status === "streaming" || status === "submitted" || isUploading
                      ? "bg-primary"
                      : "bg-muted-foreground/45",
                )}
              />
              <span className="truncate">{statusText}</span>
            </div>
          </div>
          
          <div className="flex shrink-0 items-center gap-1.5">
            {onToggleVoice && <PromptVoiceButton onClick={onToggleVoice} disabled={controlsDisabled} variant={compact ? "ghost" : "default"} />}
            <PromptSendButton
              disabled={sendDisabled}
              status={status}
              onStop={onStop}
              variant={compact ? "filled" : "default"}
            />
          </div>
        </div>
      </div>
      
    </form>
  )
}
