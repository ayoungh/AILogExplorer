"use client";

import { Circle, RefreshCw, WifiOff } from "lucide-react";

export type LiveStatusState = "connected" | "connecting" | "polling" | "disabled";

export function LiveStatus({ state, updatedAt }: { state: LiveStatusState; updatedAt?: string | null }) {
  const content = state === "connected"
    ? { label: updatedAt ? "Updated just now" : "Live updates on", icon: Circle }
    : state === "connecting"
      ? { label: "Connecting…", icon: RefreshCw }
      : state === "polling"
        ? { label: "Polling for updates", icon: RefreshCw }
        : { label: "Live updates off", icon: WifiOff };
  const Icon = content.icon;
  return <span className={`live-status live-status-${state}`} role="status"><Icon size={12} aria-hidden="true" />{content.label}</span>;
}
