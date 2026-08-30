"use client";

import { File, FileMinus2, FilePenLine, FilePlus2, FolderOpen, ScanSearch } from "lucide-react";

export type ObservedFileAction = "read" | "write" | "create" | "delete" | "unknown";
export type ObservedFileItem = {
  provider: import("@/lib/types").ProviderId;
  path: string;
  projectPath: string | null;
  action: ObservedFileAction;
  timestamp: string | null;
  sessionId: string;
  sessionTitle: string;
  eventId: string;
  occurrences?: number;
};

const actionIcons = { read: File, write: FilePenLine, create: FilePlus2, delete: FileMinus2, unknown: ScanSearch };

function observedTime(value: string | null) {
  if (!value) return "Time unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ObservedFiles({ files, loading = false, onSelect }: { files: ObservedFileItem[]; loading?: boolean; onSelect: (file: ObservedFileItem) => void }) {
  const groups = files.reduce((result, file) => {
    const key = file.projectPath || "No project path";
    result.set(key, [...(result.get(key) || []), file]);
    return result;
  }, new Map<string, ObservedFileItem[]>());
  return (
    <section className="observed-files" aria-busy={loading}>
      <header><div><h2>Observed files</h2><p>Paths explicitly recorded by indexed tool events. This is not an exhaustive filesystem audit.</p></div><span>{files.length.toLocaleString()} paths</span></header>
      {Array.from(groups.entries()).map(([project, items]) => <section className="observed-file-group" key={project}><h3><FolderOpen size={14} />{project}</h3><div>{items.map((file) => { const Icon = actionIcons[file.action]; return <button type="button" onClick={() => onSelect(file)} key={`${file.eventId}:${file.path}`}><Icon size={16} /><span><strong title={file.path}>{file.path}</strong><small>{file.sessionTitle} · {observedTime(file.timestamp)}</small></span><em className={`observed-action observed-action-${file.action}`}>{file.action}</em>{file.occurrences && file.occurrences > 1 ? <b>{file.occurrences}×</b> : null}</button>; })}</div></section>)}
      {!loading && !files.length && <div className="observed-files-empty"><ScanSearch size={25} /><strong>No observed files yet</strong><span>File paths appear here when a supported tool records them explicitly.</span></div>}
    </section>
  );
}
