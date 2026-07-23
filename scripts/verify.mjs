import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const commands = [
  ["check:public"],
  ["audit", "--prod"],
  ["typecheck"],
  ["lint"],
  ["test"],
  ["build"],
];

for (const args of commands) {
  console.log(`\n> pnpm ${args.join(" ")}`);
  const result = spawnSync(pnpm, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
