import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextDirectory = path.join(root, ".next");
const stageRoot = path.join(root, "dist", "app");
const stageNext = path.join(stageRoot, ".next");
const excludedTopLevel = new Set(["build", "cache", "dev", "diagnostics", "node_modules", "trace", "trace-build", "turbopack", "types"]);

if (!fs.existsSync(path.join(nextDirectory, "BUILD_ID"))) {
  throw new Error("Missing production .next/BUILD_ID. Run `pnpm build` before staging the package.");
}

fs.rmSync(stageRoot, { recursive: true, force: true });
fs.mkdirSync(stageNext, { recursive: true });
fs.mkdirSync(path.join(root, "dist", "packages"), { recursive: true });

fs.cpSync(nextDirectory, stageNext, {
  recursive: true,
  filter(source) {
    const relative = path.relative(nextDirectory, source);
    if (!relative) return true;
    if (source.endsWith(".map")) return false;
    return !excludedTopLevel.has(relative.split(path.sep)[0]);
  },
});

const sourceAliasesDirectory = path.join(nextDirectory, "node_modules");
const sqliteAliases = fs.existsSync(sourceAliasesDirectory)
  ? fs.readdirSync(sourceAliasesDirectory).filter((name) => /^better-sqlite3-[a-f0-9]+$/.test(name))
  : [];
if (sqliteAliases.length > 1) throw new Error(`Expected at most one generated better-sqlite3 alias, found ${sqliteAliases.length}.`);
if (sqliteAliases.length === 1) {
  const sqliteAlias = sqliteAliases[0];
  const aliasDirectory = path.join(stageNext, "node_modules", sqliteAlias);
  fs.mkdirSync(aliasDirectory, { recursive: true });
  fs.writeFileSync(path.join(aliasDirectory, "package.json"), JSON.stringify({ name: sqliteAlias, private: true, main: "index.js" }));
  fs.writeFileSync(path.join(aliasDirectory, "index.js"), 'module.exports = require("better-sqlite3");\n');
}

const publicDirectory = path.join(root, "public");
if (fs.existsSync(publicDirectory)) fs.cpSync(publicDirectory, path.join(stageRoot, "public"), { recursive: true });

function sanitizeBuildRoot(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) sanitizeBuildRoot(absolute);
    else if (entry.isFile()) {
      const buffer = fs.readFileSync(absolute);
      if (!buffer.includes(0)) {
        const content = buffer.toString("utf8");
        if (content.includes(root)) fs.writeFileSync(absolute, content.replaceAll(root, "."));
      }
    }
  }
}
sanitizeBuildRoot(stageRoot);

const manifestPath = path.join(stageNext, "required-server-files.json");
if (!fs.existsSync(manifestPath)) throw new Error("The Next.js build is missing required-server-files.json.");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.appDir = ".";
manifest.relativeAppDir = "";
if (manifest.config) {
  manifest.config.outputFileTracingRoot = ".";
  if (manifest.config.turbopack) manifest.config.turbopack.root = ".";
}
const serializedManifest = JSON.stringify(manifest);
fs.writeFileSync(manifestPath, serializedManifest);
fs.writeFileSync(path.join(stageNext, "required-server-files.js"), `self.__SERVER_FILES_MANIFEST=${serializedManifest}`);

console.log(`Staged npm runtime at ${path.relative(root, stageRoot)}.`);
