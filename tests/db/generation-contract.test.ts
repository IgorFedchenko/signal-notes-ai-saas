import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { createServer } from "node:http";
import { summarize as actualProvider } from "@/lib/ai/provider";
import { reservationCost } from "@/lib/ai/pricing";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { generationConfig, MODEL_PRICES } from "@/lib/ai/pricing";
import { POST } from "@/app/api/summarize/route";
import { identity } from "@/lib/http";
import { adminClient } from "@/lib/supabase/admin";
import { summarize } from "@/lib/ai";
vi.mock("@/lib/http", async (original) => ({
  ...(await original<typeof import("@/lib/http")>()),
  identity: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/ai", () => ({ summarize: vi.fn() }));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
if (
  url !== "http://127.0.0.1:56321" ||
  new URL(process.env.SUPABASE_DB_URL!).port !== "56322"
)
  throw Error("Dedicated local DB required");
const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 10 });
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const owners: string[] = [];
const source =
  "The launch date is 2026-11-02. Mira owns the launch. PRIVATE_SYNTHETIC_SOURCE.";
const output = {
  kind: "summary",
  takeaways: [
    { text: "Mira owns the launch.", evidence: "Mira owns the launch." },
  ],
};
const evidence: unknown[] = [];
function localConfig() {
  process.env.AI_PROVIDER = "fixture";
  return generationConfig();
}
function paidConfig() {
  return {
    ...localConfig(),
    ...MODEL_PRICES["gpt-5.4-mini-2026-03-17"],
    model: "gpt-5.4-mini-2026-03-17",
  };
}
type Fixture = { id: string; note: string; client: SupabaseClient };
async function fixture(pro = false): Promise<Fixture> {
  const email = `contract-${randomUUID()}@signal.local`,
    password = "Synthetic-Contract-Password-2026!";
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  owners.push(id);
  const client = createClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const inserted = await client
    .from("notes")
    .insert({ title: "Synthetic contract", content: source })
    .select("id")
    .single();
  if (inserted.error) throw inserted.error;
  if (pro)
    await sql`update billing_accounts set plan='pro',status='active',period_end=clock_timestamp()+interval '1 day' where user_id=${id}`;
  return { id, note: inserted.data.id, client };
}
async function rpc(name: string, args: Record<string, unknown>) {
  const r = await admin.rpc(name, args);
  if (r.error) throw Error(`${name}:${r.error.code}`);
  return r.data;
}
const reserve = (
  f: Fixture,
  id = randomUUID(),
  amount = 0,
  config = amount ? paidConfig() : localConfig(),
) =>
  rpc("reserve_generation_v2", {
    p_user: f.id,
    p_note: f.note,
    p_request: id,
    p_config: config,
    p_reserved: amount,
    p_trace: "a".repeat(32),
  });
const begin = (f: Fixture, id: string) =>
  rpc("begin_generation_attempt_v2", { p_user: f.id, p_request: id });
const fail = (f: Fixture, id: string) =>
  rpc("fail_generation_v2", { p_user: f.id, p_request: id });
const finish = (f: Fixture, id: string, input = 0, out = 0) =>
  rpc("finish_generation_v2", {
    p_user: f.id,
    p_request: id,
    p_result: output,
    p_input: input,
    p_output: out,
    p_latency: 7,
  });
async function row(f: Fixture, id: string) {
  return (
    await sql`select * from generations where user_id=${f.id} and request_id=${id}`
  )[0];
}
async function ledger(f: Fixture) {
  const [r] =
    await sql`select count(*) filter(where status in ('reserved','succeeded'))::int as c,coalesce(sum(exposure_micro_usd),0)::int as e,count(*)::int as ids,coalesce(sum(input_tokens)filter(where status='succeeded'),0)::int as tokens from generations where user_id=${f.id} and period=date_trunc('month',clock_timestamp() at time zone 'UTC')::date`;
  return r;
}
async function receipt(label: string, f: Fixture) {
  evidence.push({
    label,
    ledger: await ledger(f),
    rows: await sql`select request_id,status,attempt_started is not null as attempted,period,cost_status,reserved_micro_usd,exposure_micro_usd,estimated_micro_usd,source_deleted,summary is null as text_purged from generations where user_id=${f.id}`,
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/generation-ledger.json",
    JSON.stringify(
      {
        lane: "real-local-Auth-Postgres-RLS; provider calls doubled only in ack-loss route",
        evidence,
      },
      null,
      2,
    ),
  );
  for (const id of owners) await admin.auth.admin.deleteUser(id);
  await sql.end();
});

describe("T02/T14 current privileged RPC boundary", () => {
  it("actually denies every v2 mutation to anonymous/authenticated JWTs and old signatures to service_role", async () => {
    const f = await fixture(),
      anonymous = createClient(
        url,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false } },
      ),
      id = randomUUID();
    const calls: [string, Record<string, unknown>][] = [
      [
        "reserve_generation_v2",
        {
          p_user: f.id,
          p_note: f.note,
          p_request: id,
          p_config: localConfig(),
          p_reserved: 0,
          p_trace: "a".repeat(32),
        },
      ],
      ["begin_generation_attempt_v2", { p_user: f.id, p_request: id }],
      [
        "finish_generation_v2",
        {
          p_user: f.id,
          p_request: id,
          p_result: output,
          p_input: 0,
          p_output: 0,
          p_latency: 0,
        },
      ],
      ["fail_generation_v2", { p_user: f.id, p_request: id }],
    ];
    for (const client of [f.client, anonymous])
      for (const [name, args] of calls)
        expect(
          (await client.rpc(name, args)).error,
          `${name} privilege`,
        ).toBeTruthy();
    for (const [name, args] of [
      ["reserve_generation", { p_user: f.id, p_note: f.note, p_request: id }],
      [
        "finish_generation",
        {
          p_user: f.id,
          p_request: id,
          p_summary: "forged",
          p_provider: "forged",
          p_input: 0,
          p_output: 0,
        },
      ],
      ["fail_generation", { p_user: f.id, p_request: id }],
    ] as const)
      expect((await admin.rpc(name, args)).error).toBeTruthy();
    expect((await ledger(f)).ids).toBe(0);
    expect((await reserve(f, id)).kind).toBe("reserved");
  });
});
describe("T07/T08 count quotas and entitlement transitions", () => {
  it("admits five of fifteen, three success plus two active still blocks, pre-attempt failure frees exactly one", async () => {
    const f = await fixture(),
      ids = Array.from({ length: 15 }, () => randomUUID());
    const results = await Promise.all(ids.map((id) => reserve(f, id)));
    expect(results.filter((r) => r.kind === "reserved")).toHaveLength(5);
    expect(results.filter((r) => r.kind === "limit")).toHaveLength(10);
    const winners = ids.filter((_, i) => results[i].kind === "reserved");
    for (const id of winners.slice(0, 3)) {
      expect((await begin(f, id)).kind).toBe("attempt");
      expect((await finish(f, id)).kind).toBe("succeeded");
    }
    expect(await ledger(f)).toMatchObject({ c: 5, e: 0, ids: 5 });
    expect((await reserve(f)).kind).toBe("limit");
    const before = await ledger(f);
    expect((await reserve(f, winners[0])).kind).toBe("cached");
    expect(await ledger(f)).toEqual(before);
    await fail(f, winners[3]);
    expect((await reserve(f, winners[3])).kind).toBe("failed");
    const race = await Promise.all([reserve(f), reserve(f)]);
    expect(race.filter((r) => r.kind === "reserved")).toHaveLength(1);
    await receipt("free-five", f);
  });
  it("admits exactly 100 of 105 Pro reservations; downgrade/upgrade preserves existing usage", async () => {
    const f = await fixture(true);
    const results = await Promise.all(
      Array.from({ length: 105 }, () => reserve(f)),
    );
    expect(results.filter((r) => r.kind === "reserved")).toHaveLength(100);
    expect(results.filter((r) => r.kind === "limit")).toHaveLength(5);
    expect(await ledger(f)).toMatchObject({ c: 100, e: 0, ids: 100 });
    await sql`update billing_accounts set status='canceled' where user_id=${f.id}`;
    expect((await reserve(f)).kind).toBe("limit");
    await sql`update billing_accounts set status='trialing',period_end=clock_timestamp()+interval '1 day' where user_id=${f.id}`;
    const [removed] =
      await sql`delete from generations where user_id=${f.id} and request_id=(select request_id from generations where user_id=${f.id} limit 1) returning request_id`;
    expect(removed).toBeTruthy();
    // A seeded success ledger, rather than only active reservations, must also
    // admit exactly one winner at 99/100. No provider execution is claimed here.
    await sql`update generations set status='succeeded',attempt_started=clock_timestamp(),result=${sql.json(output)},summary='Synthetic seeded success',cost_status='settled',estimated_micro_usd=0,exposure_micro_usd=0 where user_id=${f.id}`;
    expect(
      (
        await sql`select count(*)::int as successes from generations where user_id=${f.id} and status='succeeded'`
      )[0].successes,
    ).toBe(99);
    const race = await Promise.all([reserve(f), reserve(f)]);
    expect(race.filter((r) => r.kind === "reserved")).toHaveLength(1);
    await receipt("pro-one-hundred", f);
    const g = await fixture();
    for (let i = 0; i < 5; i++) {
      const id = randomUUID();
      await reserve(g, id);
      await begin(g, id);
      await finish(g, id);
    }
    await sql`update billing_accounts set plan='pro',status='active',period_end=clock_timestamp()+interval '1 day' where user_id=${g.id}`;
    const upgraded = await Promise.all(
      Array.from({ length: 96 }, () => reserve(g)),
    );
    expect(upgraded.filter((r) => r.kind === "reserved")).toHaveLength(95);
    expect((await ledger(g)).c).toBe(100);
    await sql`update billing_accounts set period_end=clock_timestamp()-interval '1 second' where user_id=${g.id}`;
    expect((await reserve(g)).kind).toBe("limit");
  });
});
describe("T09 nonzero exposure, integer settlement and budgets", () => {
  it("races eight for exactly two 50000 reservations; settles 17, releases pre-attempt and retains attempted unknown", async () => {
    const f = await fixture(),
      ids = Array.from({ length: 8 }, () => randomUUID());
    const results = await Promise.all(ids.map((id) => reserve(f, id, 50000)));
    const admitted = ids.filter((_, i) => results[i].kind === "reserved");
    expect(admitted).toHaveLength(2);
    expect(results.filter((r) => r.kind === "budget")).toHaveLength(6);
    expect(await ledger(f)).toMatchObject({ c: 2, e: 100000 });
    await begin(f, admitted[0]);
    await finish(f, admitted[0], 10, 2);
    await fail(f, admitted[1]);
    await fail(f, admitted[1]);
    expect(await ledger(f)).toMatchObject({ c: 1, e: 17, tokens: 10 });
    const attempted = randomUUID();
    await reserve(f, attempted, 99983);
    await begin(f, attempted);
    await fail(f, attempted);
    await fail(f, attempted);
    expect(await ledger(f)).toMatchObject({ c: 1, e: 100000 });
    expect((await reserve(f, randomUUID(), 1)).kind).toBe("budget");
    expect(await row(f, attempted)).toMatchObject({
      status: "failed",
      cost_status: "unknown",
      exposure_micro_usd: "99983",
    });
    await receipt("positive-exposure", f);
  });
  it.each([false, true])(
    "checks below/exactly/above normal budget (Pro=%s)",
    async (pro) => {
      const f = await fixture(pro),
        limit = pro ? 2000000 : 100000,
        id = randomUUID();
      await reserve(f, id, 1);
      await begin(f, id);
      await fail(f, id);
      await sql`update generations set exposure_micro_usd=${limit - 11},reserved_micro_usd=${limit - 11} where user_id=${f.id}`;
      const last = randomUUID();
      expect((await reserve(f, last, 10)).kind).toBe("reserved");
      expect((await ledger(f)).e).toBe(limit - 1);
      expect((await reserve(f, randomUUID(), 2)).kind).toBe("budget");
      expect((await reserve(f, randomUUID(), 1)).kind).toBe("reserved");
      expect((await ledger(f)).e).toBe(limit);
    },
  );
  it("rejects over-reservation usage without success then keeps maximum on failure", async () => {
    const f = await fixture(),
      id = randomUUID();
    await reserve(f, id, 10);
    await begin(f, id);
    await expect(finish(f, id, 100, 100)).rejects.toThrow(
      "finish_generation_v2",
    );
    await fail(f, id);
    expect(await ledger(f)).toMatchObject({ c: 0, e: 10 });
    expect((await row(f, id)).result).toBeNull();
  });
});
describe("T10/T11 committed CAS and lost response", () => {
  it("same ID has one row, one acknowledged winner, bound snapshot and terminal replay", async () => {
    const f = await fixture(),
      id = randomUUID(),
      config = paidConfig();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => reserve(f, id, 5000, config)),
    );
    expect(results.filter((r) => r.kind === "reserved")).toHaveLength(1);
    const gates = await Promise.all(
      Array.from({ length: 4 }, () => begin(f, id)),
    );
    const winner = gates.find((r) => r.kind === "attempt");
    expect(gates.filter((r) => r.kind === "attempt")).toHaveLength(1);
    expect(winner.config).toEqual(config);
    expect(winner.reservedMicroUsd).toBe(5000);
    expect(
      (
        await rpc("begin_generation_attempt_v2", {
          p_user: randomUUID(),
          p_request: id,
        })
      ).kind,
    ).toBe("not_found");
    await finish(f, id, 10, 2);
    const saved = await reserve(f, id, 0, { ...localConfig(), outputCap: 1 });
    expect(saved.kind).toBe("cached");
    expect(saved.generation.config).toEqual(config);
    await fail(f, id);
    expect((await finish(f, id)).kind).toBe("finish_denied");
    expect(await ledger(f)).toMatchObject({ c: 1, e: 17, ids: 1 });
    await receipt("CAS-binding", f);
  });
  it("expires before begin, frees unattempted exposure, forbids old ID and admits fresh ID", async () => {
    const f = await fixture(),
      id = randomUUID();
    await reserve(f, id, 50000);
    await sql`update generations set expires_at=clock_timestamp()-interval '1 second' where user_id=${f.id}`;
    await reserve(f);
    expect((await begin(f, id)).kind).toBe("attempt_denied");
    expect((await reserve(f, id, 50000)).kind).toBe("failed");
    expect(await ledger(f)).toMatchObject({ c: 1, e: 0 });
    expect((await row(f, id)).cost_status).toBe("released");
  });
  it("commits real DB begin then drops only acknowledgement at actual route boundary: zero provider calls and held exposure", async () => {
    const f = await fixture(),
      id = randomUUID();
    process.env.APP_URL = "http://127.0.0.1:3210";
    process.env.AI_PROVIDER = "fixture";
    vi.mocked(identity).mockResolvedValue({
      db: f.client,
      user: { id: f.id },
    } as Awaited<ReturnType<typeof identity>>);
    let committed = false;
    const adapter = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "reserve_generation_v2")
          return admin.rpc(name, {
            ...args,
            p_config: paidConfig(),
            p_reserved: 50000,
          });
        const response = await admin.rpc(name, args);
        if (name === "begin_generation_attempt_v2") {
          expect(response.error).toBeNull();
          expect(response.data.kind).toBe("attempt");
          committed = true;
          return { data: null, error: new Error("SYNTHETIC_ACK_LOSS_PRIVATE") };
        }
        return response;
      },
    };
    vi.mocked(adminClient).mockReturnValue(
      adapter as unknown as ReturnType<typeof adminClient>,
    );
    const request = () =>
      new Request("http://127.0.0.1:3210/api/summarize", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:3210",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ noteId: f.note, requestId: id }),
      });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("ACK_LOSS_PRIVATE");
    expect(committed).toBe(true);
    expect(summarize).not.toHaveBeenCalled();
    expect((await row(f, id)).attempt_started).toBeTruthy();
    expect(await ledger(f)).toMatchObject({ c: 0, e: 50000 });
    expect((await POST(request())).status).toBe(409);
    expect(summarize).not.toHaveBeenCalled();
    expect((await begin(f, id)).kind).toBe("attempt_denied");
    await receipt("committed-begin-lost-ack-zero-provider", f);
  });
});
describe("T12 expiry, process loss and finalizer ordering", () => {
  it("attempted expiry frees count but never exposure; duplicate late metadata cannot revive content", async () => {
    const f = await fixture(),
      id = randomUUID();
    await reserve(f, id, 50000);
    await begin(f, id);
    await sql`update generations set expires_at=clock_timestamp()-interval '1 second' where user_id=${f.id}`;
    await reserve(f);
    expect((await finish(f, id, 10, 2)).kind).toBe("expired");
    expect((await finish(f, id, 10, 2)).kind).toBe("expired");
    await fail(f, id);
    expect(await row(f, id)).toMatchObject({
      status: "failed",
      result: null,
      summary: null,
      cost_status: "unknown",
      exposure_micro_usd: "50000",
      estimated_micro_usd: "17",
    });
    expect(await ledger(f)).toMatchObject({ c: 1, e: 50000 });
    await receipt("expiry-before-finish", f);
  });
  it("finish before expiry remains settled after cleanup and duplicate failure", async () => {
    const f = await fixture(),
      id = randomUUID();
    await reserve(f, id, 50000);
    await begin(f, id);
    expect((await finish(f, id, 10, 2)).kind).toBe("succeeded");
    await sql`update generations set expires_at=clock_timestamp()-interval '1 second' where user_id=${f.id}`;
    await fail(f, id);
    await reserve(f);
    expect((await finish(f, id, 10, 2)).kind).toBe("finish_denied");
    expect(await row(f, id)).toMatchObject({
      status: "succeeded",
      cost_status: "settled",
      exposure_micro_usd: "17",
    });
  });
});
describe("T15 direct JWT deletion and two-connection late finalizers", () => {
  it("owner JWT delete purges all outcome classes while metering/dedup survives and begin/finish cannot restore", async () => {
    const f = await fixture(true),
      ids = Array.from({ length: 6 }, () => randomUUID());
    for (const id of ids) await reserve(f, id, 5000);
    for (const id of ids.slice(0, 4)) await begin(f, id);
    await finish(f, ids[0], 10, 2);
    await rpc("finish_generation_v2", {
      p_user: f.id,
      p_request: ids[1],
      p_result: { kind: "insufficient_content", takeaways: [] },
      p_input: 10,
      p_output: 2,
      p_latency: 1,
    });
    await fail(f, ids[2]);
    await sql`update generations set contract_version='legacy-v1',cost_status='legacy_unknown',summary='LEGACY_PRIVATE_TEXT',result=null where user_id=${f.id} and request_id=${ids[5]}`;
    const before = await ledger(f),
      foreign = await fixture();
    expect(
      (await foreign.client.from("notes").delete().eq("id", f.note).select())
        .data,
    ).toEqual([]);
    expect(
      (await f.client.from("notes").delete().eq("id", f.note).select()).data,
    ).toHaveLength(1);
    const rows =
      await sql`select summary,result,source_deleted,note_id from generations where user_id=${f.id}`;
    expect(rows).toHaveLength(6);
    for (const r of rows)
      expect(r).toEqual({
        summary: null,
        result: null,
        source_deleted: true,
        note_id: null,
      });
    expect(await ledger(f)).toEqual(before);
    expect((await begin(f, ids[4])).kind).toBe("not_found");
    expect((await finish(f, ids[3], 10, 2)).kind).toBe("deleted");
    expect((await reserve(f, ids[0])).kind).toBe("not_found");
    await receipt("direct-JWT-delete-all-classes", f);
  });
  it("delete locks source before a separate finalizer; late worker returns deleted with no text", async () => {
    const f = await fixture(),
      id = randomUUID();
    await reserve(f, id, 50000);
    await begin(f, id);
    const held = await sql.reserve();
    let committed = false;
    try {
      await held`begin`;
      await held`delete from notes where id=${f.note}`;
      const finishing = finish(f, id, 10, 2);
      await held`commit`;
      committed = true;
      expect((await finishing).kind).toBe("deleted");
      expect(await row(f, id)).toMatchObject({
        result: null,
        summary: null,
        source_deleted: true,
        exposure_micro_usd: "50000",
      });
    } finally {
      if (!committed) await held`rollback`;
      held.release();
    }
  });
  it("finish locks source first then direct JWT delete purges the committed result", async () => {
    const f = await fixture(),
      id = randomUUID();
    await reserve(f, id);
    await begin(f, id);
    const held = await sql.reserve();
    let committed = false;
    try {
      await held`begin`;
      const [r] =
        await held`select finish_generation_v2(${f.id}::uuid,${id}::uuid,${held.json(output)},0,0,1) as result`;
      expect(r.result.kind).toBe("succeeded");
      const deleting = f.client
        .from("notes")
        .delete()
        .eq("id", f.note)
        .select()
        .then((r) => r);
      await held`commit`;
      committed = true;
      expect((await deleting).data).toHaveLength(1);
      expect(await row(f, id)).toMatchObject({
        result: null,
        summary: null,
        source_deleted: true,
        cost_status: "settled",
      });
    } finally {
      if (!committed) await held`rollback`;
      held.release();
    }
  });
});

it("T12 actual 25-second local HTTP provider timeout retains nonzero exposure and executes only once", async () => {
  const f = await fixture(),
    id = randomUUID();
  let calls = 0;
  const server = createServer(() => {
    calls++; /* deliberately no response */
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Local contract server required");
  const fetchOriginal = globalThis.fetch;
  const endpoint = `http://127.0.0.1:${address.port}`;
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const target =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (target === "https://api.openai.com/v1/chat/completions")
        return fetchOriginal(endpoint, init);
      if (new URL(target).hostname !== "127.0.0.1")
        throw Error("Contract lane prohibits external network");
      return fetchOriginal(input, init);
    },
  );
  vi.stubEnv("APP_URL", "http://127.0.0.1:3210");
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("OPENAI_MODEL", "gpt-5.4-mini-2026-03-17");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-loopback-contract-only");
  vi.stubEnv("AI_LIVE_APPROVED", "true");
  const bound = generationConfig(),
    maximum = reservationCost(source, bound);
  vi.mocked(identity).mockResolvedValue({
    db: f.client,
    user: { id: f.id },
  } as Awaited<ReturnType<typeof identity>>);
  vi.mocked(adminClient).mockReturnValue(admin);
  vi.mocked(summarize).mockImplementation(actualProvider);
  try {
    const started = performance.now();
    const response = await POST(
      new Request("http://127.0.0.1:3210/api/summarize", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:3210",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ noteId: f.note, requestId: id }),
      }),
    );
    const elapsedMs = Math.round(performance.now() - started);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "provider_unavailable",
    });
    expect(calls).toBe(1);
    expect(elapsedMs).toBeGreaterThanOrEqual(24000);
    expect(elapsedMs).toBeLessThan(32000);
    expect(await ledger(f)).toMatchObject({ c: 0, e: maximum });
    expect(await row(f, id)).toMatchObject({
      status: "failed",
      cost_status: "unknown",
      summary: null,
      result: null,
    });
    evidence.push({
      label: "actual-loopback-25s-timeout",
      calls,
      elapsedMs,
      maximum,
      ledger: await ledger(f),
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 45000);

it("T11 pre-commit begin rejection is distinct from lost committed acknowledgement and releases exposure", async () => {
  const f = await fixture(),
    id = randomUUID();
  vi.stubEnv("APP_URL", "http://127.0.0.1:3210");
  vi.stubEnv("AI_PROVIDER", "fixture");
  vi.mocked(identity).mockResolvedValue({
    db: f.client,
    user: { id: f.id },
  } as Awaited<ReturnType<typeof identity>>);
  vi.mocked(adminClient).mockReturnValue({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "reserve_generation_v2")
        return admin.rpc(name, {
          ...args,
          p_config: paidConfig(),
          p_reserved: 50000,
        });
      if (name === "begin_generation_attempt_v2")
        return {
          data: null,
          error: new Error("synthetic transaction rejected before commit"),
        };
      return admin.rpc(name, args);
    },
  } as unknown as ReturnType<typeof adminClient>);
  const response = await POST(
    new Request("http://127.0.0.1:3210/api/summarize", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3210",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ noteId: f.note, requestId: id }),
    }),
  );
  expect(response.status).toBe(503);
  expect(summarize).not.toHaveBeenCalled();
  expect(await row(f, id)).toMatchObject({
    status: "failed",
    attempt_started: null,
    cost_status: "released",
    exposure_micro_usd: "0",
  });
  expect(await ledger(f)).toMatchObject({ c: 0, e: 0 });
  await receipt("begin-rejected-before-commit", f);
});
it("T15 actual handler cannot return provider text after direct ownerJWT deletion while provider is blocked", async () => {
  const f = await fixture(),
    id = randomUUID();
  vi.stubEnv("APP_URL", "http://127.0.0.1:3210");
  vi.stubEnv("AI_PROVIDER", "fixture");
  vi.mocked(identity).mockResolvedValue({
    db: f.client,
    user: { id: f.id },
  } as Awaited<ReturnType<typeof identity>>);
  vi.mocked(adminClient).mockReturnValue(admin);
  let entered!: () => void, release!: () => void;
  const entry = new Promise<void>((r) => (entered = r)),
    barrier = new Promise<void>((r) => (release = r));
  vi.mocked(summarize).mockImplementation(async () => {
    entered();
    await barrier;
    return {
      result: {
        kind: "summary",
        takeaways: [{ text: source, evidence: source }],
      },
      text: source,
      provider: "extractive-local-v2",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 1,
    };
  });
  const pending = POST(
    new Request("http://127.0.0.1:3210/api/summarize", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3210",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ noteId: f.note, requestId: id }),
    }),
  );
  await entry;
  try {
    expect((await row(f, id)).attempt_started).toBeTruthy();
    expect(
      (await f.client.from("notes").delete().eq("id", f.note).select()).data,
    ).toHaveLength(1);
  } finally {
    release();
  }
  const response = await pending;
  expect(response.status).toBe(409);
  const body = await response.text();
  expect(body).toContain('"code":"deleted"');
  expect(body).not.toContain("PRIVATE_SYNTHETIC_SOURCE");
  expect(summarize).toHaveBeenCalledTimes(1);
  expect(await row(f, id)).toMatchObject({
    status: "failed",
    result: null,
    summary: null,
    source_deleted: true,
    cost_status: "unknown",
  });
  await receipt("delete-during-blocked-provider-no-returned-text", f);
});
it("T16 positive-cost insufficient outcome consumes count, settles actual usage and replays immutable metadata", async () => {
  const f = await fixture(),
    id = randomUUID();
  await reserve(f, id, 5000);
  await begin(f, id);
  const saved = await rpc("finish_generation_v2", {
    p_user: f.id,
    p_request: id,
    p_result: { kind: "insufficient_content", takeaways: [] },
    p_input: 10,
    p_output: 2,
    p_latency: 7,
  });
  expect(saved.kind).toBe("succeeded");
  expect(saved.generation).toMatchObject({
    result: { kind: "insufficient_content", takeaways: [] },
    estimated_micro_usd: 17,
    input_tokens: 10,
    output_tokens: 2,
    latency_ms: 7,
    cost_status: "settled",
  });
  const cached = await reserve(f, id, 0, localConfig());
  expect(cached.kind).toBe("cached");
  expect(cached.generation).toEqual(saved.generation);
  expect(await ledger(f)).toMatchObject({ c: 1, e: 17, ids: 1, tokens: 10 });
  await receipt("nonzero-insufficient-settlement-cache", f);
});
