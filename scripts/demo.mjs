import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const capture = process.argv.includes("--capture");
const smoke = process.argv.includes("--smoke") || capture;
const phoenix = process.argv.includes("--phoenix");
const children = new Set();
let stopping = false;
let ownsStack = false;
let ownsPhoenix = false;
function launch(command, args, env = process.env) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env,
    detached: process.platform !== "win32",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}
async function run(command, args) {
  const child = launch(command, args);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  if (code !== 0) throw new Error("local_command_failed");
}
function stopChild(child, signal = "SIGTERM") {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    /* Already exited. */
  }
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const owned = [...children];
  for (const child of owned) stopChild(child);
  await Promise.all(
    owned.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode) return resolve();
          child.once("exit", resolve);
          setTimeout(() => {
            stopChild(child, "SIGKILL");
            resolve();
          }, 5000).unref();
        }),
    ),
  );
  // Only our dedicated project stack/profile is stopped; no broad Docker cleanup.
  if (ownsStack && existsSync("node_modules/supabase"))
    await run("npx", ["--no-install", "supabase", "stop", "--no-backup"]).catch(
      () => {
        process.exitCode = 1;
      },
    );
  if (ownsPhoenix)
    await run("docker", [
      "compose",
      "--profile",
      "observability",
      "down",
    ]).catch(() => {
      process.exitCode = 1;
    });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void shutdown();
  });
try {
  if (!existsSync("node_modules/next"))
    await run("npm", ["ci", "--no-audit", "--no-fund"]);
  if (stopping) throw new Error("stopped");
  if (
    existsSync(".env.local") &&
    !readFileSync(".env.local", "utf8").includes(
      "# GENERATED LOCAL SIGNAL NOTES",
    )
  )
    throw new Error("owner_managed_environment");
  ownsStack = true;
  await run(process.execPath, ["scripts/local-setup.mjs"]);
  if (stopping) throw new Error("stopped");
  if (phoenix) {
    ownsPhoenix = true;
    await run("docker", [
      "compose",
      "--profile",
      "observability",
      "up",
      "-d",
      "--wait",
    ]);
  }
  if (stopping) throw new Error("stopped");
  const app = launch("npm", ["run", "dev"], {
    ...process.env,
    AI_PROVIDER: "fixture",
    AI_LIVE_APPROVED: "false",
    ...(phoenix
      ? {
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
            "http://127.0.0.1:56006/v1/traces",
        }
      : {}),
  });
  console.log(
    "Signal Notes → http://127.0.0.1:3210 · synthetic login in README · Ctrl+C stops this app and its stack.",
  );
  const deadline = Date.now() + 90000;
  let ready = false;
  while (!stopping && Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error("app_exited_before_ready");
    try {
      ready = (
        await fetch("http://127.0.0.1:3210/login", {
          signal: AbortSignal.timeout(2000),
        })
      ).ok;
    } catch {
      /* Readiness, bounded below. */
    }
    if (ready) break;
    await delay(500);
  }
  if (!ready) throw new Error("app_readiness_timeout");
  if (capture) {
    await run("npx", ["--no-install", "playwright", "install", "chromium"]);
    await run(process.execPath, [
      "--env-file=.env.local",
      "scripts/capture-demo.mjs",
    ]);
  }
  if (smoke) {
    await run(process.execPath, [
      "--env-file=.env.local",
      "scripts/local-smoke.mjs",
      ...(phoenix ? ["--phoenix"] : []),
    ]);
    await shutdown();
  } else
    await new Promise((resolve) => {
      if (app.exitCode !== null) resolve();
      else app.once("exit", resolve);
    });
} catch {
  if (!stopping) {
    console.error(
      "Local demo failed; check Docker readiness and dedicated ports. Owner-managed .env.local is never overwritten.",
    );
    process.exitCode = 1;
  }
} finally {
  await shutdown();
}
