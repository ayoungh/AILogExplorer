import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "dist", "packages");
const npmCache = fs.mkdtempSync(path.join(os.tmpdir(), "ai-log-explorer-npm-cache-"));

fs.mkdirSync(outputDirectory, { recursive: true });
for (const entry of fs.readdirSync(outputDirectory)) {
  if (/^ai-log-explorer-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.(?:tgz|manifest\.json|sha256)$/.test(entry)) {
    fs.rmSync(path.join(outputDirectory, entry), { force: true });
  }
}

try {
  const output = execFileSync("npm", ["pack", "--json", "--pack-destination", outputDirectory, "--ignore-scripts"], {
    cwd: root,
    env: { ...process.env, npm_config_cache: npmCache },
    encoding: "utf8",
  });
  const result = JSON.parse(output)[0];
  const tarball = path.join(outputDirectory, result.filename);
  const sha256 = createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
  const base = result.filename.replace(/\.tgz$/, "");
  const manifest = {
    name: result.name,
    version: result.version,
    filename: result.filename,
    sha256,
    packedBytes: result.size,
    unpackedBytes: result.unpackedSize,
    files: result.files.map(({ path: filePath, size, mode }) => ({ path: filePath, size, mode })),
  };
  fs.writeFileSync(path.join(outputDirectory, `${base}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, `${base}.sha256`), `${sha256}  ${result.filename}\n`);
  console.log(`Packed ${result.filename} (${result.files.length} files).`);
  console.log(`SHA-256 ${sha256}`);
} finally {
  fs.rmSync(npmCache, { recursive: true, force: true });
}
