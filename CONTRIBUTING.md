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
- Never include screenshots, screen recordings, or other captured media beyond
  the reviewed root `screenshot.png` showcase asset.
- Replace user names, email addresses, project names, and absolute home paths
  with clearly synthetic values.
- Describe a sensitive-data bug without attaching the affected source data.

The four provider-native files under `examples/provider-native` are generated
from `scripts/example-fixtures.mjs` and, together with the reviewed root
`screenshot.png` showcase asset, are the only exceptions to the private
file-format block. Do not edit the generated fixtures directly or add another
exception. Update the canonical synthetic definitions, run
`pnpm examples:generate`, and confirm `pnpm examples:check` instead. Real
histories remain prohibited even when they have been redacted.

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
type checking and linting, executes the test suite, creates a production
build, and validates the staged npm runtime and package manifest.

Keep changes focused and add or update tests when behavior changes.

## npm package verification

The public npm package contains only the foreground CLI, README, license, and a
staged production Next.js build. It deliberately does not contain source
histories, examples, screenshots, tests, development configuration, or native
SQLite binaries. `better-sqlite3` remains a normal dependency so npm installs
the correct binary for each Mac.

Before proposing a package release, run:

```bash
pnpm build
pnpm package:pack
```

The staging and package checks remove development-only Next.js output, sanitize
build-root metadata, inspect every staged file, and verify the `npm pack`
manifest against a strict allowlist. Never bypass these checks or publish a
tarball produced from an unreviewed working tree.

Publishing is intentionally separate from packaging. Do not publish, tag, or
create a release from a development task. The protected GitHub workflow tests
the same tarball on Apple Silicon and Intel macOS before an approved npm
publish. The initial package publication requires the maintainer's npm account;
subsequent releases should use npm trusted publishing and provenance.
