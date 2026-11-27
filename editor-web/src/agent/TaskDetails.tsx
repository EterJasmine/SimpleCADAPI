import { ClipboardCheck, ListChecks, Terminal } from "lucide-react";
import { useState } from "react";

import { stageLabels, type AgentTask, type ExecutionEvent, type Inspection, type ModelVersion, type VersionSummary } from "./contracts";
import { isMock } from "./ModelPanel";

const resultLabels = { passed: "通过", failed: "未通过", not_verified: "未验证" };
const levelLabels = { debug: "调试", info: "信息", warning: "警告", error: "错误" };

function value(value: number | boolean | string | null, unit?: string | null) {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value) + (unit ? " " + unit : "");
}

function InspectionReport({ report }: { report: Inspection }) {
  return <>
    <div className="agent-facts">
      <div><span>验收</span><strong className={report.passed ? "agent-pass" : "agent-fail"}>{report.passed ? "通过" : "未通过"}</strong></div>
      <div><span>几何有效性</span><strong>{report.valid ? "有效" : "无效"}</strong></div>
      <div><span>实体数</span><strong>{report.solid_count}</strong></div>
      <div><span>体积</span><strong>{value(report.volume_mm3, "mm³")}</strong></div>
    </div>
    {report.measurements.map((entry) => (
      <article className="agent-check" key={entry.check_id}>
        <div className="agent-card-title">
          <strong>{entry.name}</strong>
          <span className={"agent-" + entry.status}>{resultLabels[entry.status]}</span>
        </div>
        <div className="agent-meta">{entry.required ? "必检" : "可选"}{entry.feature_ref && " · " + entry.feature_ref}</div>
        <dl>
          <div><dt>期望</dt><dd>{value(entry.expected, entry.unit)}</dd></div>
          <div><dt>实测</dt><dd>{value(entry.actual, entry.unit)}</dd></div>
          <div><dt>公差</dt><dd>{value(entry.tolerance, entry.unit)}</dd></div>
          <div><dt>绝对误差</dt><dd>{value(entry.absolute_error, entry.unit)}</dd></div>
        </dl>
        {entry.message && <p>{entry.message}</p>}
      </article>
    ))}
    {report.violations.map((entry, index) => <p className="agent-fail" key={index}>{entry.message} [{entry.code}]</p>)}
  </>;
}

const tabs = [
  { id: "inspection", label: "几何检查", Icon: ClipboardCheck },
  { id: "events", label: "执行日志", Icon: Terminal },
  { id: "versions", label: "版本历史", Icon: ListChecks },
] as const;

export function TaskDetails({ task, events, eventError, model, current, versions, onSelect, onRetry }: {
  task: AgentTask | null;
  events: ExecutionEvent[];
  eventError: string;
  model: ModelVersion | null;
  current: ModelVersion | null;
  versions: VersionSummary[];
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("inspection");
  const failedReport = task?.status === "failed" ? task.inspection : null;
  return (
    <section className="agent-panel agent-details" aria-label="建模详情">
      <div className="agent-detail-tabs" aria-label="建模详情面板">
        {tabs.map(({ id, label, Icon }) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}><Icon size={15} /> {label}</button>)}
      </div>
      <div className="agent-detail-body">
        {tab === "inspection" && <>
          {failedReport && <details className="agent-failed-report" open={!model}>
            <summary>最近失败任务的检查{task && isMock(task.mode) && " · 模拟"}</summary>
            <InspectionReport report={failedReport} />
          </details>}
          {model ? <>
            <p className="agent-meta">V{model.version_number} · {isMock(model.mode) ? "模拟检测" : "CAD 检测"}</p>
            <InspectionReport report={model.inspection} />
            {Object.entries(model.requirements.parameters).length > 0 && <details className="agent-params">
              <summary>模型参数</summary>
              <dl>{Object.entries(model.requirements.parameters).map(([key, entry]) =>
                <div key={key}><dt>{key}</dt><dd>{value(entry.value, entry.unit)}</dd></div>)}</dl>
            </details>}
          </> : !failedReport && <p className="agent-meta">等待可用的几何检测结果。</p>}
        </>}
        {tab === "events" && <>
          {task && <div className="agent-facts">
            <div><span>尝试 / 修复</span><strong>{task.execution.attempt_count} / {task.execution.repair_count}</strong></div>
            <div><span>总耗时</span><strong>{task.execution.elapsed_ms} ms</strong></div>
          </div>}
          {eventError && <div className="agent-alert" role="alert">{eventError}<button className="agent-btn" onClick={onRetry}>重新读取</button></div>}
          {!events.length && <p className="agent-meta">暂无执行事件。</p>}
          {events.map((event) => <article className="agent-event" key={event.event_id}>
            <div className="agent-card-title"><strong>{stageLabels[event.stage]}</strong><span>{levelLabels[event.level]}</span></div>
            <p>{event.message}</p>
            <time className="agent-meta" dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleTimeString("zh-CN")}</time>
          </article>)}
        </>}
        {tab === "versions" && <>
          {!versions.length && <p className="agent-meta">模型确认后会记录版本。</p>}
          {versions.map((version) => (
            <button className="agent-version" key={version.version_id} onClick={() => onSelect(version.version_id === current?.version_id ? "" : version.version_id)}>
              <span><strong>V{version.version_number} · {version.name}</strong><small>{new Date(version.created_at).toLocaleString("zh-CN")}</small></span>
              {version.version_id === current?.version_id && <span className="agent-chip">当前</span>}
            </button>
          ))}
        </>}
      </div>
    </section>
  );
}
