# Contributing

Thanks for helping improve AI Log Explorer.

## Development setup

You need macOS, Node.js 24, and pnpm 10.

```bash
nvm use
pnpm install
pnpm dev
```

The development server is available only at
[http://127.0.0.1:3000](http://127.0.0.1:3000).

## Privacy requirements

AI histories routinely contain names, messages, local paths, credentials, and
other private information. Contributions must therefore:

- Use only synthetic data in tests, examples, bug reports, and documentation.
- Never include real AI logs, exports, SQLite databases, environment files, or
  credentials.
- Never include screenshots, screen recordings, or other captured media.
- Replace user names, email addresses, project names, and absolute home paths
  with clearly synthetic values.
- Describe a sensitive-data bug without attaching the affected source data.

The four provider-native files under `examples/provider-native` are generated
from `scripts/example-fixtures.mjs` and are the only exceptions to the private
file-format block. Do not edit them directly or add another exception. Update
the canonical synthetic definitions, run `pnpm examples:generate`, and confirm
`pnpm examples:check` instead. Real histories remain prohibited even when they
have been redacted.

The repository ignores common private formats and `pnpm check:public` scans
every file that could be committed. If a future contribution genuinely needs a
binary fixture or product image, discuss a narrowly scoped, sanitized
allowlist in an issue before adding it.

## Verification

Run the complete release gate before opening a pull request:

```bash
pnpm verify
```

This checks the candidate public tree, audits production dependencies, runs
type checking and linting, executes the test suite, and creates a production
build.

Keep changes focused and add or update tests when behavior changes.
