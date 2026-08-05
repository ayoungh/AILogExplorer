"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, X } from "lucide-react";
import { useState } from "react";
import { eventContentQueryOptions } from "@/lib/client/api";
import type { EventContentPart, EventContentPreview, EventSummary } from "@/lib/types";

function downloadHref(eventId: string, part: EventContentPart) {
  return `/api/events/${encodeURIComponent(eventId)}?part=${part}&mode=download`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function ContentBlock({ eventId, label, part, preview, pending, error, onRetry }: {
  eventId: string;
  label: string;
  part: EventContentPart;
  preview?: EventContentPreview;
  pending: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (pending) return <div className="payload-state inspector-content-state">Loading {label.toLowerCase()}…</div>;
  if (error) return <div className="payload-state payload-error inspector-content-state">{error.message}<button type="button" onClick={onRetry}>Retry</button></div>;
  if (!preview) return null;
  return (
    <section className="json-section">
      <div className="json-label">
        <span>{label}{preview.truncated ? " · preview truncated" : ""}</span>
        <span className="json-actions">
          <button type="button" title={`Copy ${label}`} onClick={() => { void navigator.clipboard.writeText(preview.text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
          <a href={downloadHref(eventId, part)} download title={`Download complete ${label}`}><Download size={14} /></a>
        </span>
      </div>
      <pre>{preview.text}</pre>
    </section>
  );
}

export function EventInspector({ event, relatedEvent, source, tab, onTab, onClose, onRelated }: {
  event: EventSummary | null;
  relatedEvent?: EventSummary | null;
  source?: string;
  tab: "normalized" | "raw";
  onTab: (tab: "normalized" | "raw") => void;
  onClose: () => void;
  onRelated?: () => void;
}) {
  const eventId = event?.id || "";
  const inputQuery = useQuery({ ...eventContentQueryOptions(eventId, "input"), enabled: Boolean(event && tab === "normalized" && event.hasInput) });
  const outputQuery = useQuery({ ...eventContentQueryOptions(eventId, "output"), enabled: Boolean(event && tab === "normalized" && event.hasOutput) });
  const rawQuery = useQuery({ ...eventContentQueryOptions(eventId, "raw"), enabled: Boolean(event && tab === "raw") });

  return (
    <aside className="inspector-panel">
      <div className="inspector-title"><h2>Event details</h2><button className="drawer-close" type="button" aria-label="Close event details" onClick={onClose}><X size={18} /></button></div>
      <div className="view-tabs inspector-tabs">
        <button className={tab === "normalized" ? "active" : ""} type="button" onClick={() => onTab("normalized")}>Normalized</button>
        <button className={tab === "raw" ? "active" : ""} type="button" onClick={() => onTab("raw")}>Raw JSON</button>
      </div>
      {!event ? <div className="inspector-empty">Select an event to inspect its normalized fields and original source record.</div> : tab === "raw" ? (
        <div className="inspector-scroll"><ContentBlock eventId={event.id} label="Original record" part="raw" preview={rawQuery.data} pending={rawQuery.isPending} error={rawQuery.error} onRetry={() => void rawQuery.refetch()} /></div>
      ) : (
        <div className="inspector-scroll">
          <dl className="event-fields">
            <div><dt>Source</dt><dd>{source || "—"}</dd></div>
            <div><dt>Event type</dt><dd>{event.kind}</dd></div>
            <div><dt>Timestamp</dt><dd>{event.timestamp || "—"}</dd></div>
            <div><dt>Turn ID</dt><dd>{event.turnId || "—"}</dd></div>
            <div><dt>Call ID</dt><dd>{event.callId || "—"}</dd></div>
            <div><dt>Tool</dt><dd>{event.toolName || "—"}</dd></div>
            {relatedEvent ? <div><dt>Related</dt><dd><button className="relationship-link" type="button" onClick={onRelated}>{relatedEvent.kind.replaceAll("_", " ")}</button></dd></div> : null}
            <div><dt>Duration</dt><dd>{event.durationMs == null ? "—" : `${Math.round(event.durationMs)} ms`}</dd></div>
            <div><dt>Status</dt><dd>{event.status || "—"}</dd></div>
            <div><dt>Raw size</dt><dd>{formatBytes(event.rawBytes)}</dd></div>
          </dl>
          {event.text ? <section className="json-section"><div className="json-label"><span>Text</span></div><pre>{event.text}</pre></section> : null}
          {event.hasInput ? <ContentBlock eventId={event.id} label="Tool input" part="input" preview={inputQuery.data} pending={inputQuery.isPending} error={inputQuery.error} onRetry={() => void inputQuery.refetch()} /> : null}
          {event.hasOutput ? <ContentBlock eventId={event.id} label="Tool output" part="output" preview={outputQuery.data} pending={outputQuery.isPending} error={outputQuery.error} onRetry={() => void outputQuery.refetch()} /> : null}
        </div>
      )}
    </aside>
  );
}
