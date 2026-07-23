# AI Log Explorer

AI Log Explorer is an open-source, local-only Next.js app for exploring AI
conversation and agent histories without uploading them.

It currently understands histories from:

- Claude Code
- Claude Desktop
- Codex
- Cursor
- Official ChatGPT exports
- Official Claude exports

## Privacy model

AI histories can contain highly sensitive material. AI Log Explorer keeps that
material on your Mac:

- The server binds to `127.0.0.1` and rejects non-loopback requests.
- Source histories are opened read-only.
- The generated search index stays in `.data/ailogexplorer.sqlite`.
- `.data`, log exports, databases, screenshots, and generated files are
  excluded from Git.
- There is no telemetry, analytics, cloud storage, remote font, or hosted model
  request.

The local index contains normalized events, searchable text, source paths, and
compressed raw records. Treat it as private. Use **Clear local index** in the
app to remove indexed data, or delete the `.data` directory while the app is
stopped.

ChatGPT's encrypted `conversations-v3/*.data` desktop cache is detected but
never decrypted. Use an official ChatGPT data export instead.

> [!WARNING]
> AI Log Explorer is designed for one trusted user on a local Mac. Do not
> deploy it as a public or remotely accessible web service. Open source code is
> not the same as a safe public deployment.

## Requirements

- macOS
- Node.js 24
- pnpm 10

If you use `nvm`, the repository includes the expected Node version:

```bash
nvm use
```

## Run

```bash
pnpm install
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Use **Scan Mac** to index registered local history locations, or **Import
files** for JSON, JSONL, Cursor SQLite databases, and official export JSON. File
imports are copied to a temporary directory for parsing and removed when the
job finishes.

For a production build:

```bash
pnpm build
pnpm start
```

The production server also binds to loopback.

## Verification

Run the complete public-release gate:

```bash
pnpm verify
```

Or run checks individually:

```bash
pnpm check:public
pnpm audit --prod
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`check:public` examines tracked files and untracked files that are not ignored.
It rejects common AI-log exports, databases, screenshots, personal home paths,
non-example email addresses, and credential formats before they can be
published.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, verification, and the
synthetic-data policy. Report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md).

The app includes streaming provider adapters, cancellable persisted jobs,
idempotent rescans, Brotli-compressed raw and large normalized payloads, FTS5
search, diagnostics, pagination, responsive drawers, URL-addressable selection
and filters, and normalized/raw event inspection.

## License

AI Log Explorer is available under the [MIT License](LICENSE).
