import { useCallback, useEffect, useRef, useState } from "react";

import { AgentApiError, agentApi, describeError } from "./api";
import {
  isTerminal, SCHEMA_VERSION,
  type AgentRequest, type AgentTask, type ChatMessage, type ExecutionEvent,
  type ModelVersion, type Session, type VersionSummary,
} from "./contracts";

interface SessionData {
  session: Session;
  version: ModelVersion | null;
  versions: VersionSummary[];
  messages: ChatMessage[];
}

async function readSession(id: string, signal: AbortSignal): Promise<SessionData> {
  const session = await agentApi.session(id, signal);
  const [version, versions, messages] = await Promise.all([
    session.current_version_id ? agentApi.version(session.current_version_id, signal) : null,
    agentApi.versions(id, signal),
    agentApi.messages(id, signal),
  ]);
  return { session, version, versions, messages };
}

export function useSession(id: string, onChanged: () => void) {
  const scope = useRef<AbortController | null>(null);
  const pending = useRef<AgentRequest | null>(null);
  const [data, setData] = useState<SessionData | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<AgentTask | null>(null);
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [actionError, setActionError] = useState("");
  const [pollError, setPollError] = useState("");
  const [eventError, setEventError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [settlingTask, setSettlingTask] = useState<string | null>(null);
  const [pollRun, setPollRun] = useState(0);
  const sending = useRef(false);

  const refresh = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setActionError("");
    try {
      const snapshot = await readSession(id, signal);
      if (signal.aborted) return;
      setData(snapshot);
      const lastTaskId = snapshot.messages.reduce<string | null>((last, message) => message.task_id ?? last, null);
      setTaskId(snapshot.session.active_task_id ?? lastTaskId);
    } catch (error) {
      if (!signal.aborted) setActionError(describeError(error));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const ctl = new AbortController();
    scope.current = ctl;
    void refresh(ctl.signal);
    return () => ctl.abort();
  }, [refresh]);

  useEffect(() => {
    if (!taskId) return;
    const ctl = new AbortController();
    const { signal } = ctl;
    let timer: ReturnType<typeof setTimeout>;
    let cursor = 0;
    let failures = 0;

    async function readEvents(currentId: string) {
      let more: boolean;
      do {
        const page = await agentApi.events(currentId, cursor, signal);
        if (signal.aborted) return;
        if (page.task_id !== currentId || page.next_after_event_id < cursor
          || (page.has_more && page.next_after_event_id === cursor)) {
          throw new Error("执行日志分页响应不一致");
        }
        const additions = page.items.filter((event) => event.event_id > cursor);
        cursor = page.next_after_event_id;
        setEvents((previous) => [...previous, ...additions]);
        more = page.has_more;
      } while (more);
      setEventError("");
    }

    async function poll(currentId: string) {
      try {
        const result = await agentApi.task(currentId, signal);
        if (signal.aborted) return;
        if (result.session_id !== id || result.task_id !== currentId) throw new Error("任务响应与当前会话不匹配");
        failures = 0;
        setPollError("");
        const terminal = isTerminal(result.status);
        if (terminal) setSettlingTask(currentId);
        setTask(result);

        if (terminal) {
          setCancelling(false);
          setData((previous) => {
            if (!previous) return previous;
            const model = result.status === "completed" && result.model?.version_id === result.current_version_id
              ? result.model : null;
            return {
              ...previous,
              version: model ?? previous.version,
              session: {
                ...previous.session,
                current_version_id: result.current_version_id,
                active_task_id: null,
                pending_questions: result.clarification?.questions ?? [],
              },
            };
          });
          const reload = readSession(id, signal).then((snapshot) => {
            if (!signal.aborted) {
              setData(snapshot);
              onChanged();
            }
          }).catch((error: unknown) => {
            if (!signal.aborted) setActionError(describeError(error));
          }).finally(() => {
            if (!signal.aborted) setSettlingTask(null);
          });
          await Promise.all([reload, readEvents(currentId).catch((error: unknown) => {
            if (!signal.aborted) setEventError(describeError(error));
          })]);
          return;
        }
        await readEvents(currentId).catch((error: unknown) => {
          if (!signal.aborted) setEventError(describeError(error));
        });
        if (!signal.aborted) timer = setTimeout(() => void poll(currentId), 700);
      } catch (error) {
        if (signal.aborted) return;
        setPollError(describeError(error));
        if (error instanceof AgentApiError && (error.statusCode === 0 || error.statusCode >= 500)) {
          failures++;
          timer = setTimeout(() => void poll(currentId), Math.min(700 * 2 ** failures, 5000));
        }
      }
    }

    setEvents([]);
    setPollError("");
    setEventError("");
    void poll(taskId);
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, [id, onChanged, pollRun, taskId]);

  const activeTask = task?.task_id === taskId ? task : null;
  const busy = Boolean(taskId && (!activeTask || !isTerminal(activeTask.status) || settlingTask === taskId));

  async function submit(message: string): Promise<boolean> {
    const signal = scope.current?.signal;
    if (!signal || signal.aborted || !data || loading || busy || sending.current) return false;
    const base = data.session.current_version_id;
    const previous = pending.current;
    const request: AgentRequest = previous?.message === message && previous.base_version_id === base
      ? previous
      : { schema_version: SCHEMA_VERSION, client_request_id: crypto.randomUUID(), message, base_version_id: base };
    pending.current = request;
    sending.current = true;
    setSubmitting(true);
    setActionError("");
    try {
      const result = await agentApi.submit(id, request, signal);
      if (signal.aborted) return false;
      if (result.session_id !== id) throw new Error("提交响应与当前会话不匹配");
      pending.current = null;
      setData((previous) => previous && {
        ...previous,
        messages: previous.messages.some((item) => item.message_id === result.message_id)
          ? previous.messages
          : [...previous.messages, {
            message_id: result.message_id, role: "user", content: message, task_id: result.task_id,
            created_at: new Date().toISOString(),
          }],
      });
      setTaskId(result.task_id);
      onChanged();
      return true;
    } catch (error) {
      if (signal.aborted) return false;
      if (error instanceof AgentApiError && error.statusCode === 409) {
        pending.current = null;
        await refresh(signal);
      }
      if (!signal.aborted) setActionError(describeError(error));
      return false;
    } finally {
      sending.current = false;
      if (!signal.aborted) setSubmitting(false);
    }
  }

  async function cancel() {
    const signal = scope.current?.signal;
    if (!signal || !taskId || !busy || cancelling) return;
    setCancelling(true);
    setActionError("");
    try {
      await agentApi.cancel(taskId, signal);
    } catch (error) {
      if (!signal.aborted) {
        setCancelling(false);
        setActionError(describeError(error));
      }
    }
  }

  return {
    data, task: activeTask, events, busy, loading, submitting, cancelling, actionError, pollError, eventError,
    submit, cancel, retryPoll: () => setPollRun((n) => n + 1),
    reload: () => { if (scope.current) void refresh(scope.current.signal); },
  };
}
