import React, { useEffect, useMemo, useState } from "react"
import { Box, Text, render, useApp } from "ink"
import Spinner from "ink-spinner"
import type {
  CreateDomainAppParams,
  CreateDomainAppProgressEvent,
  CreateDomainAppProgressStage,
  CreateDomainAppResult,
} from "./create-app.js"
import { createDomainApp } from "./create-app.js"

type StepState = "pending" | "running" | "completed"

type StepView = {
  id: CreateDomainAppProgressStage
  label: string
  state: StepState
}

type CreateAppUiState = {
  currentMessage: string
  progress: number
  logs: string[]
  steps: StepView[]
  result: CreateDomainAppResult | null
  error: string | null
}

const STAGE_LABELS: Array<{ id: CreateDomainAppProgressStage; label: string }> = [
  { id: "prepare-target", label: "Prepare target" },
  { id: "detect-package-manager", label: "Detect package manager" },
  { id: "resolve-version", label: "Resolve package version" },
  { id: "provision-instant", label: "Provision Instant app" },
  { id: "write-files", label: "Write scaffold files" },
  { id: "write-env", label: "Write environment" },
  { id: "install", label: "Install dependencies" },
  { id: "smoke", label: "Run smoke test" },
  { id: "complete", label: "Complete" },
]

function createInitialState(): CreateAppUiState {
  return {
    currentMessage: "Starting create-app",
    progress: 0,
    logs: [],
    steps: STAGE_LABELS.map((stage) => ({
      id: stage.id,
      label: stage.label,
      state: "pending" as StepState,
    })),
    result: null,
    error: null,
  }
}

function applyProgress(
  prev: CreateAppUiState,
  event: CreateDomainAppProgressEvent,
): CreateAppUiState {
  if (event.status === "log") {
    return {
      ...prev,
      logs: [...prev.logs, event.message].slice(-10),
    }
  }

  return {
    ...prev,
    currentMessage: event.message,
    progress: event.progress ?? prev.progress,
    steps: prev.steps.map((step) => {
      if (step.id !== event.stage) return step
      return {
        ...step,
        state: event.status === "completed" ? "completed" : "running",
      }
    }),
  }
}

function StepRow({ step }: { step: StepView }) {
  const prefix =
    step.state === "completed"
      ? <Text color="green">OK</Text>
      : step.state === "running"
        ? <Text color="cyan"><Spinner type="dots" /></Text>
        : <Text color="gray">-</Text>

  return (
    <Box>
      <Text>{prefix} </Text>
      <Text color={step.state === "pending" ? "gray" : undefined}>{step.label}</Text>
    </Box>
  )
}

function CreateAppInk(props: {
  params: CreateDomainAppParams
  onSettled: (outcome: { result?: CreateDomainAppResult; error?: Error }) => void
}) {
  const { exit } = useApp()
  const [state, setState] = useState<CreateAppUiState>(() => createInitialState())

  const summary = useMemo(() => {
    if (!state.result) return []
    return [
      `Directory: ${state.result.directory}`,
      `Package manager: ${state.result.packageManager}`,
      ...(state.result.appId ? [`Instant app: ${state.result.appId}`] : []),
      ...(state.result.smoke?.baseUrl ? [`Review URL: ${state.result.smoke.baseUrl}`] : []),
    ]
  }, [state.result])

  useEffect(() => {
    let active = true

    const finish = (outcome: { result?: CreateDomainAppResult; error?: Error }) => {
      if (!active) return
      props.onSettled(outcome)
      setTimeout(() => {
        if (active) exit()
      }, outcome.error ? 900 : 450)
    }

    void createDomainApp({
      ...props.params,
      onProgress: async (event) => {
        if (!active) return
        setState((prev) => applyProgress(prev, event))
      },
    })
      .then((result) => {
        if (!active) return
        setState((prev) => ({
          ...prev,
          currentMessage: "App scaffolded successfully",
          progress: 100,
          result,
        }))
        finish({ result })
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!active) return
        setState((prev) => ({
          ...prev,
          error: message,
          currentMessage: message,
        }))
        finish({ error: error instanceof Error ? error : new Error(message) })
      })

    return () => {
      active = false
    }
  }, [exit, props])

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">Ekairos Domain CLI</Text>
      <Text color={state.error ? "red" : "gray"}>
        {state.error ? "Failed" : `${Math.max(0, Math.min(100, Math.round(state.progress)))}%`}{" "}
        {state.currentMessage}
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {state.steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </Box>

      {state.logs.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">Recent output</Text>
          {state.logs.map((line, index) => (
            <Text key={`${index}-${line}`} color="gray">
              {line}
            </Text>
          ))}
        </Box>
      ) : null}

      {summary.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">Result</Text>
          {summary.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </Box>
      ) : null}

      {state.error ? (
        <Box marginTop={1}>
          <Text color="red">{state.error}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

export async function runCreateAppInk(params: CreateDomainAppParams): Promise<CreateDomainAppResult> {
  let outcome: { result?: CreateDomainAppResult; error?: Error } | null = null

  const app = render(
    <CreateAppInk
      params={params}
      onSettled={(next) => {
        outcome = next
      }}
    />,
  )

  await app.waitUntilExit()

  if (!outcome) {
    throw new Error("create_app_ui_no_outcome")
  }

  const settled = outcome as { result?: CreateDomainAppResult; error?: Error }
  if (settled.error) {
    throw settled.error
  }
  if (!settled.result) {
    throw new Error("create_app_ui_missing_result")
  }

  return settled.result
}
