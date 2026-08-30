"use client";

import { AlertTriangle, Bot, CalendarDays, Gauge, MessageSquareText, Wrench } from "lucide-react";

export type OverviewBreakdownItem = { label: string; value: number };
export type OverviewTopSession = { id: string; title: string; provider: string; projectPath: string | null; eventCount: number; updatedAt: string | null };
export type OverviewDashboardData = {
  totals: { sessions: number; events: number; toolCalls: number; errors: number; recordedTokens: number | null; tokenCoveragePercent: number };
  dailyActivity: Array<{ date: string; events: number; recordedTokens: number | null }>;
  providers: OverviewBreakdownItem[];
  projects: OverviewBreakdownItem[];
  models: OverviewBreakdownItem[];
  tools: OverviewBreakdownItem[];
  topSessions: OverviewTopSession[];
};
export type OverviewDashboardFilters = { provider: string; project: string; model: string };

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function Breakdown({ title, items }: { title: string; items: OverviewBreakdownItem[] }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return <section className="overview-card overview-breakdown"><h2>{title}</h2>{items.length ? <div>{items.slice(0, 7).map((item) => <div key={item.label}><span><strong title={item.label}>{item.label}</strong><small>{compact.format(item.value)}</small></span><i><b style={{ width: `${Math.max(3, item.value / max * 100)}%` }} /></i></div>)}</div> : <p className="overview-empty">No recorded data for this period.</p>}</section>;
}

export function OverviewDashboard({
  data,
  rangeDays,
  loading = false,
  onRangeChange,
  filters,
  filterOptions,
  onFiltersChange,
  onSessionSelect,
}: {
  data: OverviewDashboardData | null;
  rangeDays: 7 | 30 | 90;
  loading?: boolean;
  onRangeChange: (days: 7 | 30 | 90) => void;
  filters: OverviewDashboardFilters;
  filterOptions: { providers: string[]; projects: string[]; models: string[] };
  onFiltersChange: (filters: OverviewDashboardFilters) => void;
  onSessionSelect: (session: OverviewTopSession) => void;
}) {
  const totals = data?.totals;
  const maxDaily = Math.max(...(data?.dailyActivity.map((item) => item.events) || []), 1);
  return (
    <main className="overview-dashboard" aria-busy={loading}>
      <header className="overview-heading"><div><h1>Overview</h1><p>Activity and recorded usage across your local index.</p></div><div className="overview-filters"><label>Provider<select value={filters.provider} onChange={(event) => onFiltersChange({ ...filters, provider: event.target.value })}><option value="">All providers</option>{filterOptions.providers.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label>Project<select value={filters.project} onChange={(event) => onFiltersChange({ ...filters, project: event.target.value })}><option value="">All projects</option>{filterOptions.projects.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label>Model<select value={filters.model} onChange={(event) => onFiltersChange({ ...filters, model: event.target.value })}><option value="">All models</option>{filterOptions.models.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label>Period<select value={rangeDays} onChange={(event) => onRangeChange(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label></div></header>
      <section className="overview-totals" aria-label="Activity totals">
        <div><CalendarDays size={16} /><span><small>Sessions</small><strong>{totals ? compact.format(totals.sessions) : "—"}</strong></span></div>
        <div><MessageSquareText size={16} /><span><small>Events</small><strong>{totals ? compact.format(totals.events) : "—"}</strong></span></div>
        <div><Wrench size={16} /><span><small>Tool calls</small><strong>{totals ? compact.format(totals.toolCalls) : "—"}</strong></span></div>
        <div className={totals?.errors ? "is-warning" : ""}><AlertTriangle size={16} /><span><small>Errors</small><strong>{totals ? compact.format(totals.errors) : "—"}</strong></span></div>
        <div><Gauge size={16} /><span><small>Recorded tokens</small><strong>{totals?.recordedTokens != null ? compact.format(totals.recordedTokens) : "Not recorded"}</strong><em>{totals ? `${totals.tokenCoveragePercent}% coverage` : ""}</em></span></div>
      </section>
      <section className="overview-card overview-activity"><div><h2>Activity</h2><span>Events per day</span></div><div className="overview-chart" aria-label={`Daily event activity over ${rangeDays} days`}>{data?.dailyActivity.map((item) => <span key={item.date} title={`${item.date}: ${item.events.toLocaleString()} events`}><i style={{ height: `${Math.max(3, item.events / maxDaily * 100)}%` }} /><small>{item.date.slice(5)}</small></span>)}</div>{!data?.dailyActivity.length && <p className="overview-empty">No activity recorded in this period.</p>}</section>
      <div className="overview-grid"><Breakdown title="Providers" items={data?.providers || []} /><Breakdown title="Projects" items={data?.projects || []} /><Breakdown title="Models" items={data?.models || []} /><Breakdown title="Tool usage" items={data?.tools || []} /></div>
      <section className="overview-card overview-sessions"><h2>Top sessions</h2>{data?.topSessions.length ? <div role="list">{data.topSessions.map((session) => <button type="button" role="listitem" onClick={() => onSessionSelect(session)} key={session.id}><Bot size={16} /><span><strong>{session.title}</strong><small>{session.projectPath || session.provider}</small></span><b>{compact.format(session.eventCount)} events</b></button>)}</div> : <p className="overview-empty">No sessions recorded in this period.</p>}</section>
    </main>
  );
}
