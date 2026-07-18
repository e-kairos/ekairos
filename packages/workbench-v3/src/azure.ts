import "server-only"

import { createOpenAI } from "@ai-sdk/openai"

let provider: ReturnType<typeof createOpenAI> | null = null

function env(name: string) {
  return String(process.env[name] ?? "").trim()
}

function required(name: string) {
  const value = env(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function baseURL() {
  const endpoint = env("AZURE_OPENAI_ENDPOINT")
  if (endpoint) {
    const normalized = endpoint.replace(/\/+$/, "")
    return normalized.endsWith("/openai") ? normalized : `${normalized}/openai`
  }
  return `https://${required("AZURE_RESOURCE_NAME")}.openai.azure.com/openai`
}

function azureFetch(apiVersion: string) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    const url = new URL(raw)
    if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", apiVersion)
    let request = init
    if (typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body)
        if (Array.isArray(body.tools)) {
          body.tools = body.tools.map((tool: any) => {
            if (tool?.type !== "function" || !tool.function) return tool
            const { strict: _strict, ...fn } = tool.function
            return { ...tool, function: fn }
          })
        }
        body.store = true
        request = { ...init, body: JSON.stringify(body) }
      } catch {}
    }
    return fetch(url, request)
  }
}

export function azureModelName() {
  return env("WORKBENCH_AZURE_MODEL") || "gpt-5.6-sol"
}

export function getAzureModel() {
  if (!provider) {
    const apiKey = env("AZURE_API_KEY") || env("AZURE_OPENAI_API_KEY")
    if (!apiKey) throw new Error("AZURE_API_KEY is required")
    provider = createOpenAI({
      apiKey,
      baseURL: baseURL(),
      headers: { Authorization: `Bearer ${apiKey}` },
      fetch: azureFetch(env("AZURE_API_VERSION") || "2025-04-01-preview"),
    })
  }
  return provider.responses(azureModelName() as any)
}
