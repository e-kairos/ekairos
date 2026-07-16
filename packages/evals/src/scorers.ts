import type { EvalScore, EvalScorer, EvalScorerInput } from "./evals.js"

/**
 * Built-in scorers. All of them work over the persisted context trace — the
 * canonical parts every reactor reaction leaves behind — plus the typed
 * output, so agent behavior (not just answers) is evaluable.
 */

/** Deep-equality between the case output and `expected`. */
export function exactOutput(): EvalScorer {
  return {
    name: "exact_output",
    score({ output, expected }) {
      const equal = deepEqual(output, expected)
      return {
        score: equal ? 1 : 0,
        reason: equal ? undefined : `expected ${short(expected)}, got ${short(output)}`,
      }
    },
  }
}

/**
 * Verifies the model actually executed an action during the reaction —
 * behavioral assertions like "it must have read the document before
 * answering". Matches completed canonical action parts by name.
 */
export function actionCalled(
  actionName: string,
  options: { atLeast?: number; atMost?: number } = {},
): EvalScorer {
  const atLeast = options.atLeast ?? 1
  return {
    name: `action_called:${actionName}`,
    score({ snapshot }) {
      const calls = snapshot.parts.filter(
        (part) =>
          part?.type === "action" &&
          part?.content?.actionName === actionName &&
          part?.content?.status === "completed",
      ).length
      const withinMax = options.atMost === undefined || calls <= options.atMost
      const ok = calls >= atLeast && withinMax
      return {
        score: ok ? 1 : 0,
        reason: ok
          ? undefined
          : `action "${actionName}" completed ${calls}x (expected >= ${atLeast}${options.atMost !== undefined ? `, <= ${options.atMost}` : ""})`,
      }
    },
  }
}

/** The Reaction Session finished with the given status (default "completed"). */
export function sessionCompleted(status = "completed"): EvalScorer {
  return {
    name: "session_completed",
    score({ snapshot }) {
      const ok = snapshot.sessionStatus === status
      return {
        score: ok ? 1 : 0,
        reason: ok ? undefined : `session status: ${snapshot.sessionStatus}`,
      }
    },
  }
}

/** Free-form scorer over output + trace. */
export function custom(
  name: string,
  score: (input: EvalScorerInput) => Promise<EvalScore> | EvalScore,
): EvalScorer {
  return { name, score }
}

/**
 * LLM-as-judge over the case output and the assistant's visible messages,
 * scored against free-form criteria. Returns the judge's score in [0, 1].
 */
export function llmJudge(options: {
  criteria: string
  model?: string
  name?: string
}): EvalScorer {
  return {
    name: options.name ?? "llm_judge",
    async score({ evalCase, output, expected, snapshot }) {
      const { generateText } = await import("ai")
      const transcript = snapshot.parts
        .filter((part) => part?.type === "message")
        .map((part) => extractText(part))
        .filter(Boolean)
        .join("\n")

      const result = await generateText({
        model: options.model ?? "openai/gpt-5.4-nano",
        system:
          "You are a strict evaluator of AI agent behavior. Respond with ONLY a minified JSON " +
          'object: {"score": <0..1>, "reason": "<short>"} — no prose, no code fences.',
        prompt: [
          `Criteria: ${options.criteria}`,
          evalCase.text ? `User input: ${evalCase.text}` : "",
          expected !== undefined ? `Expected: ${short(expected)}` : "",
          `Agent output: ${short(output)}`,
          transcript ? `Agent messages:\n${transcript}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      })

      const parsed = parseJudge(result.text)
      return { score: parsed.score, reason: parsed.reason }
    },
  }
}

function parseJudge(text: string): { score: number; reason?: string } {
  try {
    const trimmed = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
    const value = JSON.parse(trimmed)
    const score = Number(value?.score)
    return {
      score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0,
      reason: typeof value?.reason === "string" ? value.reason : undefined,
    }
  } catch {
    return { score: 0, reason: `unparseable judge response: ${text.slice(0, 200)}` }
  }
}

function extractText(part: Record<string, any>): string {
  const content = part?.content
  if (typeof content?.text === "string") return content.text
  const blocks = Array.isArray(content?.blocks) ? content.blocks : []
  return blocks
    .filter((block: any) => block?.type === "text" && typeof block.text === "string")
    .map((block: any) => block.text)
    .join("\n")
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return false
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const leftKeys = Object.keys(left as object)
  const rightKeys = Object.keys(right as object)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) =>
    deepEqual(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
    ),
  )
}

function short(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return text.length > 300 ? `${text.slice(0, 300)}…` : text
  } catch {
    return String(value)
  }
}
