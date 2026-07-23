"use client";

import { Check, Copy, X } from "lucide-react";
import { useState } from "react";
import type { NormalizedEvent } from "@/lib/types";

function valueText(value: unknown) {
  if (value == null) return "—";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  if (value == null) return null;
  const text = valueText(value);
  return (
    <section className="json-section">
      <div className="json-label"><span>{label}</span><button type="button" title={`Copy ${label}`} onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button></div>
      <pre>{text}</pre>
    </section>
  );
}

export function EventInspector({ event, relatedEvent, source, tab, onTab, onClose, onRelated }: { event: NormalizedEvent | null; relatedEvent?: NormalizedEvent | null; source?: string; tab: "normalized" | "raw"; onTab: (tab: "normalized" | "raw") => void; onClose: () => void; onRelated?: () => void }) {
  return (
    <aside className="inspector-panel">
      <div className="inspector-title"><h2>Event details</h2><button className="drawer-close" type="button" aria-label="Close event details" onClick={onClose}><X size={18} /></button></div>
      <div className="view-tabs inspector-tabs">
        <button className={tab === "normalized" ? "active" : ""} type="button" onClick={() => onTab("normalized")}>Normalized</button>
        <button className={tab === "raw" ? "active" : ""} type="button" onClick={() => onTab("raw")}>Raw JSON</button>
      </div>
      {!event ? <div className="inspector-empty">Select an event to inspect its normalized fields and original source record.</div> : tab === "raw" ? (
        <div className="inspector-scroll"><JsonBlock label="Original record" value={event.raw} /></div>
      ) : (
        <div className="inspector-scroll">
          <dl className="event-fields">
            <div><dt>Source</dt><dd>{source || "—"}</dd></div>
            <div><dt>Event type</dt><dd>{event.kind}</dd></div>
            <div><dt>Timestamp</dt><dd>{event.timestamp || "—"}</dd></div>
            <div><dt>Turn ID</dt><dd>{event.turnId || "—"}</dd></div>
            <div><dt>Call ID</dt><dd>{event.callId || "—"}</dd></div>
            <div><dt>Tool</dt><dd>{event.toolName || "—"}</dd></div>
            {relatedEvent && <div><dt>Related</dt><dd><button className="relationship-link" type="button" onClick={onRelated}>{relatedEvent.kind.replaceAll("_", " ")}</button></dd></div>}
            <div><dt>Duration</dt><dd>{event.durationMs == null ? "—" : `${Math.round(event.durationMs)} ms`}</dd></div>
            <div><dt>Status</dt><dd>{event.status || "—"}</dd></div>
          </dl>
          <JsonBlock label="Text" value={event.text} />
          <JsonBlock label="Tool input" value={event.input} />
          <JsonBlock label="Tool output" value={event.output} />
        </div>
      )}
    </aside>
  );
}


