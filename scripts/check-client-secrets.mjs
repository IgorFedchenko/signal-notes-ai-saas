import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const secrets = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_DB_URL",
  "OPENAI_API_KEY",
]
  .map((key) => process.env[key])
  .filter((value) => value && value.length >= 12);
const databaseUrl = process.env.SUPABASE_DB_URL;
if (databaseUrl) {
  try {
    const password = decodeURIComponent(new URL(databaseUrl).password);
    if (password.length >= 12) secrets.push(password);
  } catch {
    throw new Error(
      "Invalid database URL supplied to browser secret scan (redacted).",
    );
  }
}
function scan(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) scan(path);
    else {
      const body = readFileSync(path, "utf8");
      if (secrets.some((secret) => body.includes(secret)))
        throw new Error(
          "Server secret found in browser assets (value redacted).",
        );
    }
  }
}
scan(".next/static");
console.log("PASS: configured server secrets are absent from browser assets.");
