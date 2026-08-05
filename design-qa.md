# Cross-provider Data Map — Design QA

## Evidence

- Source visual truth: `exec-f7675225-e918-4bad-ba2a-4c2eb2139d62.png` (external generated-image artifact)
- Implementation screenshot: `implementation-final-1536x1024.png` (external Codex visualization artifact)
- Full-view comparison: `comparison-final.png` (external Codex visualization artifact)
- Focused centre/inspector comparison: `comparison-focused-center-inspector.png` (external Codex visualization artifact)
- Responsive evidence: `responsive-620x800.png` (external Codex visualization artifact)
- Reference and implementation image dimensions: 1536 × 1024 pixels
- Browser viewport: 1536 × 1024 CSS pixels at device pixel ratio 1
- Captured state: Data map, Tool calls, Codex selected, first native local sample, light theme

## Comparison history

### Pass 1

- P2: The centre header and provider rows were too compressed vertically compared with the reference.
- P2: Provider names and native record examples wrapped or clipped in narrower table cells.
- P2: The inspector mapping table pushed the local sample below the 1024-pixel viewport.
- Fixes: increased centre-header and provider-row rhythm, changed provider cells to a vertical mark/name treatment, retuned grid columns, limited the initial mapping list to six rows with an explicit remainder count, and tightened mapping-row spacing so the sample remains visible.

### Final pass

- P0: none
- P1: none
- P2: none
- The full and focused side-by-side comparisons confirm the three-column hierarchy, provider-row density, field-mapping rhythm, and visible sample panel match the selected option closely.

## Required fidelity surfaces

- Typography: retained the explorer's existing system font and weight hierarchy while matching the reference's compact heading, table-label, metric, and code-sample scale.
- Spacing and layout: matched the reference's concept rail, comparison table, fixed inspector, row separators, metric cards, and below-the-fold sample navigation. The required Logs/Data map switch intentionally adds one compact control above the concept list.
- Colours and tokens: reused existing explorer neutrals, blue selection treatment, green recorded status, amber export-required status, and muted borders.
- Image and icon assets: reused existing provider marks and the project's icon library; no new raster assets or approximate drawn icons were introduced.
- Copy and content: replaced illustrative reference values with real normalized local aggregates, explicit metric definitions, honest unsupported/export-required states, native record names, and redacted local samples.

## Interaction and responsive verification

- Verified concept selection, provider selection, native/normalized sample tabs, previous/next sample navigation, URL restoration, Logs return, and Data map return.
- Verified the field inspector as a responsive drawer at 1280 pixels and as a full-width panel at 620 pixels.
- Verified the mobile concept drawer and concept selection at 900 pixels.
- A fresh direct URL load restored Tool calls and Codex without hydration drift.
- Browser console on the fresh verification tab: no errors.

## Intentional differences

- The implementation reports the four providers currently represented in this local index rather than the five illustrative providers in the reference.
- Provider share is concept events divided by all events for that provider, and coverage is indexed providers containing matching events; the labels therefore differ from the reference's illustrative coverage column.
- Unsupported and export-required providers remain visible instead of being assigned fabricated counts.

final result: passed
