import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "signal-gates-")),
  root = process.cwd();
const results = {
  hookBadExit: null,
  hookCorrectedExit: null,
  bundleCleanExit: null,
  bundleCanaryExit: null,
};
const run = (args, cwd) =>
  spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HUSKY: "0" },
  });
try {
  const clone = join(temp, "clone");
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", root, clone]);
  symlinkSync(resolve("node_modules"), join(clone, "node_modules"), "dir");
  execFileSync("npm", ["run", "hooks:install"], {
    cwd: clone,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Synthetic Gate Check"], {
    cwd: clone,
  });
  execFileSync("git", ["config", "user.email", "gate@signal.local"], {
    cwd: clone,
  });
  const staged = join(clone, "tests", "portable-hook-control.ts");
  writeFileSync(staged, "export const control= 1\n");
  execFileSync("git", ["add", "tests/portable-hook-control.ts"], {
    cwd: clone,
  });
  const bad = run(
    ["git", "commit", "-m", "Synthetic invalid format control"],
    clone,
  );
  results.hookBadExit = bad.status;
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr + bad.stdout, /Format the staged file/);
  writeFileSync(staged, "export const control = 1;\n");
  execFileSync("git", ["add", "tests/portable-hook-control.ts"], {
    cwd: clone,
  });
  const good = run(
    ["git", "commit", "-m", "Synthetic corrected format control"],
    clone,
  );
  results.hookCorrectedExit = good.status;
  if (good.status !== 0) console.error(good.stdout + good.stderr);
  assert.equal(good.status, 0);
  // Scanner runs against a temporary browser asset tree; no production output edit.
  const bundle = join(temp, "bundle");
  mkdirSync(join(bundle, ".next", "static"), { recursive: true });
  cpSync("scripts/check-client-secrets.mjs", join(bundle, "scan.mjs"));
  const canary = "SYNTHETIC_BROWSER_SECRET_CANARY_2026",
    env = {
      ...process.env,
      OPENAI_API_KEY: canary,
      SUPABASE_DB_URL:
        "postgresql://synthetic:DB_PASSWORD_CANARY_2026@127.0.0.1:56322/postgres",
    };
  writeFileSync(
    join(bundle, ".next", "static", "client.js"),
    "console.log('public asset');\n",
  );
  const clean = spawnSync(process.execPath, ["scan.mjs"], {
    cwd: bundle,
    encoding: "utf8",
    env,
  });
  results.bundleCleanExit = clean.status;
  assert.equal(clean.status, 0);
  writeFileSync(
    join(bundle, ".next", "static", "client.js.map"),
    JSON.stringify({ sourcesContent: [canary] }),
  );
  const badBundle = spawnSync(process.execPath, ["scan.mjs"], {
    cwd: bundle,
    encoding: "utf8",
    env,
  });
  results.bundleCanaryExit = badBundle.status;
  assert.notEqual(badBundle.status, 0);
  assert.match(badBundle.stderr, /Server secret found/);
  assert.ok(!badBundle.stderr.includes(canary));
  writeFileSync(
    join(bundle, ".next", "static", "client.js.map"),
    JSON.stringify({ sourcesContent: ["DB_PASSWORD_CANARY_2026"] }),
  );
  const passwordLeak = spawnSync(process.execPath, ["scan.mjs"], {
    cwd: bundle,
    encoding: "utf8",
    env,
  });
  results.bundlePasswordCanaryExit = passwordLeak.status;
  assert.notEqual(
    passwordLeak.status,
    0,
    "A password-only leak must also be detected",
  );
  assert.match(passwordLeak.stderr, /Server secret found/);
  assert.ok(!passwordLeak.stderr.includes("DB_PASSWORD_CANARY_2026"));
  assert.equal(readFileSync(staged, "utf8"), "export const control = 1;\n");
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/repository-gates.json",
    JSON.stringify(
      {
        pass: true,
        ...results,
        boundary:
          "real disposable git hook commits and client-asset scanner; no heavy jobs",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ event: "repository_gates_passed", ...results }));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
