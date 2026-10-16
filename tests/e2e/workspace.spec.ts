import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import dataset from "../../evals/dataset.json";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
if (supabaseUrl !== "http://127.0.0.1:56321")
  throw new Error("E2E requires the dedicated local Supabase stack.");
const admin = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const users: string[] = [];
test.afterAll(async () => {
  for (const user of users) await admin.auth.admin.deleteUser(user);
});

test("signed-out visitors cannot open the workspace or mutate data", async ({
  page,
  request,
}) => {
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login/);
  const result = await request.post("/api/notes", {
    headers: { Origin: "http://127.0.0.1:3210" },
    data: {
      title: "Unauthorized",
      content: "A synthetic anonymous request must fail.",
    },
  });
  expect(result.status()).toBe(401);
  expect(
    (
      await request.post("/api/notes", {
        headers: { Origin: "https://untrusted.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/stripe/webhook", { data: { id: "evt_forged" } })
    ).status(),
  ).toBe(400);
});

test("signup → private note → summary → history → quota limit → delete → logout", async ({
  page,
}, testInfo) => {
  const email = `demo-${testInfo.project.name}@signal.local`;
  const existing = await admin.auth.admin.listUsers();
  const old = existing.data.users.find(
    (candidate) => candidate.email === email,
  );
  if (old) await admin.auth.admin.deleteUser(old.id);
  await page.goto("/login?mode=signup");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-E2E-Password-2026!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspace/);
  const { data } = await admin.auth.admin.listUsers();
  const user = data.users.find((u) => u.email === email);
  expect(user).toBeTruthy();
  users.push(user!.id);
  await page.getByLabel("Note title").fill("Product launch · team notes");
  await page
    .getByLabel("Your note", { exact: true })
    .fill(dataset.cases.find((c) => c.id === "N01")!.note);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Product launch · team notes",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Summarize note", exact: true })
    .click();
  await expect(page.locator(".summary-text")).toContainText(
    "• The team approved the launch",
  );
  await expect(page.getByTestId("usage-count")).toContainText("01");
  // Assert persistence independently of the browser state.
  const persisted = await admin
    .from("generations")
    .select("summary,status")
    .eq("user_id", user!.id);
  expect(persisted.data).toHaveLength(1);
  expect(persisted.data![0].status).toBe("succeeded");
  await page.reload();
  await expect(page.locator(".summary-text")).toContainText(
    "Mira owns the launch",
  );
  await expect(page.locator(".demo-banner")).toBeVisible();
  await expect(page.locator(".demo-banner")).toContainText("Local demo");
  mkdirSync("docs/screenshots", { recursive: true });
  if (testInfo.project.name === "chromium") {
    await page.screenshot({
      path: "docs/screenshots/workspace.png",
      fullPage: true,
    });
  } else {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/screenshots/mobile.png",
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Usage & activity" }).click();
  await expect(
    page.getByRole("heading", { name: "Summary activity" }),
  ).toBeVisible();
  await expect(
    page.locator(".table-row").filter({ hasText: "Product launch" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Plan & billing" }).click();
  await expect(
    page.getByRole("heading", { name: "Make room for more." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try Pro in test mode" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "My notes" }).click();
  for (let i = 2; i <= 5; i++) {
    await page
      .getByRole("button", { name: "Summarize again", exact: true })
      .click();
    await expect(page.getByTestId("usage-count")).toContainText(
      String(i).padStart(2, "0"),
    );
  }
  await expect(
    page.getByRole("button", { name: "Summarize again", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Monthly limit reached", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByLabel("Note title")).toBeVisible();
  expect(
    (await admin.from("notes").select("id").eq("user_id", user!.id)).data,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/login/);
  // Password login uses the same real Supabase identity.
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-E2E-Password-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace/);
});

test("landing and pricing remain usable on every viewport", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Less noise/ })).toBeVisible();
  await page.getByRole("link", { name: "Pricing", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Start with a thought." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (info.project.name === "chromium") {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "docs/screenshots/landing.png",
      fullPage: true,
    });
  }
});
