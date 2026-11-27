export const SCHEMA_VERSION = "2.0";

export const stageLabels = {
  queued: "等待执行",
  understanding: "理解需求",
  clarifying: "等待补充",
  planning: "生成计划",
  executing: "执行建模",
  inspecting: "检查几何",
  repairing: "自动修复",
  exporting: "导出模型",
  completed: "建模完成",
  failed: "建模失败",
  cancelling: "正在取消",
  cancelled: "已取消",
} as const;

export type TaskStatus = keyof typeof stageLabels;
export function isTerminal(status: TaskStatus): boolean {
  return status === "clarifying" || status === "completed" || status === "failed" || status === "cancelled";
}

export interface RuntimeModes {
  ai: "mock" | "real";
  cad: "mock" | "real";
}

export interface AgentConfig {
  mode: RuntimeModes;
  llm_model: string | null;
  features: { task_cancellation: boolean; version_comparison: boolean; source_download: boolean };
}

export interface ErrorInfo {
  code: string;
  message: string;
  recoverable: boolean;
  details: Record<string, unknown>;
}

export interface AgentRequest {
  schema_version: typeof SCHEMA_VERSION;
  client_request_id: string;
  message: string;
  base_version_id: string | null;
}

export interface TaskAccepted {
  session_id: string;
  task_id: string;
  message_id: string;
  status: "queued";
}

type Scalar = string | number | boolean | null;

export interface Question {
  question_id: string;
  field: string;
  question: string;
  expected_type: "number" | "integer" | "string" | "boolean";
  unit: string | null;
  suggested_value: Scalar;
  required: boolean;
}

export interface RequirementState {
  part_name: string;
  unit: "mm";
  parameters: Record<string, {
    value: Scalar;
    unit: string | null;
    source: "user" | "derived" | "suggested" | "default";
    confirmed: boolean;
    required: boolean;
  }>;
  features: { feature_id: string; feature_type: string; description: string }[];
  constraints: { constraint_id: string; constraint_type: string; feature_refs: string[]; arguments: Record<string, unknown>; required: boolean }[];
  missing_fields: string[];
  conflicts: { fields: string[]; message: string }[];
}

export interface Measurement {
  check_id: string;
  name: string;
  measurement_type: string;
  feature_ref: string | null;
  expected: number | boolean;
  actual: number | boolean | null;
  absolute_error: number | null;
  tolerance: number;
  unit: string | null;
  required: boolean;
  status: "passed" | "failed" | "not_verified";
  method: string | null;
  message: string | null;
}

export interface Inspection {
  valid: boolean;
  passed: boolean;
  solid_count: number;
  volume_mm3: number | null;
  measurements: Measurement[];
  violations: { code: string; check_id: string | null; feature_ref: string | null; message: string }[];
  duration_ms: number;
}

export interface ExecutionStats {
  attempt_count: number;
  repair_count: number;
  tool_call_count: number;
  llm_call_count: number;
  llm_retry_count: number;
  elapsed_ms: number;
  llm_duration_ms: number;
  cad_duration_ms: number;
  inspection_duration_ms: number;
  export_duration_ms: number;
}

export type ArtifactURLs = Record<"step" | "stl" | "source" | "log" | "inspection" | "plan", string>;

export interface VersionSummary {
  version_id: string;
  version_number: number;
  parent_version_id: string | null;
  name: string;
  created_at: string;
}

export interface ModelVersion extends VersionSummary {
  session_id: string;
  task_id: string;
  unit: "mm";
  mode: RuntimeModes;
  requirements: RequirementState;
  inspection: Inspection;
  files: ArtifactURLs;
  execution: ExecutionStats;
}

export interface AgentTask {
  session_id: string;
  task_id: string;
  status: TaskStatus;
  message: string;
  mode: RuntimeModes;
  current_version_id: string | null;
  clarification: { questions: Question[] } | null;
  model: ModelVersion | null;
  inspection: Inspection | null;
  execution: ExecutionStats;
  error: ErrorInfo | null;
  created_at: string;
  updated_at: string;
}

export interface SessionSummary {
  session_id: string;
  title: string;
  status: "idle" | "busy" | "awaiting_input";
  current_version_id: string | null;
  active_task_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Session extends SessionSummary {
  confirmed_requirements: RequirementState | null;
  pending_requirements: RequirementState | null;
  pending_questions: Question[];
}

export interface ChatMessage {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  task_id: string | null;
  created_at: string;
}

export interface ExecutionEvent {
  event_id: number;
  timestamp: string;
  stage: TaskStatus;
  event_type: string;
  level: "debug" | "info" | "warning" | "error";
  message: string;
  attempt_index: number | null;
  payload: Record<string, unknown>;
}
