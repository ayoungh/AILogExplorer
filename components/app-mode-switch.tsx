"use client";

import { ChartNoAxesCombined, ListTree, Map } from "lucide-react";

export type AppMode = "logs" | "overview" | "data-map";

export function AppModeSwitch({ mode, onChange }: { mode: AppMode; onChange: (mode: AppMode) => void }) {
  return (
    <nav className="app-mode-switch" aria-label="Explorer view">
      <button type="button" className={mode === "logs" ? "active" : ""} onClick={() => onChange("logs")}><ListTree size={15} />Logs</button>
      <button type="button" className={mode === "overview" ? "active" : ""} onClick={() => onChange("overview")}><ChartNoAxesCombined size={15} />Overview</button>
      <button type="button" className={mode === "data-map" ? "active" : ""} onClick={() => onChange("data-map")}><Map size={15} />Data map</button>
    </nav>
  );
}
