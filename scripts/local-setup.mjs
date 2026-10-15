import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Use only this project's dedicated stack. Never overwrite an owner's hosted env.
if (existsSync(".env.local")) {
  const old = readFileSync(".env.local", "utf8");
  if (!old.includes("# GENERATED LOCAL SIGNAL NOTES")) {
    throw new Error(
      "Existing .env.local is owner-managed. Use npm run dev, or move it aside to start the local demo.",
    );
  }
}
function run(args, capture = false) {
  const result = spawnSync("npx", ["--no-install", "supabase", ...args], {
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(
      `Supabase ${args[0]} failed; inspect local Docker readiness.`,
    );
  return result.stdout;
}
console.log(
  "Starting dedicated Supabase stack (first run downloads Docker images)…",
);
run(
  [
    "start",
    "-x",
    "studio,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor",
  ],
  true,
);
run(["migration", "up", "--local"]);
const env = JSON.parse(run(["status", "-o", "json"], true));
const contents = `# GENERATED LOCAL SIGNAL NOTES — local test credentials only\nNEXT_PUBLIC_SUPABASE_URL=${env.API_URL}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${env.ANON_KEY}\nSUPABASE_SERVICE_ROLE_KEY=${env.SERVICE_ROLE_KEY}\nSUPABASE_DB_URL=${env.DB_URL}\nAPP_URL=http://127.0.0.1:3210\nAI_PROVIDER=fixture\nSTRIPE_WEBHOOK_SECRET=whsec_local_test_fixture_only\n`;
writeFileSync(".env.local", contents, { mode: 0o600 });
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const email = "demo@signal.local";
const { data: users, error: usersError } = await admin.auth.admin.listUsers();
if (usersError) throw new Error("Cannot inspect local demo users.");
let user = users.users.find((u) => u.email === email);
if (!user) {
  const result = await admin.auth.admin.createUser({
    email,
    password: "SignalNotes-Demo-2026!",
    email_confirm: true,
  });
  if (result.error) throw new Error("Cannot create synthetic demo user.");
  user = result.data.user;
}
const { count } = await admin
  .from("notes")
  .select("*", { count: "exact", head: true })
  .eq("user_id", user.id);
if (count === 0) {
  const { error } = await admin.from("notes").insert({
    user_id: user.id,
    title: "Product launch · team notes",
    content:
      "The team will launch the new workspace on November 12. The beta includes private notes, concise summaries, and a monthly usage dashboard. Maya owns onboarding and will prepare a welcome guide by Friday. Theo will run the accessibility review before the release. The main risk is confusing billing limits, so the team agreed to show remaining summaries beside the action button. The next review is on Monday.",
  });
  if (error) throw new Error("Cannot seed synthetic note.");
}
console.log(
  "Local Supabase ready. Fixture summaries enabled. No Stripe or LLM network calls.",
);
