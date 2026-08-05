import { describe, expect, it } from "vitest";
import { flattenEventPages, queryKeys, reconcileSelectedEvent } from "@/lib/client/api";
import type { EventPageResponse, EventSummary, NormalizedSession } from "@/lib/types";

function session(id: string): NormalizedSession {
  return { id, provider: "codex", externalId: id, title: id, projectPath: null, sourcePath: `/tmp/${id}.jsonl`, startedAt: null, updatedAt: null, model: null, available: true, eventCount: 2 };
}

function event(id: string, sessionId: string, sequence: number): EventSummary {
  return { id, sessionId, sequence, timestamp: null, kind: "metadata", role: null, turnId: null, callId: null, parentId: null, toolName: null, text: id, status: null, durationMs: null, inputTokens: null, outputTokens: null, totalTokens: null, hasInput: false, hasOutput: false, rawBytes: 10, rawRecordCount: 1 };
}

function page(sessionId: string, data: EventSummary[], offset: number): EventPageResponse {
  return { session: session(sessionId), data, total: 2, offset, previousOffset: offset ? 0 : null, nextOffset: offset ? null : 1, anchorFound: true };
}

describe("React Query explorer helpers", () => {
  it("isolates event caches by session, filter, and anchor", () => {
    expect(queryKeys.events("a", [], null)).not.toEqual(queryKeys.events("b", [], null));
    expect(queryKeys.events("a", [], null)).not.toEqual(queryKeys.events("a", ["reasoning"], null));
    expect(queryKeys.events("a", [], null)).not.toEqual(queryKeys.events("a", [], "event-2"));
  });

  it("flattens adjacent pages in sequence order without duplicates", () => {
    const first = event("first", "session-a", 0);
    const second = event("second", "session-a", 1);
    expect(flattenEventPages([page("session-a", [second], 1), page("session-a", [first, second], 0)]).map((value) => value.id)).toEqual(["first", "second"]);
  });

  it("keeps a valid selection and falls back to an anchor or first event", () => {
    const values = [event("first", "session-a", 0), event("second", "session-a", 1)];
    expect(reconcileSelectedEvent(values, "second", null)).toBe("second");
    expect(reconcileSelectedEvent(values, "stale", "second")).toBe("second");
    expect(reconcileSelectedEvent(values, "stale", "missing")).toBe("first");
    expect(reconcileSelectedEvent([], "second", null)).toBeNull();
  });
});
