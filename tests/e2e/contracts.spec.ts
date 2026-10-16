import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import dataset from "../../evals/dataset.json" with { type: "json" };
const base = "http://127.0.0.1:3210";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56321")
  throw Error("Dedicated local fixture stack required");
const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  ),
  users: string[] = [];
test.afterAll(async () => {
  for (const id of users) await admin.auth.admin.deleteUser(id);
});
test("two real browser identities, original evidence/metrics, insufficient outcomes, literal HTML and server sixth denial", async ({
  page,
  browser,
}, info) => {
  const password = "Synthetic-Browser-Only-2026!",
    email = `edge-${info.project.name}-${randomUUID()}@signal.local`;
  await page.goto("/login?mode=signup");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspace/);
  const owner = (await admin.auth.admin.listUsers()).data.users.find(
    (u) => u.email === email,
  )!;
  expect(owner).toBeTruthy();
  users.push(owner.id);
  const other = await admin.auth.admin.createUser({
    email: `other-${randomUUID()}@signal.local`,
    password,
    email_confirm: true,
  });
  expect(other.error).toBeNull();
  users.push(other.data.user!.id);
  const foreign = await admin
    .from("notes")
    .insert({
      user_id: other.data.user!.id,
      title: "Foreign private title",
      content: "FOREIGN_PRIVATE_CANARY. Mira owns another private release.",
    })
    .select("id")
    .single();
  expect(foreign.error).toBeNull();
  const response = await page.request.post("/api/summarize", {
    headers: { Origin: base },
    data: { noteId: foreign.data!.id, requestId: randomUUID() },
  });
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain("FOREIGN_PRIVATE_CANARY");
  const deleting = await page.request.delete("/api/notes", {
    headers: { Origin: base },
    data: { id: foreign.data!.id },
  });
  expect(deleting.status()).toBe(404);
  const second = await browser.newContext();
  try {
    const otherPage = await second.newPage();
    await otherPage.goto(`${base}/login`);
    await otherPage.getByLabel("Email address").fill(other.data.user!.email!);
    await otherPage.getByLabel("Password", { exact: true }).fill(password);
    await otherPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(otherPage).toHaveURL(/\/workspace/);
    await expect(
      otherPage.getByRole("heading", {
        name: "Foreign private title",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Foreign private title", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await second.close();
  }
  const notes = [
    {
      title: "Punctuation only",
      content: dataset.cases.find((c) => c.id === "I01")!.note,
      kind: "insufficient_content",
    },
    {
      title: "Instruction only",
      content: dataset.cases.find((c) => c.id === "I02")!.note,
      kind: "insufficient_content",
    },
    {
      title: "Literal HTML evidence",
      content:
        'Mira owns café onboarding. The label is <b data-synthetic="1">literal markup</b>. The launch date is 2026-11-02.',
      kind: "summary",
    },
  ];
  let lastId = "";
  for (const [index, note] of notes.entries()) {
    if (index)
      await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByLabel("Note title").fill(note.title);
    await page.getByLabel("Your note", { exact: true }).fill(note.content);
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    const summaryResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/summarize") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Summarize note", exact: true })
      .click();
    const generated = await summaryResponse;
    expect(generated.status()).toBe(200);
    const result = await generated.json();
    expect(result.result.kind).toBe(note.kind);
    expect(result.inputTokens + result.outputTokens).toBe(0);
    expect(result.estimatedMicroUsd).toBe(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.promptVersion).toBeTruthy();
    const stored = await admin
      .from("generations")
      .select(
        "request_id,note_id,result,trace_id,config,input_tokens,output_tokens,estimated_micro_usd,status",
      )
      .eq("user_id", owner.id)
      .eq("trace_id", result.traceId)
      .single();
    expect(stored.error).toBeNull();
    expect(stored.data!.result).toEqual(result.result);
    expect(stored.data!.status).toBe("succeeded");
    expect(stored.data!.config.promptVersion).toBe(result.promptVersion);
    lastId = stored.data!.note_id;
    const replay = await page.request.post("/api/summarize", {
      headers: { Origin: base },
      data: { noteId: lastId, requestId: stored.data!.request_id },
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual({ ...result, cached: true });
    await page.reload();
    await expect(page.locator(".generation-metrics")).toContainText(
      result.traceId,
    );
    await expect(page.locator(".generation-metrics")).toContainText(
      "Estimated token cost",
    );
    if (note.kind === "insufficient_content")
      await expect(page.locator(".summary-text")).toHaveText(
        "Not enough substantive facts to summarize.",
      );
    else {
      for (const evidence of await page
        .locator(".takeaway details summary")
        .all())
        await evidence.click();
      await expect(page.locator(".summary-text")).toContainText(
        '<b data-synthetic="1">literal markup</b>',
      );
      expect(await page.locator(".summary-text b").count()).toBe(0);
      for (const quote of await page
        .locator(".takeaway blockquote")
        .allTextContents())
        expect(note.content).toContain(quote);
      await page.screenshot({
        path: `test-results/evidence-${info.project.name}.png`,
        fullPage: true,
      });
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  for (let i = 4; i <= 5; i++) {
    const r = await page.request.post("/api/summarize", {
      headers: { Origin: base },
      data: { noteId: lastId, requestId: randomUUID() },
    });
    expect(r.status()).toBe(200);
  }
  const sixth = await page.request.post("/api/summarize", {
    headers: { Origin: base },
    data: { noteId: lastId, requestId: randomUUID() },
  });
  expect(sixth.status()).toBe(429);
  expect(await sixth.json()).toMatchObject({ code: "limit" });
  const rows = await admin
    .from("generations")
    .select("status,attempt_started")
    .eq("user_id", owner.id);
  expect(rows.data).toHaveLength(5);
  expect(
    rows.data!.every((r) => r.status === "succeeded" && r.attempt_started),
  ).toBe(true);
  await page.reload();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete note" }).click();
  await page.getByRole("button", { name: "Usage & activity" }).click();
  await expect(
    page.getByText("Deleted note", { exact: true }).first(),
  ).toBeVisible();
  const purged = await admin
    .from("generations")
    .select("summary,result,source_deleted")
    .eq("user_id", owner.id)
    .eq("source_note_id", lastId);
  expect(purged.data!.length).toBeGreaterThan(0);
  for (const row of purged.data!)
    expect(row).toEqual({ summary: null, result: null, source_deleted: true });
});
