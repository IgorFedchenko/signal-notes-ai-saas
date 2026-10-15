import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const generated = "# GENERATED LOCAL SIGNAL NOTES";
const setting =
  /^(NEXT_PUBLIC_SUPABASE_|SUPABASE_|APP_URL$|AI_|OPENAI_|STRIPE_|OTEL_)/;

// Fail before dependency installation, child processes or sockets. Shell settings
// override dotenv in Node/Next; local entry points must never inherit owner config.
export function assertBootstrapEnvironment(env = process.env) {
  // Next selects test dotenv files from NODE_ENV even when running `next dev`.
  if (env.NODE_ENV !== undefined && env.NODE_ENV !== "development")
    throw new Error("local_environment_mode");
  if (Object.keys(env).some((key) => setting.test(key) && env[key]))
    throw new Error("local_environment_override");
  for (const path of [".env", ".env.development", ".env.development.local"])
    if (existsSync(path)) throw new Error("owner_managed_environment");
  if (
    existsSync(".env.local") &&
    !readFileSync(".env.local", "utf8").startsWith(generated)
  )
    throw new Error("owner_managed_environment");
}

export function assertDedicatedStack(env) {
  const db = new URL(env.SUPABASE_DB_URL);
  if (
    env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56321" ||
    db.protocol !== "postgresql:" ||
    db.hostname !== "127.0.0.1" ||
    db.port !== "56322" ||
    db.pathname !== "/postgres" ||
    db.search ||
    db.hash ||
    !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new Error("dedicated_stack_required");
}

export function localAppEnvironment(phoenix, inherited = process.env) {
  const local = parseEnv(readFileSync(".env.local", "utf8"));
  assertDedicatedStack(local);
  const env = Object.fromEntries(
    Object.entries(inherited).filter(([key]) => !setting.test(key)),
  );
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DB_URL",
  ])
    env[key] = local[key];
  return {
    ...env,
    NODE_ENV: "development",
    APP_URL: "http://127.0.0.1:3210",
    AI_PROVIDER: "fixture",
    AI_LIVE_APPROVED: "false",
    STRIPE_WEBHOOK_SECRET: "whsec_local_test_fixture_only",
    ...(phoenix
      ? {
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
            "http://127.0.0.1:56006/v1/traces",
        }
      : {}),
  };
}
