import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const helperUrl = new URL(
  "../../scripts/local-environment.mjs",
  import.meta.url,
).href;
const nextEnvPath = require.resolve("@next/env");
// Isolate Next's process-wide dotenv cache and environment in a small Node child.
// This only loads configuration: no Next server/build, provider or network call.
const probe = `
import { Socket } from "node:net";
import nextEnv from ${JSON.stringify(nextEnvPath)};
import { assertBootstrapEnvironment, localAppEnvironment } from ${JSON.stringify(helperUrl)};
let sockets = 0;
Socket.prototype.connect = function () { sockets++; throw new Error("network_forbidden"); };
const [dir, action] = process.argv.slice(1);
process.chdir(dir);
let loaderCalled = false;
try {
  if (action === "guarded") {
    assertBootstrapEnvironment();
    process.env = localAppEnvironment(false);
  }
  loaderCalled = true;
  nextEnv.loadEnvConfig(dir, true, { info() {}, error() { throw new Error("dotenv_load_failed"); } });
  console.log(JSON.stringify({
    status: "loaded", loaderCalled, sockets, mode: process.env.NODE_ENV,
    externalOtlp: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT === "https://synthetic.example.invalid/v1/traces",
    liveStripe: process.env.STRIPE_SECRET_KEY === "sk_live_synthetic_file_marker",
    localSupabase: process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:56321",
  }));
} catch (error) {
  if (error.message !== "local_environment_mode") throw error;
  console.log(JSON.stringify({ status: "rejected", loaderCalled, sockets }));
}
`;

it("guards the actual Next dotenv mode and preserves excluded owner test files", () => {
  const dir = mkdtempSync(join(tmpdir(), "signal-notes-dotenv-"));
  const generated = `# GENERATED LOCAL SIGNAL NOTES — synthetic fixture only
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=synthetic-anon
SUPABASE_SERVICE_ROLE_KEY=synthetic-service
SUPABASE_DB_URL=postgresql://postgres:synthetic@127.0.0.1:56322/postgres
`;
  const ownerTest = `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://synthetic.example.invalid/v1/traces
STRIPE_SECRET_KEY=sk_live_synthetic_file_marker
`;
  const files = {
    ".env.local": generated,
    ".env.test.local": ownerTest,
    ".env.test": "STRIPE_PRO_PRICE_ID=synthetic-owner-price\n",
  };
  try {
    for (const [name, contents] of Object.entries(files))
      writeFileSync(join(dir, name), contents);
    function run(mode, action) {
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "--eval", probe, dir, action],
        {
          env: mode === undefined ? {} : { NODE_ENV: mode },
          encoding: "utf8",
          timeout: 10000,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout);
    }
    // Positive control: the real installed Next loader reproduces the excluded
    // settings if test mode is allowed through. This never opens a socket.
    expect(run("test", "unguarded")).toMatchObject({
      status: "loaded",
      loaderCalled: true,
      sockets: 0,
      mode: "test",
      externalOtlp: true,
      liveStripe: true,
    });
    // The actual guard now stops this mode before the real loader can run.
    expect(run("test", "guarded")).toEqual({
      status: "rejected",
      loaderCalled: false,
      sockets: 0,
    });
    for (const mode of [undefined, "development"])
      expect(run(mode, "guarded")).toEqual({
        status: "loaded",
        loaderCalled: true,
        sockets: 0,
        mode: "development",
        externalOtlp: false,
        liveStripe: false,
        localSupabase: true,
      });
    for (const [name, contents] of Object.entries(files))
      expect(readFileSync(join(dir, name), "utf8")).toBe(contents);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
