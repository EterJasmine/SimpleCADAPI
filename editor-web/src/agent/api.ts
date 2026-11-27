import {
  SCHEMA_VERSION,
  stageLabels,
  type AgentConfig, type AgentRequest, type AgentTask, type ChatMessage,
  type ErrorInfo, type ExecutionEvent, type ModelVersion, type Session,
  type SessionSummary, type TaskAccepted, type VersionSummary,
} from "./contracts";

const base = "/api/v1/agent";
type Guard = (value: unknown) => boolean;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const fields = (shape: Record<string, Guard>): Guard => (value) =>
  record(value) && Object.entries(shape).every(([key, test]) => test(value[key]));
const string: Guard = (value) => typeof value === "string";
const number: Guard = (value) => typeof value === "number" && Number.isFinite(value);
const count: Guard = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const boolean: Guard = (value) => typeof value === "boolean";
const oneOf = (...options: string[]): Guard => (value) => typeof value === "string" && options.includes(value);
const nullable = (test: Guard): Guard => (value) => value === null || test(value);
const array = (test: Guard): Guard => (value) => Array.isArray(value) && value.every(test);
const schema_version = oneOf(SCHEMA_VERSION);
const status = oneOf(...Object.keys(stageLabels));
const mode = fields({ ai: oneOf("mock", "real"), cad: oneOf("mock", "real") });
const scalar: Guard = nullable((value) => number(value) || boolean(value) || string(value));
const expected: Guard = (value) => number(value) || boolean(value);
const errorInfo = fields({ code: string, message: string, recoverable: boolean, details: record });
const question = fields({
  question_id: string, field: string, question: string, expected_type: oneOf("number", "integer", "string", "boolean"),
  unit: nullable(string), suggested_value: scalar, required: boolean,
});
const parameter = fields({
  value: scalar, unit: nullable(string), source: oneOf("user", "derived", "suggested", "default"),
  confirmed: boolean, required: boolean,
});
const requirements = fields({
  part_name: string, unit: oneOf("mm"), parameters: (value) => record(value) && Object.values(value).every(parameter),
  features: array(fields({ feature_id: string, feature_type: string, description: string })),
  constraints: array(fields({
    constraint_id: string, constraint_type: string, feature_refs: array(string), arguments: record, required: boolean,
  })),
  missing_fields: array(string), conflicts: array(fields({ fields: array(string), message: string })),
});
const inspection = fields({
  valid: boolean, passed: boolean, solid_count: count, volume_mm3: nullable(number), duration_ms: number,
  measurements: array(fields({
    check_id: string, name: string, measurement_type: string, feature_ref: nullable(string),
    expected, actual: nullable(expected), absolute_error: nullable(number), tolerance: number, unit: nullable(string),
    required: boolean, status: oneOf("passed", "failed", "not_verified"), method: nullable(string), message: nullable(string),
  })),
  violations: array(fields({ code: string, check_id: nullable(string), feature_ref: nullable(string), message: string })),
});
const execution = fields({
  attempt_count: count, repair_count: count, tool_call_count: count, llm_call_count: count, llm_retry_count: count,
  elapsed_ms: number, llm_duration_ms: number, cad_duration_ms: number, inspection_duration_ms: number, export_duration_ms: number,
});
const versionSummary = {
  version_id: string, version_number: count, parent_version_id: nullable(string), name: string, created_at: string,
};
const version = fields({
  ...versionSummary, session_id: string, task_id: string, unit: oneOf("mm"), mode, requirements, inspection, execution,
  files: fields({ step: string, stl: string, source: string, log: string, inspection: string, plan: string }),
});
const task = fields({
  schema_version, session_id: string, task_id: string, status, message: string, mode, current_version_id: nullable(string),
  clarification: nullable(fields({ questions: array(question) })), model: nullable(version), inspection: nullable(inspection),
  execution, error: nullable(errorInfo), created_at: string, updated_at: string,
});
const sessionSummary = {
  session_id: string, title: string, status: oneOf("idle", "busy", "awaiting_input"),
  current_version_id: nullable(string), active_task_id: nullable(string), created_at: string, updated_at: string,
};
const chat = fields({
  message_id: string, role: oneOf("user", "assistant"), content: string, task_id: nullable(string), created_at: string,
});
const event = fields({
  event_id: count, timestamp: string, stage: status, event_type: string,
  level: oneOf("debug", "info", "warning", "error"), message: string, attempt_index: nullable(count), payload: record,
});

export class AgentApiError extends Error {
  readonly info: ErrorInfo;
  readonly statusCode: number;

  constructor(info: ErrorInfo, statusCode: number) {
    super(info.message);
    this.info = info;
    this.statusCode = statusCode;
  }
}

function apiError(code: string, message: string, statusCode = 0, recoverable = true) {
  return new AgentApiError({ code, message, recoverable, details: {} }, statusCode);
}

export function describeError(error: unknown): string {
  if (error instanceof AgentApiError) return error.message + " [" + error.info.code + "]";
  return error instanceof Error ? error.message : "发生未知错误";
}

async function request<T>(url: string, isResponse: Guard, signal: AbortSignal, data?: object | null): Promise<T> {
  let response: Response;
  try {
    response = await fetch(base + url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: "no-store",
      ...(data === null ? { method: "POST" } : data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw apiError("NETWORK_ERROR", "无法连接 Agent 服务，请检查服务和代理");
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (record(body) && errorInfo(body.error)) throw new AgentApiError(body.error as ErrorInfo, response.status);
    const message = response.status === 404 ? "未找到 Agent 接口或资源，请检查服务版本与地址" : "Agent 请求失败（HTTP " + response.status + "）";
    throw apiError("HTTP_ERROR", message, response.status, response.status >= 500);
  }
  if (!isResponse(body)) throw apiError("INVALID_RESPONSE", "Agent 响应与 2.0 接口协议不一致", response.status, false);
  return body as T;
}

async function list<T>(url: string, limit: number, item: Guard, signal: AbortSignal): Promise<T[]> {
  const guard = fields({ schema_version, items: array(item), total: count, offset: count, limit: count });
  const result: T[] = [];
  for (let offset = 0; ; ) {
    const page = await request<{ items: T[]; total: number; offset: number }>(
      url + "?limit=" + limit + "&offset=" + offset, guard, signal,
    );
    if (page.offset !== offset) throw apiError("INVALID_RESPONSE", "分页响应偏移量不匹配");
    result.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total || !page.items.length) return result;
  }
}

const sessionPath = (id: string) => "/sessions/" + encodeURIComponent(id);
const taskPath = (id: string) => "/tasks/" + encodeURIComponent(id);
export const agentApi = {
  config: (signal: AbortSignal) => request<AgentConfig>("/config", fields({
    schema_version, mode, llm_model: nullable(string),
    features: fields({ task_cancellation: boolean, version_comparison: boolean, source_download: boolean }),
  }), signal),
  sessions: (signal: AbortSignal) => list<SessionSummary>("/sessions", 20, fields(sessionSummary), signal),
  create: (title: string, signal: AbortSignal) => request<SessionSummary>(
    "/sessions", fields({ schema_version, ...sessionSummary }), signal, { schema_version: SCHEMA_VERSION, title },
  ),
  session: (id: string, signal: AbortSignal) => request<Session>(sessionPath(id), fields({
    schema_version, ...sessionSummary, confirmed_requirements: nullable(requirements),
    pending_requirements: nullable(requirements), pending_questions: array(question),
  }), signal),
  messages: (id: string, signal: AbortSignal) => list<ChatMessage>(sessionPath(id) + "/messages", 50, chat, signal),
  versions: (id: string, signal: AbortSignal) => list<VersionSummary>(sessionPath(id) + "/versions", 20, fields(versionSummary), signal),
  version: (id: string, signal: AbortSignal) => request<ModelVersion>("/versions/" + encodeURIComponent(id), version, signal),
  submit: (id: string, data: AgentRequest, signal: AbortSignal) => request<TaskAccepted>(
    sessionPath(id) + "/messages",
    fields({ schema_version, session_id: string, task_id: string, message_id: string, status: oneOf("queued") }), signal, data,
  ),
  task: (id: string, signal: AbortSignal) => request<AgentTask>(taskPath(id), task, signal),
  events: (id: string, after: number, signal: AbortSignal) =>
    request<{ task_id: string; items: ExecutionEvent[]; next_after_event_id: number; has_more: boolean }>(
      taskPath(id) + "/events?after_event_id=" + after + "&limit=100",
      fields({ schema_version, task_id: string, items: array(event), next_after_event_id: count, has_more: boolean }), signal,
    ),
  cancel: (id: string, signal: AbortSignal) => request<{ task_id: string; status: "cancelling" | "cancelled" }>(
    taskPath(id) + "/cancel", fields({ schema_version, task_id: string, status: oneOf("cancelling", "cancelled") }), signal, null,
  ),
};

export function artifactHref(url: string): string {
  if (!url.startsWith("/") || url.startsWith("//")) return "";
  const resolved = new URL(url, window.location.origin);
  if (resolved.origin !== window.location.origin || !resolved.pathname.startsWith(base + "/versions/")) return "";
  return resolved.pathname + resolved.search;
}
