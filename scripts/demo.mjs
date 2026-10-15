import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (!existsSync("node_modules/next")) {
  const install = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], {
    stdio: "inherit",
  });
  if (install.status !== 0) process.exit(1);
}
const setup = spawnSync(process.execPath, ["scripts/local-setup.mjs"], {
  stdio: "inherit",
  env: process.env,
});
if (setup.status !== 0) process.exit(1);
console.log(
  "\nSignal Notes → http://127.0.0.1:3210\nDemo login: demo@signal.local / SignalNotes-Demo-2026!\n",
);
const app = spawn("npm", ["run", "dev"], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => app.kill(signal));
app.on("exit", (code) => process.exit(code ?? 0));
