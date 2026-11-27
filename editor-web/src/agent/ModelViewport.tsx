import { Box, Focus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ViewGizmo } from "@/components/ViewGizmo";
import { SceneView } from "@/scene/scene-view";

import { artifactHref, describeError } from "./api";
import type { ModelVersion } from "./contracts";
import { previewFromStl } from "./model-preview";

export function ModelViewport({ model }: { model: ModelVersion }) {
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<SceneView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const { version_id, name, files: { stl } } = model;
  useEffect(() => {
    if (!host.current) return;
    const ctl = new AbortController();
    const element = host.current;
    let view: SceneView | undefined;
    let frame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      // Let the editor update the camera aspect before fitting the model.
      frame = requestAnimationFrame(() => view?.frame());
    });
    setLoading(true);
    setError("");
    setScene(null);

    function disposeView() {
      resize.disconnect();
      cancelAnimationFrame(frame);
      view?.rig.cancelAnimation();
      view?.dispose();
      view = undefined;
      element.replaceChildren();
    }

    async function load() {
      try {
        const url = artifactHref(stl);
        if (!url) throw new Error("模型预览地址无效");
        const response = await fetch(url, { signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(30000)]) });
        if (!response.ok) throw new Error("STL 文件加载失败（HTTP " + response.status + "）");
        const buffer = await response.arrayBuffer();
        if (ctl.signal.aborted) return;
        const preview = previewFromStl(buffer, version_id, name);
        view = new SceneView(element, { interactive: false, theme: "dark", ssao: false, background: "#101925" });
        await view.engine.ready;
        if (ctl.signal.aborted) return;
        view.loadPreview(preview);
        view.frame();
        resize.observe(element);
        setScene(view);
      } catch (error) {
        if (!ctl.signal.aborted) {
          disposeView();
          setError(describeError(error));
        }
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => {
      ctl.abort();
      disposeView();
    };
  }, [version_id, name, stl, retry]);

  return (
    <div className="agent-viewport" aria-label={"模型预览 " + name}>
      <div className="agent-canvas" ref={host} data-model-ready={Boolean(scene)} />
      {scene && <>
        <ViewGizmo view={scene} sketching={false} />
        <div className="agent-view-tools">
          <button className="agent-btn" type="button" onClick={() => scene.frame()}><Focus size={15} /> 重置相机</button>
          <span>拖动旋转 · 滚轮缩放 · Shift + 拖动平移</span>
        </div>
      </>}
      {(loading || error) && (
        <div className="agent-empty agent-viewport-overlay" role={error ? "alert" : "status"}>
          <Box size={24} />
          <p>{error || "读取 STL 并准备预览…"}</p>
          {error && <button className="agent-btn" type="button" onClick={() => setRetry((n) => n + 1)}><RotateCcw size={14} /> 重试预览</button>}
        </div>
      )}
    </div>
  );
}
