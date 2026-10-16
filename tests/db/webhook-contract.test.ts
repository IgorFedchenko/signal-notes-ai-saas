import { afterAll, afterEach, expect, it, vi } from "vitest";
import Stripe from "stripe";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { POST } from "@/app/api/stripe/webhook/route";
import { stripeClient } from "@/lib/billing/stripe";
import { billingSql, reconcileEvent } from "@/lib/billing/store";
vi.mock("@/lib/billing/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/billing/stripe")>()),
  stripeClient: vi.fn(),
}));
if (new URL(process.env.SUPABASE_DB_URL!).port !== "56322")
  throw Error("Dedicated local DB required");
const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });
const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  ),
  owners: string[] = [],
  customers: string[] = [];
const secret = "whsec_synthetic_signature_contract";
async function account() {
  const created = await admin.auth.admin.createUser({
    email: `billing-${randomUUID()}@signal.local`,
    password: "Synthetic-Only-Password-2026!",
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user.id,
    customer = `cus_${randomUUID()}`;
  owners.push(id);
  customers.push(customer);
  await sql`update billing_accounts set stripe_customer_id=${customer} where user_id=${id}`;
  return { id, customer };
}
function signed(payload: string, header?: string) {
  const signature =
    header ??
    new Stripe(
      "sk_test_synthetic_signing_only",
    ).webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://127.0.0.1:3210/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
afterAll(async () => {
  for (const id of owners) await admin.auth.admin.deleteUser(id);
  for (const customer of customers)
    await sql`delete from stripe_events where customer_id=${customer}`;
  await sql.end();
  await billingSql().end();
});
it("T26/T27 signed actual HTTP handler reconciles real PostgreSQL using canonical Stripe CONTRACT double, ignores forged payload entitlements", async () => {
  const { id, customer } = await account(),
    eventId = `evt_${randomUUID()}`;
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro");
  const list = vi.fn().mockResolvedValue({
    has_more: false,
    data: [
      {
        id: "sub_synthetic",
        status: "active",
        items: {
          data: [
            { price: { id: "price_pro" }, current_period_end: 2000000000 },
          ],
        },
      },
    ],
  });
  vi.mocked(stripeClient).mockReturnValue({
    subscriptions: { list },
  } as unknown as Stripe);
  const payload = JSON.stringify({
    id: eventId,
    type: "customer.subscription.updated",
    livemode: false,
    data: {
      object: {
        customer,
        metadata: { user_id: randomUUID() },
        plan: "free",
        status: "canceled",
      },
    },
  });
  expect((await POST(signed(payload))).status).toBe(200);
  expect(list).toHaveBeenCalledTimes(1);
  expect(
    (
      await sql`select plan,revision from billing_accounts where user_id=${id}`
    )[0],
  ).toEqual({ plan: "pro", revision: 1 });
  expect(await (await POST(signed(payload))).json()).toMatchObject({
    duplicate: true,
  });
  expect(list).toHaveBeenCalledTimes(1);
  for (const request of [
    signed(
      payload + " ",
      new Stripe(
        "sk_test_synthetic_signing_only",
      ).webhooks.generateTestHeaderString({ payload, secret }),
    ),
    signed(payload, "malformed"),
    signed(
      payload,
      new Stripe(
        "sk_test_synthetic_signing_only",
      ).webhooks.generateTestHeaderString({ payload, secret: "wrong-secret" }),
    ),
    signed(
      payload,
      new Stripe(
        "sk_test_synthetic_signing_only",
      ).webhooks.generateTestHeaderString({ payload, secret, timestamp: 1 }),
    ),
    signed(payload, ""),
  ])
    expect((await POST(request)).status).toBe(400);
  expect(
    (await POST(signed(payload.replace('"livemode":false', '"livemode":true'))))
      .status,
  ).toBe(400);
  expect(list).toHaveBeenCalledTimes(1);
});
it("T27 concurrent distinct deliveries serialize canonical reads under real DB customer lock", async () => {
  const { id, customer } = await account();
  let release!: () => void, entered!: () => void;
  const enteredPromise = new Promise<void>((r) => (entered = r)),
    barrier = new Promise<void>((r) => (release = r));
  let secondRead = false;
  const first = reconcileEvent(
    { id: `evt_${randomUUID()}`, type: "customer.subscription.created" },
    customer,
    async () => {
      entered();
      await barrier;
      return {
        plan: "pro",
        status: "active",
        subscriptionId: "sub_first",
        periodEnd: "2030-01-01T00:00:00Z",
      };
    },
  );
  await enteredPromise;
  const second = reconcileEvent(
    { id: `evt_${randomUUID()}`, type: "customer.subscription.deleted" },
    customer,
    async () => {
      secondRead = true;
      return {
        plan: "free",
        status: "inactive",
        subscriptionId: null,
        periodEnd: null,
      };
    },
  );
  try {
    const deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      const rows =
        await sql`select pid from pg_stat_activity where wait_event_type='Lock' and query like '%pg_advisory_xact_lock%'`;
      if (rows.length) {
        blocked = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(blocked).toBe(true);
    expect(secondRead).toBe(false);
  } finally {
    release();
  }
  await Promise.all([first, second]);
  expect(secondRead).toBe(true);
  expect(
    (
      await sql`select plan,revision from billing_accounts where user_id=${id}`
    )[0],
  ).toEqual({ plan: "free", revision: 2 });
  expect(
    await sql`select id from stripe_events where customer_id=${customer}`,
  ).toHaveLength(2);
});
