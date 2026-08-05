"use client";

import { ListTree, Map } from "lucide-react";

export function AppModeSwitch({ mode, onChange }: { mode: "logs" | "data-map"; onChange: (mode: "logs" | "data-map") => void }) {
  return (
    <nav className="app-mode-switch" aria-label="Explorer view">
      <button type="button" className={mode === "logs" ? "active" : ""} onClick={() => onChange("logs")}><ListTree size={15} />Logs</button>
      <button type="button" className={mode === "data-map" ? "active" : ""} onClick={() => onChange("data-map")}><Map size={15} />Data map</button>
    </nav>
  );
}
