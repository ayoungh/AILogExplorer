"use client";

import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

export function SessionFind({
  open,
  query,
  activeIndex,
  total,
  pending = false,
  onQueryChange,
  onPrevious,
  onNext,
  onClose,
}: {
  open: boolean;
  query: string;
  activeIndex: number;
  total: number;
  pending?: boolean;
  onQueryChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!open) return null;
  const position = total && activeIndex >= 0 ? activeIndex + 1 : 0;

  return (
    <div className="session-find" role="search" aria-label="Find within session">
      <Search size={15} aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in this session"
        aria-label="Find in this session"
      />
      <output className="session-find-count" aria-live="polite">{pending ? "Searching…" : `${position} of ${total}`}</output>
      <button type="button" onClick={onPrevious} disabled={!total} aria-label="Previous match"><ChevronUp size={15} /></button>
      <button type="button" onClick={onNext} disabled={!total} aria-label="Next match"><ChevronDown size={15} /></button>
      <button type="button" onClick={onClose} aria-label="Close session search"><X size={15} /></button>
    </div>
  );
}
