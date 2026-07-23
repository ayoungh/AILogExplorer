"use client";

import { ChevronDown, ChevronRight, CircleAlert, Wrench } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { NormalizedEvent } from "@/lib/types";

const labels: Record<NormalizedEvent["kind"], string> = {
  user_message: "User",
  assistant_message: "Assistant",
  reasoning: "Reasoning",
  tool_call: "Tool call",
  tool_result: "Tool result",
  system: "System",
  usage: "Usage",
  error: "Error",
  attachment: "Attachment",
  metadata: "Metadata",
  unknown: "Unknown",
};

function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(11, 19) : date.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function DataBlock({ value }: { value: unknown }) {
  if (value == null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <pre className="event-data">{text}</pre>;
}

export function EventCard({ event, selected, onSelect }: { event: NormalizedEvent; selected: boolean; onSelect: () => void }) {
  const [expanded, setExpanded] = useState(event.kind === "tool_result");
  const expandable = event.input != null || event.output != null;
  return (
    <article className={`timeline-row event-${event.kind} ${selected ? "is-selected" : ""}`}>
      <time>{formatTime(event.timestamp)}</time>
      <span className="event-node" aria-hidden="true">
        {event.kind === "error" ? <CircleAlert size={15} /> : event.kind.startsWith("tool_") ? <Wrench size={14} /> : labels[event.kind].slice(0, 1)}
      </span>
      <div className="event-card" role="button" tabIndex={0} onClick={onSelect} onKeyDown={(key) => { if (key.key === "Enter" || key.key === " ") { key.preventDefault(); onSelect(); } }} aria-pressed={selected}>
        <span className="event-heading">
          <span className="event-label">{labels[event.kind]}</span>
          {event.toolName && <span className="event-tool">{event.toolName}</span>}
          <span className="event-spacer" />
          {event.durationMs != null && <span>{Math.round(event.durationMs)} ms</span>}
          {event.status && <span className={`event-status status-${event.status}`}>{event.status}</span>}
          {event.rawRecordCount && event.rawRecordCount > 1 && <span>{event.rawRecordCount} records</span>}
          {expandable && (
            <button className="disclosure" type="button" aria-label={expanded ? "Collapse event payload" : "Expand event payload"} onClick={(click) => { click.stopPropagation(); setExpanded((value) => !value); }}>
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          )}
        </span>
        {event.text && <div className={`event-copy ${event.kind === "reasoning" ? "reasoning-copy" : ""}`}><ReactMarkdown remarkPlugins={[remarkGfm]}>{event.text}</ReactMarkdown></div>}
        {expanded && <div className="event-expanded"><DataBlock value={event.input} /><DataBlock value={event.output} /></div>}
        {(event.inputTokens != null || event.outputTokens != null || event.totalTokens != null) && (
          <span className="event-metrics">
            {event.inputTokens != null && <span>↑ {event.inputTokens.toLocaleString()}</span>}
            {event.outputTokens != null && <span>↓ {event.outputTokens.toLocaleString()}</span>}
            {event.totalTokens != null && <span>Total {event.totalTokens.toLocaleString()}</span>}
          </span>
        )}
      </div>
    </article>
  );
}


