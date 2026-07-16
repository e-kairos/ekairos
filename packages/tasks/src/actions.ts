import {
  TaskService,
  type ServiceResult,
  type TaskAwaitOutcomeActionInput,
  type TaskCancelActionInput,
  type TaskDecideActionInput,
  type TaskFailActionInput,
  type TaskGetActionInput,
  type TaskOpenActionInput,
  type TaskRecord,
  type TaskStartActionInput,
  type TasksRuntime,
} from "./service.js"

export async function openTaskExecute({
  domain,
  input,
}: {
  domain: TasksRuntime
  input: TaskOpenActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(domain).openRaw(input)
}

export async function decideTaskExecute({
  domain,
  input,
}: {
  domain: TasksRuntime
  input: TaskDecideActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(domain).decide(input)
}

export async function cancelTaskExecute({
  domain,
  input,
}: {
  domain: TasksRuntime
  input: TaskCancelActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(domain).cancel(input)
}

export async function failTaskExecute({
  domain,
  input,
}: {
  domain: TasksRuntime
  input: TaskFailActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(domain).fail(input)
}

export async function startTaskExecute({
  domain,
  input,
}: {
  domain: TasksRuntime
  input: TaskStartActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(domain).start(input)
}

export async function getTaskExecute({
  domain,
  input,
}: {
  domain: TasksRuntime
  input: TaskGetActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(domain).getRaw(input)
}

export async function awaitOutcomeExecute({
  domain,
  input,
}: {
  domain: TasksRuntime
  input: TaskAwaitOutcomeActionInput
}): Promise<ServiceResult<unknown>> {
  return await new TaskService(domain).awaitOutcome(input)
}
