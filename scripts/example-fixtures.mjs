export const EXAMPLE_FIXTURE_PATHS = [
  "examples/provider-native/codex-example.jsonl",
  "examples/provider-native/claude-code-example.jsonl",
  "examples/provider-native/claude-desktop-example-audit.jsonl",
  "examples/provider-native/cursor-example.vscdb",
];

export const jsonlFixtures = {
  "codex-example.jsonl": [
    {
      type: "session_meta",
      timestamp: "2026-02-10T09:00:00.000Z",
      payload: {
        id: "example-codex-lantern-notes",
        cwd: "/example-workspace/lantern-notes",
        model: "example-codex-model",
        synthetic: true,
      },
    },
    {
      type: "turn_context",
      timestamp: "2026-02-10T09:00:01.000Z",
      payload: {
        cwd: "/example-workspace/lantern-notes",
        model: "example-codex-model",
        synthetic: true,
      },
    },
    {
      type: "event_msg",
      timestamp: "2026-02-10T09:00:02.000Z",
      payload: {
        type: "user_message",
        turn_id: "example-turn-1",
        client_id: "example-user-message-1",
        message: "[Example] Add an offline retry queue to Lantern Notes and cover it with tests.",
        synthetic: true,
      },
    },
    {
      type: "response_item",
      timestamp: "2026-02-10T09:00:03.000Z",
      payload: {
        type: "reasoning",
        id: "example-reasoning-1",
        turn_id: "example-turn-1",
        summary: [{ type: "summary_text", text: "Inspect the queue boundary and its existing tests before changing behavior." }],
        synthetic: true,
      },
    },
    {
      type: "response_item",
      timestamp: "2026-02-10T09:00:04.000Z",
      payload: {
        type: "function_call",
        call_id: "example-codex-call-read",
        name: "exec_command",
        arguments: "{\"cmd\":\"rg -n \\\"retryQueue\\\" src tests\"}",
        turn_id: "example-turn-1",
        synthetic: true,
      },
    },
    {
      type: "response_item",
      timestamp: "2026-02-10T09:00:05.000Z",
      payload: {
        type: "function_call_output",
        call_id: "example-codex-call-read",
        output: "src/sync/retry-queue.ts:14:export class RetryQueue\ntests/retry-queue.test.ts:8:describe(\"RetryQueue\")",
        status: "completed",
        turn_id: "example-turn-1",
        synthetic: true,
      },
    },
    {
      type: "response_item",
      timestamp: "2026-02-10T09:00:06.000Z",
      payload: {
        type: "reasoning",
        id: "example-reasoning-2",
        turn_id: "example-turn-1",
        summary: [{ type: "summary_text", text: "Keep retries bounded and preserve insertion order when connectivity returns." }],
        synthetic: true,
      },
    },
    {
      type: "event_msg",
      timestamp: "2026-02-10T09:00:07.000Z",
      payload: {
        type: "patch_apply_end",
        call_id: "example-codex-call-patch",
        name: "apply_patch",
        status: "completed",
        duration_ms: 184,
        message: "Updated retry queue and synthetic tests",
        synthetic: true,
      },
    },
    {
      type: "response_item",
      timestamp: "2026-02-10T09:00:08.000Z",
      payload: {
        type: "function_call",
        call_id: "example-codex-call-test",
        name: "exec_command",
        arguments: "{\"cmd\":\"pnpm test -- retry-queue\"}",
        turn_id: "example-turn-1",
        synthetic: true,
      },
    },
    {
      type: "response_item",
      timestamp: "2026-02-10T09:00:09.000Z",
      payload: {
        type: "function_call_output",
        call_id: "example-codex-call-test",
        output: "PASS tests/retry-queue.test.ts\n4 tests passed",
        status: "completed",
        turn_id: "example-turn-1",
        synthetic: true,
      },
    },
    {
      type: "response_item",
      timestamp: "2026-02-10T09:00:10.000Z",
      payload: {
        type: "message",
        id: "example-assistant-message-1",
        role: "assistant",
        turn_id: "example-turn-1",
        content: [{ type: "output_text", text: "Implemented the bounded offline retry queue and added passing coverage for replay order and retry limits." }],
        synthetic: true,
      },
    },
    {
      type: "event_msg",
      timestamp: "2026-02-10T09:00:11.000Z",
      payload: {
        type: "token_count",
        turn_id: "example-turn-1",
        info: {
          total_token_usage: {
            input_tokens: 1240,
            output_tokens: 386,
            total_tokens: 1626,
          },
        },
        synthetic: true,
      },
    },
  ],
  "claude-code-example.jsonl": [
    {
      type: "user",
      sessionId: "example-claude-code-harbor-calendar",
      timestamp: "2026-02-11T10:30:00.000Z",
      cwd: "/example-workspace/harbor-calendar",
      uuid: "example-claude-user-1",
      synthetic: true,
      message: {
        role: "user",
        content: "[Example] Fix the calendar so late-night events remain in the selected local day.",
      },
    },
    {
      type: "custom-title",
      sessionId: "example-claude-code-harbor-calendar",
      timestamp: "2026-02-11T10:30:01.000Z",
      uuid: "example-claude-title-1",
      customTitle: "[Example] Fix local-day calendar grouping",
      synthetic: true,
    },
    {
      type: "assistant",
      sessionId: "example-claude-code-harbor-calendar",
      timestamp: "2026-02-11T10:30:02.000Z",
      uuid: "example-claude-assistant-1",
      synthetic: true,
      message: {
        role: "assistant",
        model: "claude-example-model",
        content: [
          { type: "thinking", thinking: "Read the grouping helper and its timezone tests before editing." },
          {
            type: "tool_use",
            id: "example-claude-call-read",
            name: "Read",
            input: { file_path: "/example-workspace/harbor-calendar/src/group-events.ts" },
          },
        ],
      },
    },
    {
      type: "user",
      sessionId: "example-claude-code-harbor-calendar",
      timestamp: "2026-02-11T10:30:03.000Z",
      uuid: "example-claude-result-1",
      synthetic: true,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "example-claude-call-read",
            content: "The helper groups events with toISOString().slice(0, 10).",
            is_error: false,
          },
        ],
      },
    },
    {
      type: "assistant",
      sessionId: "example-claude-code-harbor-calendar",
      timestamp: "2026-02-11T10:30:04.000Z",
      uuid: "example-claude-assistant-2",
      synthetic: true,
      message: {
        role: "assistant",
        model: "claude-example-model",
        content: [
          { type: "thinking", thinking: "Replace UTC slicing with the existing local date formatter and add a midnight boundary case." },
          {
            type: "tool_use",
            id: "example-claude-call-edit",
            name: "Edit",
            input: {
              file_path: "/example-workspace/harbor-calendar/src/group-events.ts",
              old_string: "event.start.toISOString().slice(0, 10)",
              new_string: "localDateKey(event.start, timeZone)",
            },
          },
        ],
      },
    },
    {
      type: "user",
      sessionId: "example-claude-code-harbor-calendar",
      timestamp: "2026-02-11T10:30:05.000Z",
      uuid: "example-claude-result-2",
      synthetic: true,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "example-claude-call-edit",
            content: "Updated src/group-events.ts and tests/group-events.test.ts",
            is_error: false,
          },
        ],
      },
    },
    {
      type: "assistant",
      sessionId: "example-claude-code-harbor-calendar",
      timestamp: "2026-02-11T10:30:06.000Z",
      uuid: "example-claude-assistant-3",
      synthetic: true,
      message: {
        role: "assistant",
        model: "claude-example-model",
        content: [
          {
            type: "tool_use",
            id: "example-claude-call-test",
            name: "Bash",
            input: { command: "pnpm test -- group-events" },
          },
        ],
      },
    },
    {
      type: "user",
      sessionId: "example-claude-code-harbor-calendar",
      timestamp: "2026-02-11T10:30:07.000Z",
      uuid: "example-claude-result-3",
      synthetic: true,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "example-claude-call-test",
            content: "6 tests passed",
            is_error: false,
          },
        ],
      },
    },
    {
      type: "assistant",
      sessionId: "example-claude-code-harbor-calendar",
      timestamp: "2026-02-11T10:30:08.000Z",
      uuid: "example-claude-assistant-4",
      synthetic: true,
      message: {
        role: "assistant",
        model: "claude-example-model",
        content: "Calendar grouping now uses the selected timezone, with a passing late-night boundary test.",
      },
    },
  ],
  "claude-desktop-example-audit.jsonl": [
    {
      type: "user",
      session_id: "example-claude-desktop-release-brief",
      _audit_timestamp: "2026-02-12T14:00:00.000Z",
      _audit_hmac: "example-audit-hmac",
      uuid: "example-desktop-user-1",
      client_platform: "example-desktop",
      synthetic: true,
      message: {
        role: "user",
        content: "[Example] Turn the attached fictional release notes into a concise launch brief.",
      },
    },
    {
      type: "custom-title",
      session_id: "example-claude-desktop-release-brief",
      _audit_timestamp: "2026-02-12T14:00:01.000Z",
      _audit_hmac: "example-audit-hmac",
      uuid: "example-desktop-title-1",
      customTitle: "[Example] Draft a launch brief",
      synthetic: true,
    },
    {
      type: "system",
      subtype: "init",
      session_id: "example-claude-desktop-release-brief",
      _audit_timestamp: "2026-02-12T14:00:02.000Z",
      _audit_hmac: "example-audit-hmac",
      uuid: "example-desktop-system-1",
      cwd: "/example-workspace/juniper-release",
      model: "claude-desktop-example-model",
      content: "Synthetic local-agent session",
      synthetic: true,
    },
    {
      type: "attachment",
      session_id: "example-claude-desktop-release-brief",
      timestamp: "2026-02-12T14:00:03.000Z",
      _audit_timestamp: "2026-02-12T14:00:03.000Z",
      _audit_hmac: "example-audit-hmac",
      uuid: "example-desktop-attachment-1",
      attachment: {
        name: "fictional-release-notes.txt",
        media_type: "text/plain",
        size: 512,
        synthetic: true,
      },
      synthetic: true,
    },
    {
      type: "assistant",
      session_id: "example-claude-desktop-release-brief",
      _audit_timestamp: "2026-02-12T14:00:04.000Z",
      _audit_hmac: "example-audit-hmac",
      uuid: "example-desktop-assistant-1",
      request_id: "example-desktop-request-1",
      synthetic: true,
      message: {
        role: "assistant",
        model: "claude-desktop-example-model",
        content: [
          { type: "thinking", thinking: "Extract the fictional benefits, audience, and launch date before drafting." },
          {
            type: "tool_use",
            id: "example-desktop-call-read",
            name: "Read",
            input: { file_path: "/example-workspace/juniper-release/fictional-release-notes.txt" },
          },
        ],
      },
    },
    {
      type: "user",
      session_id: "example-claude-desktop-release-brief",
      timestamp: "2026-02-12T14:00:05.000Z",
      _audit_timestamp: "2026-02-12T14:00:05.000Z",
      _audit_hmac: "example-audit-hmac",
      uuid: "example-desktop-result-1",
      synthetic: true,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "example-desktop-call-read",
            content: "Fictional notes: faster search, clearer filters, launch on 20 February.",
            is_error: false,
          },
        ],
      },
    },
    {
      type: "assistant",
      session_id: "example-claude-desktop-release-brief",
      _audit_timestamp: "2026-02-12T14:00:06.000Z",
      _audit_hmac: "example-audit-hmac",
      uuid: "example-desktop-assistant-2",
      request_id: "example-desktop-request-2",
      synthetic: true,
      message: {
        role: "assistant",
        model: "claude-desktop-example-model",
        content: "Juniper Search launches on 20 February with faster results and clearer filters. The brief is ready for review by the fictional product team.",
      },
    },
  ],
};

export const cursorFixture = {
  tables: ["cursorDiskKV"],
  rows: [
    {
      key: "composerData:example-cursor-northstar-search",
      value: {
        composerId: "example-cursor-northstar-search",
        name: "[Example] Repair keyboard search selection",
        createdAt: "2026-02-13T16:15:00.000Z",
        lastUpdatedAt: "2026-02-13T16:15:08.000Z",
        workspaceProjectDir: "/example-workspace/northstar-search",
        modelConfig: { modelName: "cursor-example-model" },
        synthetic: true,
      },
    },
    {
      key: "bubbleId:example-cursor-northstar-search:example-cursor-bubble-1",
      value: {
        bubbleId: "example-cursor-bubble-1",
        type: 1,
        text: "[Example] Fix keyboard selection after filtering the Northstar results list.",
        createdAt: "2026-02-13T16:15:01.000Z",
        synthetic: true,
      },
    },
    {
      key: "bubbleId:example-cursor-northstar-search:example-cursor-bubble-2",
      value: {
        bubbleId: "example-cursor-bubble-2",
        type: 2,
        text: "I found that the selected index is retained when the filtered list becomes shorter.",
        thinking: "Inspect the filter reducer and keyboard handler, then reproduce the stale-index boundary.",
        thinkingDurationMs: 940,
        toolFormerData: {
          name: "read_file",
          path: "/example-workspace/northstar-search/src/search-results.ts",
        },
        toolResults: [
          {
            path: "src/search-results.ts",
            finding: "selectedIndex is not clamped after filteredResults changes",
          },
        ],
        createdAt: "2026-02-13T16:15:03.000Z",
        synthetic: true,
      },
    },
    {
      key: "bubbleId:example-cursor-northstar-search:example-cursor-bubble-3",
      value: {
        bubbleId: "example-cursor-bubble-3",
        type: 2,
        text: "The selection now resets safely after filtering, and the keyboard regression test passes.",
        thinking: "Clamp the index through the shared selection helper and verify ArrowDown and Enter.",
        toolFormerData: {
          name: "edit_file",
          path: "/example-workspace/northstar-search/src/search-results.ts",
          change: "Clamp selectedIndex when filteredResults changes",
        },
        toolResults: [
          {
            command: "pnpm test -- search-results",
            output: "5 tests passed",
            status: "success",
          },
        ],
        createdAt: "2026-02-13T16:15:08.000Z",
        synthetic: true,
      },
    },
  ],
};

