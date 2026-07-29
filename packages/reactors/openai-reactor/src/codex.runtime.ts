import type { ReactionEngineActions, ReactionEngineInput } from "@ekairos/reactor"
import { z } from "zod"

type JsonRecord = Record<string, unknown>

export type CodexDynamicTool = {
  name: string
  description: string
  inputSchema: unknown
}

export type CodexActionRequest = {
  requestId: string | number
  callId: string
  name: string
  input: unknown
}

export type CodexTurnState = {
  providerContextId: string
  turnId: string
  assistantText: string
  reasoningText: string
  diff: string
  usage: Record<string, unknown>
}

export type CodexTurnResult = CodexTurnState & {
  status: "completed" | "action_required"
  completedTurn?: Record<string, unknown>
  action?: CodexActionRequest
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function jsonSafe(value: unknown): unknown {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  )
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(jsonSafe(value)), null, 2)
}

export function buildCodexInstruction(input: ReactionEngineInput): string {
  const sections = input.messages.flatMap((message, index) => {
    const body = renderModelContent(message.content)
    if (index === 0) return [body]
    return ["", `<!-- ${message.role} -->`, body]
  })
  sections.push(
    "",
    "## Reaction runtime",
    "",
    stableJson({
      definition: input.reactionKey,
      sessionId: input.sessionId,
      reactionId: input.reactionId,
      triggerId: input.trigger.id,
    }),
  )
  if (input.output) {
    sections.push("", "Return only valid JSON matching the requested result shape.")
  }
  return sections.join("\n")
}

function renderModelContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return stableJson(content)
  return content.map(part => {
    const record = asRecord(part)
    if (record.type === "text") return asString(record.text)
    return stableJson(record)
  }).filter(Boolean).join("\n\n")
}

function actionInputSchema(action: ReactionEngineActions[string]): unknown {
  return z.toJSONSchema(action.input, { target: "draft-7" })
}

// La Responses API exige nombres de tool ^[a-zA-Z0-9_-]+$ (sin puntos).
// Espejo del toModelActionName de @ekairos/reactor (hoy no exportado);
// consolidar en un unico modulo cuando el reactor lo exponga.
const CODEX_TOOL_NAME = /^[a-zA-Z0-9_-]+$/
const CODEX_TOOL_NAME_MAX_LENGTH = 64

export function toCodexToolName(canonicalName: string): string {
  if (
    canonicalName.length <= CODEX_TOOL_NAME_MAX_LENGTH &&
    CODEX_TOOL_NAME.test(canonicalName)
  ) {
    return canonicalName
  }
  const suffix = `_${stableToolNameHash(canonicalName)}`
  const base = canonicalName
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "action"
  return `${base.slice(0, CODEX_TOOL_NAME_MAX_LENGTH - suffix.length)}${suffix}`
}

function stableToolNameHash(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(36)
}

export function resolveCodexCanonicalActionName(
  actions: ReactionEngineActions,
  wireName: string,
): string {
  if (actions[wireName]) return wireName
  for (const canonical of Object.keys(actions)) {
    if (toCodexToolName(canonical) === wireName) return canonical
  }
  return wireName
}

export function buildCodexDynamicTools(actions: ReactionEngineActions): CodexDynamicTool[] {
  return Object.entries(actions).map(([name, action]) => {
    const wireName = toCodexToolName(name)
    return {
      name: wireName,
      description: [
        action.description ?? `Run ${name}.`,
        wireName === name ? "" : `Canonical action: ${name}.`,
      ].filter(Boolean).join(" "),
      inputSchema: actionInputSchema(action),
    }
  })
}

export async function executeCodexAction(
  actions: ReactionEngineActions,
  request: CodexActionRequest,
  executionContext: Record<string, unknown>,
): Promise<{ success: boolean; output: unknown; errorText?: string }> {
  const action = actions[request.name]
  if (!action) {
    return {
      success: false,
      output: { error: `codex_dynamic_tool_not_found:${request.name}` },
      errorText: `codex_dynamic_tool_not_found:${request.name}`,
    }
  }

  try {
    const parsedInput = action.input.parse(request.input)
    const output = action.output.parse(
      await Reflect.apply(action.execute, action, [parsedInput, executionContext]),
    )
    return { success: true, output: jsonSafe(output) }
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    return { success: false, output: { error: errorText }, errorText }
  }
}

export function codexActionResponse(
  request: CodexActionRequest,
  result: { success: boolean; output: unknown; errorText?: string },
) {
  const text = result.success
    ? typeof result.output === "string"
      ? result.output
      : JSON.stringify(jsonSafe(result.output))
    : `Action failed: ${result.errorText ?? "unknown_error"}`
  return {
    id: request.requestId,
    result: {
      success: result.success,
      contentItems: [{ type: "inputText", text }],
    },
  }
}

export function codexSandboxBridgeScript(): string {
  return String.raw`
import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const port = Number(process.env.CODEX_BRIDGE_PORT || "4500");
const child = spawn("codex", ["app-server", "--enable", "apps"], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
const reader = createInterface({ input: child.stdout });
const pending = new Map();
const subscribers = new Set();
let initialized;
function asRecord(value) { return value && typeof value === "object" ? value : {}; }
function asString(value) { return typeof value === "string" ? value : value == null ? "" : String(value); }
function broadcast(payload) {
  const chunk = "data: " + JSON.stringify(payload) + "\n\n";
  for (const response of subscribers) {
    try { response.write(chunk); } catch { subscribers.delete(response); }
  }
}
function rpc(method, params = {}, timeoutMs = 60000) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("rpc_timeout:" + method)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
async function initialize() {
  if (!initialized) {
    initialized = (async () => {
      await rpc("initialize", { clientInfo: { name: "ekairos-codex-engine", version: "1.0.0" }, capabilities: { experimentalApi: true } });
      child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    })();
  }
  await initialized;
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
reader.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message?.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) {
      const error = asRecord(message.error);
      request.reject(new Error(asString(error.message) || asString(message.error) || "rpc_error"));
    } else request.resolve(message);
    return;
  }
  broadcast(message);
});
child.on("exit", (code) => {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error("codex_app_server_exited:" + asString(code)));
  }
  pending.clear();
  process.exit(1);
});
const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, initialized: Boolean(initialized) }));
    return;
  }
  if (request.method === "GET" && request.url === "/events") {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    response.write("data: " + JSON.stringify({ type: "ready" }) + "\n\n");
    subscribers.add(response);
    request.on("close", () => subscribers.delete(response));
    return;
  }
  if (request.method === "POST" && request.url === "/rpc") {
    try {
      const body = await readBody(request);
      await initialize();
      const payload = body ? JSON.parse(body) : {};
      const result = await rpc(asString(payload.method), asRecord(payload.params));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: asString(error?.message || error) }));
    }
    return;
  }
  if (request.method === "POST" && request.url === "/respond") {
    try {
      const body = await readBody(request);
      const payload = body ? JSON.parse(body) : {};
      if (payload.id === undefined || payload.id === null) throw new Error("response_id_required");
      child.stdin.write(JSON.stringify(payload) + "\n");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    } catch (error) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: asString(error?.message || error) }));
    }
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});
server.listen(port, "127.0.0.1", async () => { try { await initialize(); } catch {} });
`
}

export function codexSandboxTurnRunnerScript(): string {
  return String.raw`
import { readFileSync } from "node:fs";
const baseUrl = (process.env.CODEX_BRIDGE_URL || "http://127.0.0.1:4500").replace(/\/+$/, "");
const instruction = readFileSync(process.env.CODEX_INSTRUCTION_FILE, "utf8");
const dynamicTools = JSON.parse(readFileSync(process.env.CODEX_TOOLS_FILE, "utf8"));
const state = process.env.CODEX_STATE_FILE ? JSON.parse(readFileSync(process.env.CODEX_STATE_FILE, "utf8")) : {};
const actionResponse = process.env.CODEX_ACTION_RESPONSE_FILE ? JSON.parse(readFileSync(process.env.CODEX_ACTION_RESPONSE_FILE, "utf8")) : null;
const repoPath = process.env.CODEX_REPO_PATH || process.cwd();
const model = process.env.CODEX_MODEL || "";
function asRecord(value) { return value && typeof value === "object" ? value : {}; }
function asString(value) { return typeof value === "string" ? value : value == null ? "" : String(value); }
function emit(payload) { process.stdout.write("EKAIROS_CODEX_RESULT\t" + JSON.stringify(payload) + "\n"); }
async function post(path, payload) {
  const response = await fetch(baseUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) throw new Error(asString(body.error) || "request_failed:" + path);
  return body;
}
function parseSse(block) {
  const lines = block.split("\n").filter((line) => line.startsWith("data:"));
  return lines.length ? lines.map((line) => line.replace(/^data:\s*/, "")).join("\n") : null;
}
function actionDetails(params) {
  const item = asRecord(params.item);
  const rawInput = params.arguments ?? params.input ?? params.args ?? item.arguments ?? item.input ?? item.args ?? {};
  let input = rawInput;
  if (typeof rawInput === "string") { try { input = JSON.parse(rawInput); } catch {} }
  return {
    callId: asString(params.callId ?? params.toolCallId ?? params.itemId ?? item.callId ?? item.toolCallId ?? item.id),
    name: asString(params.actionName ?? params.tool ?? params.toolName ?? params.name ?? item.actionName ?? item.tool ?? item.toolName ?? item.name),
    input,
  };
}
const eventsResponse = await fetch(baseUrl + "/events", { headers: { accept: "text/event-stream" } });
if (!eventsResponse.ok || !eventsResponse.body) throw new Error("codex_events_unavailable:" + eventsResponse.status);
let threadId = asString(state.providerContextId);
let turnId = asString(state.turnId);
let assistantText = asString(state.assistantText);
let reasoningText = asString(state.reasoningText);
let diff = asString(state.diff);
let usage = asRecord(state.usage);
let completedTurn = {};
if (actionResponse) {
  await post("/respond", actionResponse);
} else {
  const threadParams = { cwd: repoPath, approvalPolicy: "never", sandboxPolicy: { type: "externalSandbox", networkAccess: "enabled" } };
  if (model) threadParams.model = model;
  if (dynamicTools.length) {
    threadParams.dynamicTools = dynamicTools;
    threadParams.dynamic_tools = dynamicTools;
    threadParams.experimentalRawEvents = true;
    threadParams.persistExtendedHistory = true;
  }
  const threadStart = await post("/rpc", { method: "thread/start", params: threadParams });
  threadId = asString(asRecord(asRecord(threadStart.result).thread).id) || asString(asRecord(threadStart.result).id) || asString(threadStart.threadId);
  if (!threadId) throw new Error("codex_thread_id_missing");
  const turnParams = { threadId, input: [{ type: "text", text: instruction }], cwd: repoPath, approvalPolicy: "never", sandboxPolicy: { type: "externalSandbox", networkAccess: "enabled" } };
  if (model) turnParams.model = model;
  if (dynamicTools.length) { turnParams.dynamicTools = dynamicTools; turnParams.dynamic_tools = dynamicTools; }
  const turnStart = await post("/rpc", { method: "turn/start", params: turnParams });
  turnId = asString(asRecord(asRecord(turnStart.result).turn).id) || asString(asRecord(turnStart.result).id) || asString(turnStart.turnId);
}
const reader = eventsResponse.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let done = false;
while (!done) {
  const read = await reader.read();
  if (read.done) break;
  buffer += decoder.decode(read.value, { stream: true });
  const blocks = buffer.split("\n\n");
  buffer = blocks.pop() || "";
  for (const block of blocks) {
    const data = parseSse(block);
    if (!data || data === "[DONE]") continue;
    const event = JSON.parse(data);
    const method = asString(event.method);
    if (!method || method.startsWith("codex/event/")) continue;
    const params = asRecord(event.params);
    const eventTurnId = asString(params.turnId) || asString(asRecord(params.turn).id);
    const eventThreadId = asString(params.threadId) || asString(asRecord(params.turn).threadId);
    const scoped = (eventTurnId && turnId && eventTurnId === turnId) || (eventThreadId && eventThreadId === threadId) || method.startsWith("thread/") || method.startsWith("context/");
    if (!scoped) continue;
    if (method === "item/tool/call" && event.id !== undefined && event.id !== null) {
      const action = actionDetails(params);
      await reader.cancel().catch(() => {});
      emit({ status: "action_required", providerContextId: threadId, turnId, assistantText, reasoningText, diff, usage, action: { requestId: event.id, ...action } });
      process.exit(0);
    }
    if (method === "turn/started" && !turnId) turnId = eventTurnId;
    if (method === "item/agentMessage/delta") assistantText += asString(params.delta);
    if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") reasoningText += asString(params.delta);
    if (method === "turn/diff/updated") diff = asString(params.diff);
    if (method === "thread/tokenUsage/updated" || method === "context/tokenUsage/updated") usage = asRecord(params.tokenUsage);
    if (method === "item/completed") {
      const item = asRecord(params.item);
      if (asString(item.type) === "agentMessage" && asString(item.text).trim()) assistantText = asString(item.text);
      if (asString(item.type) === "reasoning" && asString(item.summary).trim()) reasoningText = asString(item.summary);
    }
    if (method === "turn/failed") throw new Error("codex_turn_failed:" + (eventTurnId || turnId || "unknown"));
    if (method === "turn/completed") {
      completedTurn = asRecord(params.turn);
      const status = asString(completedTurn.status).toLowerCase();
      const error = asRecord(completedTurn.error);
      if (status === "failed" || Object.keys(error).length) throw new Error(asString(error.message) || asString(error.error) || "codex_turn_failed:" + (eventTurnId || turnId || "unknown"));
      done = true;
      break;
    }
  }
}
await reader.cancel().catch(() => {});
if (!done) throw new Error("codex_turn_completion_missing:" + (turnId || "unknown"));
emit({ status: "completed", providerContextId: threadId, turnId: asString(completedTurn.id) || turnId, assistantText, reasoningText, diff, usage, completedTurn });
`
}
