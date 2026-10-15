import { expect, it, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  assertBootstrapEnvironment,
  assertDedicatedStack,
  localAppEnvironment,
} from "../../scripts/local-environment.mjs";
vi.mock("node:fs", () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }));
const realFs = await vi.importActual("node:fs");
const local = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-anon",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  SUPABASE_DB_URL: "postgresql://postgres:synthetic@127.0.0.1:56322/postgres",
};
beforeEach(() => {
  vi.clearAllMocks();
  existsSync.mockReturnValue(false);
});
it("rejects inherited hosted/live overrides before launcher processes or sockets", async () => {
  const source = realFs
    .readFileSync("scripts/demo.mjs", "utf8")
    .replace(/^import[\s\S]*?;\n/gm, "");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const execute = new AsyncFunction(
    "spawn",
    "existsSync",
    "delay",
    "process",
    "fetch",
    "console",
    "assertBootstrapEnvironment",
    "localAppEnvironment",
    source,
  );
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.example.invalid",
    SUPABASE_DB_URL:
      "postgresql://synthetic@synthetic.example.invalid/postgres",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-hosted-service",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
      "https://synthetic.example.invalid/v1/traces",
    STRIPE_SECRET_KEY: "sk_live_synthetic",
    OPENAI_API_KEY: "synthetic-key",
    AI_LIVE_APPROVED: "true",
  })) {
    const fakeProcess = {
      argv: [],
      env: { [key]: value },
      on() {},
      exitCode: 0,
    };
    const spawn = vi.fn(),
      fetch = vi.fn();
    await execute(
      spawn,
      existsSync,
      vi.fn(),
      fakeProcess,
      fetch,
      { error() {}, log() {} },
      () => assertBootstrapEnvironment(fakeProcess.env),
      localAppEnvironment,
    );
    expect(fakeProcess.exitCode, key).toBe(1);
    expect(spawn, key).not.toHaveBeenCalled();
    expect(fetch, key).not.toHaveBeenCalled();
  }
});
it("protects owner dotenv files and only accepts exact dedicated connection targets", () => {
  existsSync.mockImplementation((path) => path === ".env.local");
  readFileSync.mockReturnValue("# owner-managed synthetic file\n");
  expect(() => assertBootstrapEnvironment({})).toThrow(
    "owner_managed_environment",
  );
  expect(readFileSync).toHaveBeenCalledTimes(1);
  existsSync.mockImplementation((path) => path === ".env.development.local");
  expect(() => assertBootstrapEnvironment({})).toThrow(
    "owner_managed_environment",
  );
  expect(() => assertDedicatedStack(local)).not.toThrow();
  expect(() =>
    assertDedicatedStack({
      ...local,
      SUPABASE_DB_URL:
        "postgresql://synthetic@external.example.invalid:56322/postgres",
    }),
  ).toThrow("dedicated_stack_required");
});
it("constructs one controlled child environment from verified local stack values", () => {
  readFileSync.mockReturnValue(
    `# GENERATED LOCAL SIGNAL NOTES\n${Object.entries(local)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\nSTRIPE_SECRET_KEY=sk_live_synthetic_file_marker\n`,
  );
  const env = localAppEnvironment(false, {
    PATH: "/synthetic/bin",
    OPENAI_API_KEY: "synthetic-key",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://synthetic.example.invalid",
    SUPABASE_DB_URL: "postgresql://synthetic@external.example.invalid/postgres",
  });
  expect(env).toMatchObject({
    ...local,
    AI_PROVIDER: "fixture",
    AI_LIVE_APPROVED: "false",
    APP_URL: "http://127.0.0.1:3210",
    PATH: "/synthetic/bin",
  });
  expect(env.OPENAI_API_KEY).toBeUndefined();
  expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  expect(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBeUndefined();
  expect(localAppEnvironment(true, {}).OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBe(
    "http://127.0.0.1:56006/v1/traces",
  );
});
