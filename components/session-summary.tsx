"use client";

import { AlertTriangle, Bot, Clock3, Gauge, MessageSquareText, Wrench } from "lucide-react";

export type SessionSummaryMetrics = {
  durationMs: number | null;
  messageCount: number;
  toolCallCount: number;
  errorCount: number;
  model: string | null;
  totalTokens: number | null;
  tokenCoverage?: "recorded" | "not-recorded";
};

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function formatDuration(value: number | null) {
  if (value == null) return "Not recorded";
  if (value < 60_000) return `${Math.max(1, Math.round(value / 1_000))}s`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)}m`;
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.round((value % 3_600_000) / 60_000);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function SessionSummary({ metrics, loading = false }: { metrics: SessionSummaryMetrics | null; loading?: boolean }) {
  const values = [
    { label: "Model", value: metrics?.model || "Not recorded", icon: Bot },
    { label: "Observed duration", value: formatDuration(metrics?.durationMs ?? null), icon: Clock3 },
    { label: "Messages", value: metrics ? compact.format(metrics.messageCount) : "—", icon: MessageSquareText },
    { label: "Tool calls", value: metrics ? compact.format(metrics.toolCallCount) : "—", icon: Wrench },
    { label: "Errors", value: metrics ? compact.format(metrics.errorCount) : "—", icon: AlertTriangle, warning: Boolean(metrics?.errorCount) },
    { label: "Tokens", value: metrics?.tokenCoverage === "recorded" && metrics.totalTokens != null ? compact.format(metrics.totalTokens) : "Not recorded", icon: Gauge },
  ];

  return (
    <section className={`session-summary ${loading ? "is-loading" : ""}`} aria-label="Session summary" aria-busy={loading}>
      {values.map(({ label, value, icon: Icon, warning }) => (
        <div className={warning ? "session-summary-item is-warning" : "session-summary-item"} key={label}>
          <Icon size={14} aria-hidden="true" />
          <span><small>{label}</small><strong title={value}>{loading ? "Loading…" : value}</strong></span>
        </div>
      ))}
    </section>
  );
}
