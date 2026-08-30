import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpmLauncher = path.join(path.dirname(process.execPath), process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const pnpmCli = fs.realpathSync(pnpmLauncher);
const commands = [
  [npm, "run", "examples:check"],
  [npm, "run", "check:public"],
  [process.execPath, pnpmCli, "audit", "--prod"],
  [npm, "run", "typecheck"],
  [npm, "run", "lint"],
  [npm, "run", "test"],
  [npm, "run", "build"],
  [npm, "run", "package:stage"],
  [npm, "run", "package:check"],
];

for (const [command, ...args] of commands) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const env = command === process.execPath
    ? Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_")))
    : process.env;
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
