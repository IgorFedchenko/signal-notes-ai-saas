import { assertDedicatedStack } from "./local-environment.mjs";
import assert from "node:assert/strict";
import { chromium, devices } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

assertDedicatedStack(process.env);
if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0)
  throw new Error("Install ffmpeg to encode the genuine browser recording.");
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const email = "tour@signal.local",
  password = "Synthetic-Tour-Password-2026!";
const old = (await admin.auth.admin.listUsers()).data.users.find(
  (user) => user.email === email,
);
if (old) await admin.auth.admin.deleteUser(old.id);
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
assert.ok(created.data.user);
const userId = created.data.user.id;
mkdirSync("demos/raw", { recursive: true });
const browser = await chromium.launch();
// Compile the development route using a real synthetic login before recording.
// The recorded context still signs in normally; no responses or identities change.
const warm = await browser.newContext();
try {
  const login = await warm.request.post("http://127.0.0.1:3210/api/auth", {
    headers: { Origin: "http://127.0.0.1:3210" },
    data: { action: "login", email, password },
  });
  assert.equal(login.status(), 200);
  const warmPage = await warm.newPage();
  await warmPage.goto("http://127.0.0.1:3210/workspace");
  await warmPage.getByLabel("Note title").waitFor();
} finally {
  await warm.close();
}
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  recordVideo: { dir: "demos/raw", size: { width: 1280, height: 1000 } },
});
const page = await context.newPage();
const video = page.video();
try {
  await page.goto("http://127.0.0.1:3210/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/workspace");
  await page.getByLabel("Note title").fill("Launch decision · November 2");
  await page
    .getByLabel("Your note", { exact: true })
    .fill(
      "The team approved the launch. The launch date is 2026-11-02. Mira owns the launch. The launch budget is 120 USD.",
    );
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page
    .getByRole("button", { name: "Summarize note", exact: true })
    .click();
  await page.locator(".summary-text").waitFor();
  await page.getByText("Evidence", { exact: true }).first().click();
  await page.locator(".summary-panel").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);
  await page.screenshot({
    path: "docs/screenshots/workspace.png",
    fullPage: true,
  });
  const mobile = await browser.newContext({
    ...devices["iPhone 13"],
    storageState: await context.storageState(),
  });
  try {
    const phone = await mobile.newPage();
    await phone.goto("http://127.0.0.1:3210/workspace");
    await phone.locator(".summary-text").waitFor();
    for (const disclosure of await phone
      .locator(".takeaway details summary")
      .all())
      await disclosure.click();
    assert.equal(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await phone.screenshot({
      path: "docs/screenshots/mobile.png",
      fullPage: true,
    });
  } finally {
    await mobile.close();
  }
  await page.getByRole("button", { name: "Usage & activity" }).click();
  await page.waitForTimeout(1400);
  await page.getByRole("button", { name: "Plan & billing" }).click();
  await page.waitForTimeout(1400);
} finally {
  await context.close();
  await browser.close();
  await admin.auth.admin.deleteUser(userId);
}
const path = await video.path();
const encoded = spawnSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    path,
    "-filter_complex",
    "[0:v]fps=8,scale=1024:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
    "-loop",
    "0",
    "demos/signal-notes.gif",
  ],
  { stdio: "inherit" },
);
assert.equal(encoded.status, 0, "GIF encoding must complete");
console.log(
  "Saved demos/signal-notes.gif from genuine synthetic browser interaction.",
);
