"use client";

import { ChevronDown, ChevronRight, Filter, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { EventKind, ProviderId } from "@/lib/types";

export type SearchWorkspaceResult = {
  eventId: string;
  sessionId: string;
  sessionTitle: string;
  provider: ProviderId;
  projectPath: string | null;
  model: string | null;
  kind: EventKind;
  timestamp: string | null;
  snippet: string;
};

export type SearchWorkspaceFacets = {
  providers: Array<{ value: ProviderId; count: number }>;
  projects: Array<{ value: string; count: number }>;
  models: Array<{ value: string; count: number }>;
  kinds: Array<{ value: EventKind; count: number }>;
};

export type SearchWorkspaceFilters = {
  provider: ProviderId | "";
  project: string;
  model: string;
  kind: EventKind | "";
  from: string;
  to: string;
  sort: "relevance" | "recent";
};

function resultDate(value: string | null) {
  if (!value) return "Time unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function HighlightedSnippet({ value }: { value: string }) {
  const parts = value.split(/(<\/?mark>)/gi);
  return <>{parts.map((part, index) => {
    if (/^<\/?mark>$/i.test(part)) return null;
    const preceding = parts.slice(0, index);
    const highlighted = preceding.filter((value) => /^<mark>$/i.test(value)).length > preceding.filter((value) => /^<\/mark>$/i.test(value)).length;
    return highlighted ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>;
  })}</>;
}

export function SearchWorkspace({
  open,
  query,
  filters,
  facets,
  results,
  total,
  activeIndex,
  pending = false,
  hasMore = false,
  onQueryChange,
  onFiltersChange,
  onActiveIndexChange,
  onSelect,
  onLoadMore,
  onClose,
}: {
  open: boolean;
  query: string;
  filters: SearchWorkspaceFilters;
  facets: SearchWorkspaceFacets;
  results: SearchWorkspaceResult[];
  total: number;
  activeIndex: number;
  pending?: boolean;
  hasMore?: boolean;
  onQueryChange: (value: string) => void;
  onFiltersChange: (value: SearchWorkspaceFilters) => void;
  onActiveIndexChange: (index: number) => void;
  onSelect: (result: SearchWorkspaceResult) => void;
  onLoadMore: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => restoreFocusRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const move = (delta: number) => {
    if (!results.length) return;
    onActiveIndexChange((activeIndex + delta + results.length) % results.length);
  };

  return (
    <div className="search-workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="search-workspace"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-workspace-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
          if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
          if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
          if (event.key === "Enter" && results[activeIndex]) { event.preventDefault(); onSelect(results[activeIndex]); }
          if (event.key === "Tab") {
            const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input, select") || []);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}
      >
        <header className="search-workspace-header">
          <div><Search size={18} /><h2 id="search-workspace-title">Search indexed events</h2></div>
          <button type="button" aria-label="Close search" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="search-workspace-input">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-controls="search-workspace-results"
            aria-expanded={Boolean(results.length)}
            aria-activedescendant={results[activeIndex] ? `search-result-${results[activeIndex].eventId}` : undefined}
            autoComplete="off"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search messages, reasoning, tools, and errors"
          />
          {pending && <LoaderCircle className="search-workspace-spin" size={16} aria-label="Searching" />}
          <kbd>esc</kbd>
        </div>
        <div className="search-workspace-body">
          <aside className="search-workspace-filters" aria-label="Search filters">
            <h3><Filter size={14} />Filters</h3>
            <label>Provider<select value={filters.provider} onChange={(event) => onFiltersChange({ ...filters, provider: event.target.value as ProviderId | "" })}><option value="">All providers</option>{facets.providers.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select><ChevronDown size={13} /></label>
            <label>Project<select value={filters.project} onChange={(event) => onFiltersChange({ ...filters, project: event.target.value })}><option value="">All projects</option>{facets.projects.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select><ChevronDown size={13} /></label>
            <label>Model<select value={filters.model} onChange={(event) => onFiltersChange({ ...filters, model: event.target.value })}><option value="">All models</option>{facets.models.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select><ChevronDown size={13} /></label>
            <label>Event type<select value={filters.kind} onChange={(event) => onFiltersChange({ ...filters, kind: event.target.value as EventKind | "" })}><option value="">All event types</option>{facets.kinds.map((item) => <option key={item.value} value={item.value}>{item.value.replaceAll("_", " ")} ({item.count})</option>)}</select><ChevronDown size={13} /></label>
            <label>From<input type="date" value={filters.from} onChange={(event) => onFiltersChange({ ...filters, from: event.target.value })} /></label>
            <label>To<input type="date" value={filters.to} onChange={(event) => onFiltersChange({ ...filters, to: event.target.value })} /></label>
            <label>Sort<select value={filters.sort} onChange={(event) => onFiltersChange({ ...filters, sort: event.target.value as SearchWorkspaceFilters["sort"] })}><option value="relevance">Relevance</option><option value="recent">Most recent</option></select><ChevronDown size={13} /></label>
          </aside>
          <section className="search-workspace-results">
            <div className="search-workspace-results-heading"><span aria-live="polite">{query.trim().length < 2 ? "Enter at least 2 characters" : `${total.toLocaleString()} result${total === 1 ? "" : "s"}`}</span><small>↑↓ navigate · enter open</small></div>
            <div id="search-workspace-results" role="listbox" aria-label="Search results">
              {results.map((result, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-posinset={index + 1}
                  aria-setsize={total}
                  id={`search-result-${result.eventId}`}
                  className={index === activeIndex ? "active" : ""}
                  key={result.eventId}
                  onMouseEnter={() => onActiveIndexChange(index)}
                  onClick={() => onSelect(result)}
                >
                  <span className="search-result-kind">{result.kind.replaceAll("_", " ")}</span>
                  <strong>{result.sessionTitle}</strong>
                  <small>{result.model || result.provider} · {resultDate(result.timestamp)}</small>
                  <span className="search-result-snippet"><HighlightedSnippet value={result.snippet} /></span>
                  <ChevronRight size={16} />
                </button>
              ))}
              {!pending && query.trim().length >= 2 && !results.length && <div className="search-workspace-empty"><Search size={22} /><strong>No matching events</strong><span>Try broadening the query or removing a filter.</span></div>}
            </div>
            {hasMore && <button className="search-workspace-more" type="button" onClick={onLoadMore} disabled={pending}>Load more results</button>}
          </section>
        </div>
      </div>
    </div>
  );
}
