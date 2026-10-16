import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const directory = mkdtempSync(join(tmpdir(), "signal-secret-detector-"));
try {
  // A generated synthetic canary, never an account credential or a real API call.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const suffix = new Set();
  while (suffix.size < 16)
    suffix.add(alphabet[randomBytes(1)[0] % alphabet.length]);
  const canary = "AKIA" + [...suffix].join("");
  writeFileSync(join(directory, "canary.env"), `AWS_ACCESS_KEY_ID=${canary}\n`);
  const result = spawnSync(
    "gitleaks",
    ["dir", directory, "--redact", "--no-banner", "--exit-code=23"],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    23,
    "OSS scanner must reject a synthetic secret twin",
  );
  console.log("PASS: OSS scanner rejects synthetic secret canary (redacted).");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
