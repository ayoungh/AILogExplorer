"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { eventContentQueryOptions } from "@/lib/client/api";
import type { EventContentPart, EventContentPreview, EventKind, EventSummary, ProviderId } from "@/lib/types";
import { EventIcon } from "./event-icon";

const MARKDOWN_PLUGINS = [remarkGfm];

const labels: Record<EventKind, string> = {
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
  return Number.isNaN(date.getTime()) ? value.slice(11, 19) : date.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function downloadHref(eventId: string, part: EventContentPart) {
  return `/api/events/${encodeURIComponent(eventId)}?part=${part}&mode=download`;
}

function PayloadPreview({ eventId, label, part, preview, pending, error, onRetry }: {
  eventId: string;
  label: string;
  part: "input" | "output";
  preview?: EventContentPreview;
  pending: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  if (pending) return <div className="payload-state">Loading {label.toLowerCase()}…</div>;
  if (error) return <div className="payload-state payload-error">{error.message}<button type="button" onClick={onRetry}>Retry</button></div>;
  if (!preview) return null;
  return (
    <section className="event-payload">
      <div><strong>{label}</strong>{preview.truncated ? <span>Preview truncated</span> : null}<a href={downloadHref(eventId, part)} download onClick={(event) => event.stopPropagation()}>Download JSON</a></div>
      <pre className="event-data">{preview.text}</pre>
    </section>
  );
}

export const EventCard = memo(function EventCard({ event, provider, selected, onSelect }: {
  event: EventSummary;
  provider: ProviderId;
  selected: boolean;
  onSelect: (event: EventSummary) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const inputQuery = useQuery({ ...eventContentQueryOptions(event.id, "input"), enabled: expanded && event.hasInput });
  const outputQuery = useQuery({ ...eventContentQueryOptions(event.id, "output"), enabled: expanded && event.hasOutput });
  const expandable = event.hasInput || event.hasOutput;

  return (
    <article className={`timeline-row event-${event.kind} ${selected ? "is-selected" : ""}`} data-event-id={event.id}>
      <time suppressHydrationWarning>{formatTime(event.timestamp)}</time>
      <span className="event-node" data-event-icon={event.kind} aria-hidden="true"><EventIcon kind={event.kind} provider={provider} /></span>
      <div className="event-card" role="button" tabIndex={0} onClick={() => onSelect(event)} onKeyDown={(key) => { if (key.key === "Enter" || key.key === " ") { key.preventDefault(); onSelect(event); } }} aria-pressed={selected}>
        <span className="event-heading">
          <span className="event-label">{labels[event.kind]}</span>
          {event.toolName ? <span className="event-tool">{event.toolName}</span> : null}
          <span className="event-spacer" />
          {event.durationMs != null ? <span>{Math.round(event.durationMs)} ms</span> : null}
          {event.status ? <span className={`event-status status-${event.status}`}>{event.status}</span> : null}
          {event.rawRecordCount > 1 ? <span>{event.rawRecordCount} records</span> : null}
          {expandable ? (
            <button className="disclosure" type="button" aria-label={expanded ? "Collapse event payload" : "Expand event payload"} onClick={(click) => { click.stopPropagation(); setExpanded((value) => !value); }}>
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : null}
        </span>
        {event.text ? <div className={`event-copy ${event.kind === "reasoning" ? "reasoning-copy" : ""}`}><ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{event.text}</ReactMarkdown></div> : null}
        {expanded ? (
          <div className="event-expanded" onClick={(click) => click.stopPropagation()}>
            {event.hasInput ? <PayloadPreview eventId={event.id} label="Tool input" part="input" preview={inputQuery.data} pending={inputQuery.isPending} error={inputQuery.error} onRetry={() => void inputQuery.refetch()} /> : null}
            {event.hasOutput ? <PayloadPreview eventId={event.id} label="Tool output" part="output" preview={outputQuery.data} pending={outputQuery.isPending} error={outputQuery.error} onRetry={() => void outputQuery.refetch()} /> : null}
          </div>
        ) : null}
        {(event.inputTokens != null || event.outputTokens != null || event.totalTokens != null) ? (
          <span className="event-metrics">
            {event.inputTokens != null ? <span>↑ {event.inputTokens.toLocaleString()}</span> : null}
            {event.outputTokens != null ? <span>↓ {event.outputTokens.toLocaleString()}</span> : null}
            {event.totalTokens != null ? <span>Total {event.totalTokens.toLocaleString()}</span> : null}
          </span>
        ) : null}
      </div>
    </article>
  );
});
