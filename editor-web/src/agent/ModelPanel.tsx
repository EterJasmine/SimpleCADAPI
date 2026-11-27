import { Box, Download, GitCompareArrows, Layers, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { agentApi, artifactHref, describeError } from "./api";
import type { AgentConfig, ArtifactURLs, ModelVersion, RuntimeModes, VersionSummary } from "./contracts";
import { ModelViewport } from "./ModelViewport";

export function isMock(mode: RuntimeModes): boolean {
  return mode.ai === "mock" || mode.cad === "mock";
}

const downloads: [keyof ArtifactURLs, string][] = [
  ["step", "STEP"], ["stl", "STL"], ["source", "参数化源码"], ["inspection", "检测 JSON"], ["plan", "建模计划"], ["log", "执行日志"],
];

export function ModelPanel({ current, versions, config, selected, onSelect, compare: comparison, onCompare, setDisplayed }: {
  current: ModelVersion | null;
  versions: VersionSummary[];
  config: AgentConfig | null;
  selected: string;
  onSelect: (id: string) => void;
  compare: boolean;
  onCompare: (value: boolean) => void;
  setDisplayed: (model: ModelVersion | null) => void;
}) {
  const [lookup, setLookup] = useState<{ id: string; model: ModelVersion | null; error: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const compare = comparison && config?.features.version_comparison !== false;
  const historical = versions.filter((version) => version.version_id !== current?.version_id);
  const picked = historical.some((version) => version.version_id === selected) ? selected : "";
  const target = picked || (compare && (current?.parent_version_id ?? historical[0]?.version_id)) || "";
  const queried = lookup?.id === target ? lookup : null;
  const displayed = compare || !target ? current : queried?.model ?? null;

  useEffect(() => {
    setDisplayed(displayed);
  }, [displayed, setDisplayed]);

  useEffect(() => {
    if (!target) return;
    const ctl = new AbortController();
    setLookup(null);
    void agentApi.version(target, ctl.signal).then((model) => {
      if (!ctl.signal.aborted) setLookup({ id: target, model, error: "" });
    }).catch((error: unknown) => {
      if (!ctl.signal.aborted) setLookup({ id: target, model: null, error: describeError(error) });
    });
    return () => ctl.abort();
  }, [target, retry]);

  function canvas(model: ModelVersion | null, label: string, archived: boolean) {
    return (
      <section className="agent-model-pane" key={label} aria-label={label}>
        {model ? <>
          <div className="agent-model-caption">
            <span><strong>V{model.version_number}</strong> {label}</span>
            <span>{isMock(model.mode) ? "模拟产物" : "真实产物"}</span>
          </div>
          <ModelViewport key={model.version_id} model={model} />
        </> : (
          <div className="agent-empty agent-model-placeholder" role={queried?.error ? "alert" : "status"}>
            <Box size={27} />
            {archived && target ? <p>{queried?.error || "正在读取历史版本…"}</p> : <>
              <p>当前没有可预览的模型</p>
              <small>任务完成后，模型会显示在此处。</small>
            </>}
            {archived && queried?.error && <button className="agent-btn" onClick={() => setRetry((n) => n + 1)}><RotateCcw size={14} /> 重试</button>}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="agent-panel agent-model">
      <div className="agent-panel-head">
        <h2><Box size={17} /> 三维预览</h2>
        <div className="agent-model-actions">
          {historical.length > 0 && <select aria-label="查看模型版本" value={target} onChange={(event) => {
            onSelect(event.target.value);
            if (!event.target.value) onCompare(false);
          }}>
            <option value="">当前版本</option>
            {historical.map((version) => <option key={version.version_id} value={version.version_id}>V{version.version_number} · {version.name}</option>)}
          </select>}
          {current && historical.length > 0 && config?.features.version_comparison !== false && (
            <button className="agent-btn" aria-pressed={compare} onClick={() => {
              if (compare) onSelect("");
              onCompare(!compare);
            }}><GitCompareArrows size={15} /> 版本对比</button>
          )}
        </div>
      </div>
      <div className={"agent-model-grid" + (compare && target ? " agent-compare" : "")}>
        {compare && target && canvas(queried?.model ?? null, "历史版本", true)}
        {canvas(displayed, target && !compare ? "历史版本" : "当前版本", Boolean(target) && !compare)}
      </div>
      {displayed && <div className="agent-downloads">
        <span><Layers size={15} /> {displayed.name}</span>
        <div>
          {downloads.filter(([format]) => format !== "source" || config?.features.source_download !== false).map(([format, label]) => {
            const url = artifactHref(displayed.files[format]);
            return url && <a className="agent-btn" href={url} download key={format}><Download size={13} /> {label}</a>;
          })}
        </div>
      </div>}
    </section>
  );
}
