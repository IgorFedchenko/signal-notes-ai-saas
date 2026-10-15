// This is an operational acceptance script. Run only on an isolated CI runner or
// under the host heavy-job wrapper: it owns the dedicated local stack and app.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { localAppEnvironment } from "./local-environment.mjs";
const evidence = [];
const initialSmoke = readFileSync("test-results/launcher-smoke.json", "utf8");
writeFileSync("test-results/launcher-phoenix-smoke.json", initialSmoke);
function closed() {
  const r = spawnSync(process.execPath, ["scripts/check-stopped.mjs"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, "Owned ports must close");
}
async function launchAndInterrupt(phase) {
  const child = spawn(process.execPath, ["scripts/demo.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    signaled = false,
    exited = false;
  const completion = new Promise((resolve) =>
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    }),
  );
  child.stdout.on("data", (bytes) => {
    output += bytes.toString();
    if (
      phase === "startup" &&
      !signaled &&
      output.includes("Starting dedicated Supabase stack")
    ) {
      signaled = true;
      child.kill("SIGINT");
    }
  });
  child.stderr.on("data", (bytes) => {
    output += bytes.toString();
  });
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, 180000);
  try {
    if (phase === "ready") {
      const deadline = Date.now() + 120000;
      let ready = false;
      while (Date.now() < deadline && !exited) {
        ready = !!(
          await fetch("http://127.0.0.1:3210/login", {
            signal: AbortSignal.timeout(1000),
          }).catch(() => null)
        )?.ok;
        if (ready) break;
        await delay(250);
      }
      assert.equal(
        ready,
        true,
        "Actual app readiness required before interrupt",
      );
      const smoke = spawnSync(process.execPath, ["scripts/local-smoke.mjs"], {
        env: localAppEnvironment(false),
        encoding: "utf8",
        timeout: 60000,
      });
      assert.equal(
        smoke.status,
        0,
        "Restarted app must pass real Auth/HTTP/DB smoke",
      );
      signaled = true;
      child.kill("SIGINT");
    }
    const result = await completion;
    assert.equal(signaled, true);
    assert.equal(result.code, 0);
    closed();
    evidence.push({
      phase,
      signal: "SIGINT",
      exit: result.code,
      portsClosed: true,
      realSmoke: phase === "ready",
    });
  } finally {
    clearTimeout(timeout);
    if (!exited) {
      child.kill("SIGINT");
      await completion;
    }
  }
}
closed();
await launchAndInterrupt("startup");
await launchAndInterrupt("ready");
const restart = spawnSync("npm", ["run", "demo", "--", "--smoke"], {
  encoding: "utf8",
  timeout: 180000,
});
assert.equal(restart.status, 0, "Whole documented restart command");
closed();
const before = readFileSync(".env.local", "utf8");
// Real launcher must reject an owner-managed file without touching it or sockets.
// Save only the generated test-owned file, never an owner's configuration.
assert.ok(before.startsWith("# GENERATED LOCAL SIGNAL NOTES"));
const sentinel =
  "# synthetic owner-managed dotenv sentinel\nOWNER_SENTINEL=synthetic-only\n";
try {
  writeFileSync(".env.local", sentinel, { mode: 0o600 });
  const rejected = spawnSync("npm", ["run", "demo", "--", "--smoke"], {
    encoding: "utf8",
    timeout: 10000,
  });
  assert.notEqual(rejected.status, 0);
  assert.equal(readFileSync(".env.local", "utf8"), sentinel);
  closed();
  evidence.push({
    phase: "owner-file-guard",
    rejected: true,
    bytePreserved: true,
    portsClosed: true,
  });
} finally {
  writeFileSync(".env.local", before, { mode: 0o600 });
}
mkdirSync("test-results", { recursive: true });
writeFileSync(
  "test-results/launcher-lifecycle.json",
  JSON.stringify(
    {
      pass: true,
      evidence,
      restart: { exit: restart.status, portsClosed: true },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    event: "launcher_lifecycle_passed",
    checks: evidence.length + 1,
  }),
);
