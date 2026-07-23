# Synthetic example logs

`provider-native` contains one generated, fictional session for each of Codex,
Claude Code, Claude Desktop, and Cursor.

To try them:

1. Run AI Log Explorer.
2. Choose **Import files**.
3. Select all four files in `provider-native`.

They use the providers' native formats, so the normal adapters parse them. No
real log content was copied into the fixtures: prompts, outputs, paths, project
names, identifiers, timestamps, and model names are synthetic.

The files are generated from `scripts/example-fixtures.mjs`. Run
`pnpm examples:generate` after changing the definitions and
`pnpm examples:check` to verify that the committed files match exactly.
