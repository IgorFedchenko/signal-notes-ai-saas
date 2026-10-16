import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { generationConfig, MODEL_PRICES } from "@/lib/ai/pricing";

const dsn = process.env.SUPABASE_DB_URL!;
if (new URL(dsn).port !== "56322")
  throw Error("Dedicated local PostgreSQL required");
const control = postgres(dsn, { max: 1 }),
  databases: string[] = [],
  evidence: unknown[] = [];
const baseline = "4737fa3f07bd09a61a5452cf6bb6346937647f3d";
const initial = readFileSync(
  "supabase/migrations/202610160001_initial.sql",
  "utf8",
);
const additive = readFileSync(
  "supabase/migrations/202610160002_generation_contract.sql",
  "utf8",
);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function database(clock = false) {
  const name = `signal_contract_${randomUUID().replaceAll("-", "")}`;
  databases.push(name);
  await control.unsafe(`create database ${name}`);
  const url = new URL(dsn);
  url.pathname = `/${name}`;
  const db = postgres(url.toString(), { max: 1 });
  // Minimal Auth table/UID scaffold for migration compatibility ONLY. Genuine
  // Supabase Auth/JWT/RLS is independently exercised in generation-contract tests.
  await db.unsafe(
    `create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated,service_role;`,
  );
  await db.unsafe(initial);
  if (clock)
    await db.unsafe(
      `create function public.test_clock_timestamp() returns timestamptz language sql volatile as $$ select current_setting('signal.test_now')::timestamptz $$; revoke all on function public.test_clock_timestamp() from public,anon,authenticated,service_role;`,
    );
  return {
    db,
    name,
    apply: () =>
      db.unsafe(
        clock
          ? additive.replaceAll(
              "clock_timestamp()",
              "public.test_clock_timestamp()",
            )
          : additive,
      ),
  };
}
async function owner(db: ReturnType<typeof postgres>) {
  const id = randomUUID(),
    note = randomUUID();
  await db`insert into auth.users(id)values(${id})`;
  await db`insert into notes(id,user_id,title,content)values(${note},${id},'Synthetic migration','Mira owns the launch. The launch date is 2026-11-02.')`;
  return { id, note };
}
function config() {
  process.env.AI_PROVIDER = "fixture";
  return generationConfig();
}
async function reserve(
  db: ReturnType<typeof postgres>,
  f: { id: string; note: string },
  id = randomUUID(),
  amount = 0,
) {
  const [row] =
    await db`select reserve_generation_v2(${f.id}::uuid,${f.note}::uuid,${id}::uuid,${db.json(amount ? { ...config(), ...MODEL_PRICES["gpt-5.4-mini-2026-03-17"], model: "gpt-5.4-mini-2026-03-17" } : config())},${amount},${"a".repeat(32)}) as result`;
  return { id, ...row.result };
}
async function begin(
  db: ReturnType<typeof postgres>,
  user: string,
  id: string,
) {
  return (
    await db`select begin_generation_attempt_v2(${user}::uuid,${id}::uuid) as result`
  )[0].result;
}
async function finish(
  db: ReturnType<typeof postgres>,
  user: string,
  id: string,
  input = 0,
  output = 0,
) {
  return (
    await db`select finish_generation_v2(${user}::uuid,${id}::uuid,'{"kind":"insufficient_content","takeaways":[]}'::jsonb,${input},${output},1) as result`
  )[0].result;
}
afterAll(async () => {
  for (const name of databases)
    await control.unsafe(`drop database ${name} with (force)`);
  await control.end();
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/migration-clock.json",
    JSON.stringify(
      { baseline, originalMigrationHash: hash(initial), evidence },
      null,
      2,
    ),
  );
});
describe("T14 additive migrations in disposable real PostgreSQL databases", () => {
  it("retains byte-identical original migration and supports the genuinely empty path with RLS/privileges", async () => {
    expect(initial).toBe(
      execFileSync(
        "git",
        ["show", `${baseline}:supabase/migrations/202610160001_initial.sql`],
        { encoding: "utf8" },
      ),
    );
    const { db, apply } = await database();
    try {
      await apply();
      const a = await owner(db),
        b = await owner(db);
      const r = await reserve(db, a);
      expect(r.kind).toBe("reserved");
      expect((await begin(db, a.id, r.id)).kind).toBe("attempt");
      expect((await finish(db, a.id, r.id)).kind).toBe("succeeded");
      await db.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`select set_config('request.jwt.claim.sub',${a.id},true)`;
        expect(await tx`select id from notes where id=${b.note}`).toHaveLength(
          0,
        );
        expect(
          await tx`delete from notes where id=${b.note} returning id`,
        ).toHaveLength(0);
        expect(await tx`select request_id from generations`).toHaveLength(1);
      });
      const acl =
        await db`select proname,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as authenticated,has_function_privilege('service_role',p.oid,'execute') as server from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('reserve_generation_v2','begin_generation_attempt_v2','finish_generation_v2','fail_generation_v2')`;
      expect(acl).toHaveLength(4);
      for (const p of acl)
        expect(p).toMatchObject({
          anon: false,
          authenticated: false,
          server: true,
        });
      evidence.push({
        lane: "empty-all-migrations",
        reserveBeginFinish: true,
        rls: true,
        acl,
      });
    } finally {
      await db.end();
    }
  });
  it("upgrades baseline-seeded legacy rows, preserves unknown labels/dedup and truly denies every obsolete server RPC", async () => {
    const { db, apply } = await database();
    try {
      const f = await owner(db),
        ids = Array.from({ length: 4 }, () => randomUUID());
      for (let i = 0; i < 4; i++)
        await db`insert into generations(user_id,request_id,note_id,period,status,summary,provider,input_tokens,output_tokens,expires_at)values(${f.id},${ids[i]},${f.note},date_trunc('month',clock_timestamp() at time zone 'UTC')::date,${["succeeded", "failed", "reserved", "reserved"][i]},${i === 0 ? "LEGACY_PRIVATE_SUMMARY" : null},'legacy',${i === 0 ? 12 : 0},${i === 0 ? 6 : 0},clock_timestamp()+${i === 3 ? "-1 minute" : "1 minute"}::interval)`;
      await apply();
      const rows =
        await db`select request_id,status,contract_version,cost_status,estimated_micro_usd,exposure_micro_usd,source_note_id from generations order by request_id`;
      expect(rows).toHaveLength(4);
      for (const row of rows)
        expect(row).toMatchObject({
          contract_version: "legacy-v1",
          cost_status: "legacy_unknown",
          estimated_micro_usd: null,
          exposure_micro_usd: null,
          source_note_id: f.note,
        });
      expect(rows.filter((r) => r.status === "failed")).toHaveLength(3);
      expect((await reserve(db, f, ids[0])).kind).toBe("cached");
      for (const id of ids.slice(1))
        expect((await reserve(db, f, id)).kind).toBe("failed");
      for (const call of [
        `select reserve_generation('${f.id}'::uuid,'${f.note}'::uuid,'${ids[0]}'::uuid)`,
        `select finish_generation('${f.id}'::uuid,'${ids[0]}'::uuid,'forged'::text,'forged'::text,0,0)`,
        `select fail_generation('${f.id}'::uuid,'${ids[0]}'::uuid)`,
      ]) {
        await expect(
          db.begin(async (tx) => {
            await tx`set local role service_role`;
            await tx.unsafe(call);
          }),
        ).rejects.toMatchObject({ code: "42883" });
      }
      expect(
        await db`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('reserve_generation','finish_generation','fail_generation')`,
      ).toHaveLength(0);
      await db.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`select set_config('request.jwt.claim.sub',${f.id},true)`;
        await tx`delete from notes where id=${f.note}`;
      });
      expect(
        (await db`select summary from generations where user_id=${f.id}`).every(
          (r) => r.summary === null,
        ),
      ).toBe(true);
      evidence.push({
        lane: "baseline-seeded-additive-upgrade",
        legacy: rows,
        oldServiceRoleCallsDenied: 3,
        purge: true,
      });
    } finally {
      await db.end();
    }
  });
});
describe("T13 SQL UTC-month clock seam isolated to disposable database", () => {
  it("keeps old-period snapshot and global dedup across real SQL UTC midnight despite non-UTC timezone and disagreeing JS clock", async () => {
    const { db, apply } = await database(true);
    try {
      await apply();
      await db`set timezone='Pacific/Kiritimati'`;
      await db`select set_config('signal.test_now','2026-12-31T23:59:50Z',false)`;
      const f = await owner(db);
      const r = await reserve(db, f, randomUUID(), 5000);
      expect(r.kind).toBe("reserved");
      // Expiry defaults use the real DB clock. Advance each test-owned row before
      // the next reservation can run cleanup under the simulated SQL clock.
      await db`update generations set expires_at='2027-01-01T00:01:50Z' where user_id=${f.id} and request_id=${r.id}`;
      const unknown = await reserve(db, f, randomUUID(), 5000);
      expect(unknown.kind).toBe("reserved");
      await db`update generations set expires_at='2027-01-01T00:01:50Z' where user_id=${f.id} and request_id=${unknown.id}`;
      expect((await begin(db, f.id, unknown.id)).period).toBe("2026-12-01");
      await db`select set_config('signal.test_now','2027-01-01T00:00:10Z',false)`;
      const ack = await begin(db, f.id, r.id);
      expect(ack.kind).toBe("attempt");
      expect(ack.period).toBe("2026-12-01");
      expect((await finish(db, f.id, r.id, 10, 2)).kind).toBe("succeeded");
      await db`select fail_generation_v2(${f.id}::uuid,${unknown.id}::uuid)`;
      const next = await reserve(db, f);
      expect(next.kind).toBe("reserved");
      await db`update generations set expires_at='2027-01-01T00:02:10Z' where user_id=${f.id} and request_id=${next.id}`;
      expect((await reserve(db, f, r.id)).kind).toBe("cached");
      const rows =
        await db`select period::text,count(*)filter(where status in('succeeded','reserved'))::int as c,count(*)filter(where cost_status='unknown')::int as unknown,coalesce(sum(exposure_micro_usd),0)::int as e from generations where user_id=${f.id} group by period order by period`;
      expect(rows).toEqual([
        { period: "2026-12-01", c: 1, unknown: 1, e: 5017 },
        { period: "2027-01-01", c: 1, unknown: 0, e: 0 },
      ]);
      const functionBody = (
        await db`select prosrc from pg_proc where proname='reserve_generation_v2'`
      )[0].prosrc;
      expect(functionBody).toContain("at time zone 'UTC'");
      expect(functionBody).toContain("public.test_clock_timestamp()");
      evidence.push({
        lane: "disposable-Postgres-clock-seam",
        clockFunctionOnlyReplacement: true,
        timezone: "Pacific/Kiritimati",
        jsClockUsedForAdmission: false,
        rows,
        globalDedup: true,
      });
    } finally {
      await db.end();
    }
  });
});
