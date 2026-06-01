"use client"

import React, { useState } from "react"

const REGISTRY_HOST = "registry.ekairos.dev"

const COMMAND =
  "pnpm dlx shadcn@4.8.0 add https://registry.ekairos.dev/r/<nombre-componente>.json"

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground text-xs transition-colors"
    >
      {copied ? "copiado" : "copiar"}
    </button>
  )
}

export function InstallInstructions() {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[0.7rem] text-muted-foreground uppercase tracking-[0.5em]">
          instalacion
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Usa el CLI de shadcn para instalar los componentes publicados por dominio.
        </p>
      </div>

      <div className="border border-border/80 bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <code className="text-sm font-mono text-foreground break-all">{COMMAND}</code>
          <CopyButton text={COMMAND} />
        </div>
      </div>

      <p className="text-[0.65rem] text-muted-foreground">
        Registry base: {REGISTRY_HOST}. Copia el comando y reemplaza{" "}
        <code className="font-mono">&lt;nombre-componente&gt;</code> para instalar un
        componente publicado.
      </p>
    </div>
  )
}
