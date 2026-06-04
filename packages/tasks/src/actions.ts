import {
  TaskService,
  type ServiceResult,
  type TaskAwaitOutcomeActionInput,
  type TaskCancelActionInput,
  type TaskDecideActionInput,
  type TaskFailActionInput,
  type TaskGetActionInput,
  type TaskOpenActionInput,
  type TaskReleaseActionInput,
  type TaskRecord,
  type TaskStartActionInput,
  type TasksRuntime,
} from "./service.js"

export async function openTaskExecute({
  runtime,
  input,
}: {
  runtime: TasksRuntime
  input: TaskOpenActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(runtime).openRaw(input)
}

export async function decideTaskExecute({
  runtime,
  input,
}: {
  runtime: TasksRuntime
  input: TaskDecideActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(runtime).decide(input)
}

export async function cancelTaskExecute({
  runtime,
  input,
}: {
  runtime: TasksRuntime
  input: TaskCancelActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(runtime).cancel(input)
}

export async function failTaskExecute({
  runtime,
  input,
}: {
  runtime: TasksRuntime
  input: TaskFailActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(runtime).fail(input)
}

export async function startTaskExecute({
  runtime,
  input,
}: {
  runtime: TasksRuntime
  input: TaskStartActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(runtime).start(input)
}

export async function releaseTaskExecute({
  runtime,
  input,
}: {
  runtime: TasksRuntime
  input: TaskReleaseActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(runtime).release(input)
}

export async function getTaskExecute({
  runtime,
  input,
}: {
  runtime: TasksRuntime
  input: TaskGetActionInput
}): Promise<ServiceResult<TaskRecord>> {
  return await new TaskService(runtime).getRaw(input)
}

export async function awaitOutcomeExecute({
  runtime,
  input,
}: {
  runtime: TasksRuntime
  input: TaskAwaitOutcomeActionInput
}): Promise<ServiceResult<unknown>> {
  return await new TaskService(runtime).awaitOutcome(input)
}
