import { assertDedicatedStack } from "./local-environment.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const base = "http://127.0.0.1:3210";
assertDedicatedStack(process.env);
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const email = `smoke-${randomUUID()}@signal.local`;
let userId;
let cookie = "";
let noteId;
let readbackStatus = "not_attempted";
mkdirSync("test-results", { recursive: true });
async function api(path, body, method = "POST") {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000),
  });
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length)
    cookie = setCookies.map((value) => value.split(";")[0]).join("; ");
  assert.ok(response.ok, `HTTP boundary ${path}: ${response.status}`);
  return response.json();
}
try {
  await api("/api/auth", {
    action: "signup",
    email,
    password: "Synthetic-Smoke-Password-2026!",
  });
  const users = await admin.auth.admin.listUsers();
  userId = users.data.users.find((user) => user.email === email)?.id;
  assert.ok(userId);
  const note = await api("/api/notes", {
    title: "Synthetic launcher smoke",
    content:
      "The team approved the launch. The launch date is 2026-11-02. Mira owns the launch.",
  });
  noteId = note.note.id;
  const requestId = randomUUID();
  const result = await api("/api/summarize", { noteId, requestId });
  assert.equal(result.result.kind, "summary");
  assert.equal(result.result.takeaways.length, 3);
  assert.match(result.traceId, /^[0-9a-f]{32}$/);
  const cached = await api("/api/summarize", { noteId, requestId });
  assert.equal(cached.cached, true);
  assert.deepEqual(cached.result, result.result);
  const stored = await admin
    .from("generations")
    .select("trace_id,result,status")
    .eq("user_id", userId)
    .eq("request_id", requestId)
    .single();
  assert.equal(stored.error, null);
  assert.equal(stored.data.trace_id, result.traceId);
  assert.deepEqual(stored.data.result, result.result);
  let spans;
  if (process.argv.includes("--phoenix")) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const response = await fetch(
        `http://127.0.0.1:56006/v1/projects/signal-notes/spans?trace_id=${result.traceId}&limit=20`,
        { signal: AbortSignal.timeout(2000) },
      ).catch(() => null);
      readbackStatus = response
        ? `http_${response.status}`
        : "transport_unavailable";
      if (response?.ok) {
        spans = (await response.json()).data;
        if (spans.length === 4) break;
      }
      await delay(500);
    }
    assert.equal(
      spans?.length,
      4,
      "Actual application spans must be read back from pinned Phoenix",
    );
    const root = spans.find((span) => span.name === "generation");
    assert.ok(root);
    assert.equal(root.context.trace_id, result.traceId);
    for (const name of ["reserve", "provider", "persist"]) {
      const child = spans.find((span) => span.name === name);
      assert.ok(child);
      assert.equal(child.parent_id, root.context.span_id);
      assert.equal(child.context.trace_id, result.traceId);
      assert.equal(child.status_code, "OK");
    }
    const serialized = JSON.stringify(spans);
    for (const forbidden of [
      email,
      note.note.content,
      "Synthetic-Smoke-Password",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ])
      assert.ok(!serialized.includes(forbidden), "Trace redaction");
  }
  await api("/api/notes", { id: noteId }, "DELETE");
  const purged = await admin
    .from("generations")
    .select("result,summary,source_deleted")
    .eq("user_id", userId)
    .single();
  assert.deepEqual(purged.data, {
    result: null,
    summary: null,
    source_deleted: true,
  });
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/launcher-smoke.json",
    `${JSON.stringify({ pass: true, route: "real-next-auth-db-local-provider", traceId: result.traceId, phoenix: spans ? { image: "20.22.0", spans } : "disabled" }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      event: "launcher_smoke_passed",
      traceId: result.traceId,
      phoenixReadback: !!spans,
    }),
  );
} catch (error) {
  writeFileSync(
    "test-results/launcher-smoke.json",
    `${JSON.stringify({ pass: false, code: "launcher_smoke_failed", phoenixReadbackStatus: readbackStatus })}\n`,
  );
  throw error;
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
}
