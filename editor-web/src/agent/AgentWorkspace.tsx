import { ArrowLeft, ArrowUp, Box, CircleHelp, Folder, MessageSquare, Plus, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { agentApi, describeError } from "./api";
import { isTerminal, stageLabels, type AgentConfig, type ModelVersion, type SessionSummary } from "./contracts";
import { isMock, ModelPanel } from "./ModelPanel";
import { TaskDetails } from "./TaskDetails";
import { useSession } from "./use-session";
import "./workspace.css";

function editorHref() {
  const url = new URL(window.location.href);
  url.searchParams.delete("workspace");
  return url.pathname + url.search + url.hash;
}

function SessionWorkspace({ id, config, onChanged }: { id: string; config: AgentConfig | null; onChanged: () => void }) {
  const state = useSession(id, onChanged);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState("");
  const [displayed, setDisplayed] = useState<ModelVersion | null>(null);
  const [compare, setCompare] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const { data, task, busy, submitting, cancelling, loading } = state;
  const questions = !busy ? task?.clarification?.questions ?? data?.session.pending_questions ?? [] : [];
  const canCancel = busy && (!task || !isTerminal(task.status));
  const current = data?.version ?? null;
  const versions = data?.versions ?? [];
  const problem = state.actionError || state.pollError;
  const messageCount = data?.messages.length ?? 0;

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [messageCount, questions.length]);

  function select(id: string) {
    setSelected(id);
    if (!id) setCompare(false);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (message && await state.submit(message)) setDraft((value) => value.trim() === message ? "" : value);
  }

  return (
    <main className="agent-layout">
      <section className="agent-panel agent-chat" aria-label="建模对话">
        <div className="agent-panel-head">
          <h2><MessageSquare size={17} /> 建模对话</h2>
          <span className={"agent-chip " + (task && busy ? "agent-running" : "")} role="status">
            {loading ? "读取会话" : task ? stageLabels[task.status] : busy ? "等待执行" : "待命"}
          </span>
        </div>
        {(busy || task) && <div className="agent-task-line">
          <span>{task?.message ?? "正在读取任务状态…"}</span>
          {canCancel && config?.features.task_cancellation && <button className="agent-btn" onClick={() => void state.cancel()} disabled={cancelling}>
            <Square size={12} /> {cancelling ? "取消中" : "取消任务"}
          </button>}
        </div>}
        {problem && <div className="agent-alert" role="alert">
          <span>{problem}</span>
          {state.pollError ? <button className="agent-btn" onClick={state.retryPoll}>重连任务</button>
            : <button className="agent-btn" disabled={busy || submitting || loading} onClick={state.reload}>刷新会话</button>}
        </div>}
        {task?.error && <div className="agent-alert" role="alert">
          <span>{task.error.message} [{task.error.code}]</span>
          {current && <small>当前模型仍为 V{current.version_number}。</small>}
        </div>}
        <div className="agent-chat-history" aria-label="对话消息">
          {!messageCount && !loading && <div className="agent-chat-intro">
            <MessageSquare size={23} />
            <h3>描述要建模的零件</h3>
            <p>可说明尺寸、单位、孔位和空间关系。需要时，Agent 会请你补充参数。</p>
            {data && <button className="agent-example" onClick={() => setDraft("生成一个长 100 mm、宽 60 mm、厚 10 mm 的底板。")}>填入底板示例 <ArrowUp size={13} /></button>}
          </div>}
          {data?.messages.map((message) => (
            <article className={"agent-message " + message.role} key={message.message_id}>
              <span>{message.role === "user" ? "你" : "CAD Agent"}</span>
              <p>{message.content}</p>
            </article>
          ))}
          {questions.length > 0 && <section className="agent-clarification" aria-label="需要补充的参数">
            <h3><CircleHelp size={15} /> 需要补充的参数</h3>
            <ul>{questions.map((question) => (
              <li key={question.question_id}>
                {question.question}{question.required && <span> 必填</span>}
                {question.suggested_value !== null && <small>建议值 {typeof question.suggested_value === "boolean" ? (question.suggested_value ? "是" : "否") : question.suggested_value}{question.unit ? " " + question.unit : ""}</small>}
              </li>
            ))}</ul>
          </section>}
          <div ref={chatEnd} />
        </div>
        <form className="agent-composer" onSubmit={(event) => void send(event)}>
          <label htmlFor="agent-request">{questions.length ? "补充需求" : "建模需求"}</label>
          <textarea id="agent-request" value={draft} onChange={(event) => setDraft(event.target.value)}
            placeholder={questions.length ? "请输入补充参数…" : "输入建模需求或修改意见…"} rows={3} maxLength={4000}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }} />
          <div>
            <span>{current ? "修改基于当前 V" + current.version_number : "单位默认 mm"}</span>
            <button className="agent-btn agent-primary" type="submit" disabled={!draft.trim() || !data || busy || submitting || loading}>
              <ArrowUp size={15} /> {submitting ? "正在发送" : "发送需求"}
            </button>
          </div>
        </form>
      </section>
      <ModelPanel current={current} versions={versions} config={config} selected={selected} onSelect={select}
        compare={compare} onCompare={setCompare} setDisplayed={setDisplayed} />
      <TaskDetails task={task} events={state.events} eventError={state.eventError} model={displayed} current={current}
        versions={versions} onSelect={select} onRetry={state.retryPoll} />
    </main>
  );
}

export function AgentWorkspace() {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [id, setId] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [error, setError] = useState("");
  const [configError, setConfigError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState<string | null>(null);
  const scope = useRef<AbortController | null>(null);
  const listChanged = useCallback(() => setEpoch((value) => value + 1), []);

  useEffect(() => {
    const ctl = new AbortController();
    scope.current = ctl;
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    setError("");
    setConfigError("");
    void agentApi.config(ctl.signal).then((value) => {
      if (!ctl.signal.aborted) setConfig(value);
    }).catch((error: unknown) => {
      if (!ctl.signal.aborted) setConfigError(describeError(error));
    });
    void agentApi.sessions(ctl.signal).then((items) => {
      if (ctl.signal.aborted) return;
      setSessions(items);
      setId((current) => items.some((item) => item.session_id === current) ? current : items[0]?.session_id ?? "");
    }).catch((error: unknown) => {
      if (!ctl.signal.aborted) setError(describeError(error));
    });
    return () => ctl.abort();
  }, [epoch]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const signal = scope.current?.signal;
    if (!signal || !newTitle?.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      const session = await agentApi.create(newTitle.trim(), signal);
      if (signal.aborted) return;
      setSessions((items) => [session, ...items.filter((item) => item.session_id !== session.session_id)]);
      setId(session.session_id);
      setNewTitle(null);
      listChanged();
    } catch (error) {
      if (!signal.aborted) setError(describeError(error));
    } finally {
      if (!signal.aborted) setCreating(false);
    }
  }

  return (
    <div className="agent-shell">
      <header className="agent-header">
        <div className="agent-brand"><span><Box size={21} /></span><h1>CAD Agent</h1></div>
        <div className="agent-header-actions">
          <span className={"agent-mode" + (config && isMock(config.mode) ? " mock" : "")}>
            {config ? (isMock(config.mode) ? "模拟模式" : "真实模式") : "服务未就绪"}
          </span>
          {config && <span className="agent-modes">AI {config.mode.ai === "mock" ? "模拟" : "真实"} · CAD {config.mode.cad === "mock" ? "模拟" : "真实"}</span>}
          <a className="agent-btn" href={editorHref()}><ArrowLeft size={15} /> 返回编辑器</a>
        </div>
      </header>
      <div className="agent-sessionbar">
        <label htmlFor="agent-session"><Folder size={16} /> 建模会话</label>
        <select id="agent-session" value={id} disabled={!sessions.length} onChange={(event) => setId(event.target.value)}>
          {!sessions.length && <option value="">暂无会话</option>}
          {sessions.map((session) => <option key={session.session_id} value={session.session_id}>{session.title}</option>)}
        </select>
        <button type="button" className="agent-btn" onClick={() => setNewTitle("建模会话")}><Plus size={15} /> 新建会话</button>
        {newTitle !== null && <form className="agent-new-session" onSubmit={(event) => void create(event)}>
          <input aria-label="会话名称" value={newTitle} maxLength={100} autoFocus onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setNewTitle(event.target.value)} />
          <button type="submit" className="agent-btn agent-primary" disabled={creating || !newTitle.trim()}>{creating ? "创建中" : "创建"}</button>
          <button type="button" className="agent-btn" onClick={() => setNewTitle(null)} disabled={creating}>取消</button>
        </form>}
      </div>
      {(error || configError) && <div className="agent-alert agent-service-alert" role="alert">
        <span>{error || configError}</span>
        <button className="agent-btn" onClick={listChanged}><RotateCcw size={13} /> 重新连接</button>
      </div>}
      {id ? <SessionWorkspace key={id} id={id} config={config} onChanged={listChanged} /> : (
        <main className="agent-panel agent-landing agent-empty">
          <Box size={34} />
          <h2>开始一个建模会话</h2>
          <p>在这里描述需求、预览模型并检查结果。</p>
          <button type="button" className="agent-btn agent-primary" onClick={() => setNewTitle("建模会话")}><Plus size={15} /> 新建会话</button>
        </main>
      )}
    </div>
  );
}
