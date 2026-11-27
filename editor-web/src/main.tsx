import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { lazy, Suspense } from "react";
import { App } from "./App";
import "./index.css";
import "./i18n";
import { installScrollRows } from "./lib/scroll-row";

installScrollRows();

const AgentWorkspace = lazy(() => import("./agent/AgentWorkspace").then((module) => ({ default: module.AgentWorkspace })));
const agent = new URLSearchParams(window.location.search).get("workspace") === "agent";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {agent ? <Suspense fallback={null}><AgentWorkspace /></Suspense> : <App />}
  </StrictMode>,
);
