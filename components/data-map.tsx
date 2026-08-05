"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Brain, Check, ChevronLeft, ChevronRight, CircleHelp, Copy, Database, FileQuestion, Gauge, Info, MessageCircle, Paperclip, RefreshCw, Settings2, TerminalSquare, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { dataMapQueryOptions, dataMapSampleQueryOptions } from "@/lib/client/api";
import type { DataConceptId, ProviderId } from "@/lib/types";
import { AppModeSwitch } from "./app-mode-switch";
import { ProviderMark } from "./provider-mark";

const conceptIcons: Record<DataConceptId, typeof MessageCircle> = {
  messages: MessageCircle,
  reasoning: Brain,
  "tool-calls": TerminalSquare,
  "tool-results": Wrench,
  "usage-tokens": Gauge,
  errors: AlertTriangle,
  attachments: Paperclip,
  "system-context": Settings2,
  "metadata-unknown": FileQuestion,
};

function compact(value: number) {
  return Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

export function DataMap({
  conceptId,
  provider,
  sampleIndex,
  sidebarOpen,
  inspectorOpen,
  onMode,
  onConcept,
  onProvider,
  onSample,
  onSidebarClose,
  onInspectorOpen,
  onInspectorClose,
}: {
  conceptId: DataConceptId;
  provider: ProviderId | null;
  sampleIndex: number;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  onMode: (mode: "logs" | "data-map") => void;
  onConcept: (value: DataConceptId) => void;
  onProvider: (value: ProviderId) => void;
  onSample: (value: number) => void;
  onSidebarClose: () => void;
  onInspectorOpen: () => void;
  onInspectorClose: () => void;
}) {
  const [sampleTab, setSampleTab] = useState<"native" | "normalized">("native");
  const [copied, setCopied] = useState(false);
  const dataQuery = useQuery(dataMapQueryOptions());
  const data = dataQuery.data;

  const concept = useMemo(() => data?.concepts.find((item) => item.id === conceptId) || data?.concepts[0] || null, [data, conceptId]);
  const selectedProvider = concept?.providers.find((item) => item.provider === provider) || concept?.providers.find((item) => item.eventCount > 0) || concept?.providers[0] || null;

  useEffect(() => {
    if (selectedProvider && selectedProvider.provider !== provider) onProvider(selectedProvider.provider);
  }, [selectedProvider, provider, onProvider]);

  const sampleEnabled = Boolean(concept && selectedProvider && selectedProvider.sampleCount > 0);
  const sampleQuery = useQuery({
    ...dataMapSampleQueryOptions(selectedProvider?.provider || "claude-code", concept?.id || "messages", sampleIndex),
    enabled: sampleEnabled,
  });
  const sample = sampleQuery.data;

  useEffect(() => {
    if (sampleQuery.isError && sampleIndex !== 0) onSample(0);
  }, [onSample, sampleIndex, sampleQuery.isError]);

  const chooseConcept = (value: DataConceptId) => {
    const next = data?.concepts.find((item) => item.id === value);
    const nextProvider = next?.providers.find((item) => item.provider === provider && item.eventCount > 0) || next?.providers.find((item) => item.eventCount > 0) || next?.providers[0];
    onConcept(value);
    if (nextProvider) onProvider(nextProvider.provider);
    onSample(0);
    onSidebarClose();
  };

  const visibleSample = sample?.provider === selectedProvider?.provider && sample?.concept === concept?.id && sample?.index === sampleIndex ? sample : null;
  const sampleLoading = sampleEnabled && sampleQuery.isPending;
  const sampleValue = sampleTab === "native" ? visibleSample?.sample : visibleSample?.normalized;
  const sampleText = sampleValue == null ? "" : JSON.stringify(sampleValue, null, 2);

  return (
    <div className="workspace data-map-workspace">
      <aside className={`left-panel data-map-nav ${sidebarOpen ? "drawer-open" : ""}`}>
        <button className="drawer-close" type="button" aria-label="Close data concepts" onClick={onSidebarClose}><X size={18} /></button>
        <AppModeSwitch mode="data-map" onChange={onMode} />
        <header className="data-map-nav-header"><div><h2>Data map</h2><CircleHelp size={15} /></div><p>Explore how common concepts appear across providers and how they’re normalized in AI Log Explorer.</p></header>
        <nav className="concept-list" aria-label="Data concepts">
          {data?.concepts.map((item) => {
            const Icon = conceptIcons[item.id];
            return <button key={item.id} type="button" className={item.id === concept?.id ? "active" : ""} onClick={() => chooseConcept(item.id)}><Icon size={22} /><span><strong>{item.label}</strong><small>{compact(item.eventCount)} events</small></span></button>;
          })}
          {dataQuery.isPending && Array.from({ length: 7 }).map((_, index) => <span className="concept-skeleton" key={index} />)}
        </nav>
      </aside>

      <section className="main-panel data-map-main">
        {dataQuery.isPending ? <div className="data-map-state"><RefreshCw className="spin" size={23} /><h1>Analysing indexed fields…</h1><p>The first visit may build lightweight summaries for existing sessions.</p></div> : dataQuery.error ? <div className="data-map-state"><AlertTriangle size={24} /><h1>Couldn’t load the data map</h1><p>{dataQuery.error.message}</p><button className="secondary-button" type="button" onClick={() => void dataQuery.refetch()}>Try again</button></div> : !concept ? <div className="data-map-state"><Info size={23} /><h1>No indexed concepts yet</h1><p>Scan this Mac or import files to populate the comparison.</p></div> : <>
          <header className="data-map-heading"><h1>{concept.label}</h1><p>{concept.description}</p><div className="concept-metrics"><span><Database size={18} /><b>{concept.eventCount.toLocaleString()}</b><small>Indexed events</small></span><span><Gauge size={18} /><b>{concept.providerCount} of {concept.indexedProviderCount || 0} ({concept.providerCoverage}%)</b><small>Coverage across indexed providers</small></span></div></header>
          <div className="provider-comparison" role="table" aria-label={`${concept.label} by provider`}>
            <div className="provider-comparison-head" role="row"><span>Provider</span><span>Recorded / share</span><span>Indexed events</span><span>Provider-native record</span><span>Normalized fields extracted</span></div>
            {concept.providers.map((item) => {
              const active = item.provider === selectedProvider?.provider;
              const fields = item.fieldMappings.map((mapping) => mapping.field);
              return <button key={item.provider} type="button" role="row" className={`provider-comparison-row ${active ? "active" : ""}`} onClick={() => { onProvider(item.provider); onSample(0); onInspectorOpen(); }}>
                <span className="provider-cell"><ProviderMark provider={item.provider} /><strong>{item.label}</strong></span>
                <span className={`recording-status status-${item.status}`}><i />{item.status === "recorded" ? <>Recorded<small>{item.providerEventShare}% of events</small></> : item.status === "export-required" ? <>Export required<small>Import an official export</small></> : item.status === "not-observed" ? <>Not observed<small>No matching indexed events</small></> : <>Unsupported<small>No current adapter mapping</small></>}</span>
                <span className="event-count"><strong>{item.eventCount.toLocaleString()}</strong><small>{item.sampleCount ? `${item.sampleCount} samples` : "No samples"}</small></span>
                <span className="native-records">{item.nativeRecords.length ? item.nativeRecords.slice(0, 2).map((record) => <code key={record}>{record}</code>) : <small>—</small>}{item.nativeRecords.length > 2 && <small>+{item.nativeRecords.length - 2} more</small>}</span>
                <span className="normalized-fields"><code>{concept.id}</code><span>{fields.slice(0, 4).map((value) => <i key={value}>{value}</i>)}</span>{fields.length > 4 && <small>+{fields.length - 4} more</small>}</span>
              </button>;
            })}
          </div>
          <p className="data-map-note"><Info size={14} /> Counts come from normalized summaries. Raw records are decoded only when you open a local sample.</p>
        </>}
      </section>

      <div className={`inspector-wrap data-map-inspector-wrap ${inspectorOpen ? "drawer-open" : ""}`}>
        <aside className="inspector-panel data-map-inspector">
          <div className="inspector-title"><h2>Field explorer</h2><button className="drawer-close" type="button" aria-label="Close field explorer" onClick={onInspectorClose}><X size={18} /></button></div>
          {!concept || !selectedProvider ? <div className="inspector-empty">Select a concept and provider to inspect its fields.</div> : <div className="data-map-inspector-scroll">
            <div className="inspector-provider"><span>Provider</span><b><ProviderMark provider={selectedProvider.provider} size="small" />{selectedProvider.label}</b><span>Normalized concept</span><code>{concept.id}</code></div>
            <section className="field-mapping"><h3>Field mapping <CircleHelp size={14} /></h3>{selectedProvider.fieldMappings.length ? <div className="mapping-table"><div><b>Normalized field</b><b>Source path (native)</b></div>{selectedProvider.fieldMappings.slice(0, 6).map((mapping) => <div key={mapping.field}><code>{mapping.field}</code><span><code>{mapping.sourcePaths.join(" · ")}</code><small>{mapping.type} · {selectedProvider.fieldCoverage[mapping.field] ?? 0}% populated</small></span></div>)}{selectedProvider.fieldMappings.length > 6 && <p className="mapping-more">+{selectedProvider.fieldMappings.length - 6} more normalized fields available</p>}</div> : <p className="mapping-empty">This provider does not currently expose a normalized mapping for {concept.label.toLowerCase()}.</p>}</section>
            <section className="local-sample"><div className="local-sample-heading"><h3>Local sample {visibleSample?.truncated && <small>· redacted / truncated</small>}</h3><span><button type="button" className={sampleTab === "native" ? "active" : ""} onClick={() => setSampleTab("native")}>Native</button><button type="button" className={sampleTab === "normalized" ? "active" : ""} onClick={() => setSampleTab("normalized")}>Normalized</button></span></div>
              {sampleLoading ? <div className="sample-state"><RefreshCw className="spin" size={18} />Loading one local record…</div> : !visibleSample ? <div className="sample-state">{selectedProvider.status === "export-required" ? "Import an official export to inspect samples." : "No local sample is available for this provider and concept."}</div> : <div className="sample-json"><button type="button" aria-label="Copy sample" onClick={() => { void navigator.clipboard.writeText(sampleText); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button><pre>{sampleText}</pre></div>}
              <div className="sample-pagination"><button type="button" disabled={!visibleSample || visibleSample.index <= 0} onClick={() => onSample(Math.max(0, sampleIndex - 1))}><ChevronLeft size={15} />Previous sample</button><span>{visibleSample ? `${visibleSample.index + 1} of ${visibleSample.total}` : "—"}</span><button type="button" disabled={!visibleSample || visibleSample.index + 1 >= visibleSample.total} onClick={() => onSample(sampleIndex + 1)}>Next sample<ChevronRight size={15} /></button></div>
            </section>
          </div>}
        </aside>
      </div>
    </div>
  );
}
