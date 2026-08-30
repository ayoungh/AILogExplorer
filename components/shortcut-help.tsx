"use client";

import { Keyboard, X } from "lucide-react";
import { useEffect, useRef } from "react";

const shortcuts = [
  ["⌘ / Ctrl", "K", "Search all indexed events"],
  ["", "/", "Find within the current session"],
  ["", "J / K", "Next / previous event"],
  ["Shift", "J / K", "Next / previous session"],
  ["", "1–5", "Select an event filter"],
  ["", "Esc", "Close the active panel"],
  ["", "?", "Show this shortcut reference"],
] as const;

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("button")?.focus());
    return () => restoreFocusRef.current?.focus();
  }, [open]);
  if (!open) return null;
  return <div className="shortcut-help-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="shortcut-help" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key === "Tab") { event.preventDefault(); panelRef.current?.querySelector<HTMLElement>("button")?.focus(); }
  }}><header><div><Keyboard size={19} /><h2 id="shortcut-help-title">Keyboard shortcuts</h2></div><button type="button" onClick={onClose} aria-label="Close keyboard shortcuts"><X size={18} /></button></header><div className="shortcut-list">{shortcuts.map(([modifier, key, label]) => <div key={label}><span>{modifier && <kbd>{modifier}</kbd>}<kbd>{key}</kbd></span><p>{label}</p></div>)}</div><p className="shortcut-note">Shortcuts are paused while you type in an input, select, or text area.</p></div></div>;
}
