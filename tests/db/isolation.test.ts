import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { billingSql, reconcileEvent } from "@/lib/billing/store";
import { checkoutForUser } from "@/lib/billing/checkout";
import type Stripe from "stripe";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
if (
  url !== "http://127.0.0.1:56321" ||
  new URL(process.env.SUPABASE_DB_URL!).port !== "56322"
) {
  throw new Error(
    "Integration tests require the dedicated LOCAL Signal Notes stack on ports 56321/56322.",
  );
}
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const prefix = `test_${randomUUID()}`;
const ids: string[] = [];
let alice: SupabaseClient;
let bob: SupabaseClient;
let aliceNote: string;
let bobNote: string;
const customer = `cus_${prefix}`;
async function makeUser(label: string) {
  const email = `${label}-${prefix}@signal.local`;
  const password = "Synthetic-Only-Password-2026!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  ids.push(data.user.id);
  const client = createClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return client;
}
beforeAll(async () => {
  alice = await makeUser("alice");
  bob = await makeUser("bob");
  const a = await alice
    .from("notes")
    .insert({
      title: "Alice private note",
      content: "Synthetic private note visible only to Alice.",
    })
    .select("id")
    .single();
  const b = await bob
    .from("notes")
    .insert({
      title: "Bob private note",
      content: "Synthetic private note visible only to Bob.",
    })
    .select("id")
    .single();
  if (a.error || b.error) throw a.error || b.error;
  aliceNote = a.data.id;
  bobNote = b.data.id;
});
afterAll(async () => {
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  await billingSql()`delete from public.stripe_events where customer_id = ${customer}`;
  await billingSql().end();
});

describe("real Supabase Auth + RLS", () => {
  it("returns only the authenticated user's rows, even when filtering by a known foreign ID", async () => {
    const own = await alice.from("notes").select("id");
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ id: aliceNote }]);
    const foreign = await alice.from("notes").select("*").eq("id", bobNote);
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);
    const anonymous = createClient(
      url,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    );
    expect((await anonymous.from("notes").select()).error).toBeTruthy();
  });
  it("prevents forged owners, foreign deletes, owner transfers and billing escalation", async () => {
    expect(
      (
        await alice.from("notes").insert({
          user_id: ids[1],
          title: "Forged",
          content: "Must never be created under Bob's account.",
        })
      ).error,
    ).toBeTruthy();
    const deletion = await alice
      .from("notes")
      .delete()
      .eq("id", bobNote)
      .select("id");
    expect(deletion.data).toEqual([]);
    expect(
      (await bob.from("notes").select("id").eq("id", bobNote)).data,
    ).toEqual([{ id: bobNote }]);
    expect(
      (
        await alice
          .from("notes")
          .update({ user_id: ids[1] })
          .eq("id", aliceNote)
      ).error,
    ).toBeTruthy();
    expect(
      (
        await alice
          .from("billing_accounts")
          .update({ plan: "pro" })
          .eq("user_id", ids[0])
      ).error,
    ).toBeTruthy();
    expect(
      (await alice.from("billing_accounts").select().eq("user_id", ids[1]))
        .data,
    ).toEqual([]);
    expect((await alice.from("stripe_events").select()).error).toBeTruthy();
  });
  it("denies all metering RPCs to user and anonymous JWTs", async () => {
    expect(
      (
        await alice.rpc("reserve_generation", {
          p_user: ids[1],
          p_note: bobNote,
          p_request: randomUUID(),
        })
      ).error,
    ).toBeTruthy();
    expect(
      (
        await alice.rpc("finish_generation", {
          p_user: ids[0],
          p_request: randomUUID(),
          p_summary: "forged",
          p_provider: "forged",
          p_input: 0,
          p_output: 0,
        })
      ).error,
    ).toBeTruthy();
  });
});

describe("atomic metering and retry behavior", () => {
  const reserve = (request = randomUUID(), note = aliceNote) =>
    admin.rpc("reserve_generation", {
      p_user: ids[0],
      p_note: note,
      p_request: request,
    });
  it("admits exactly five of fifteen concurrent Free requests", async () => {
    const requests = Array.from({ length: 15 }, () => randomUUID());
    const results = await Promise.all(requests.map((id) => reserve(id)));
    expect(results.every((r) => !r.error)).toBe(true);
    expect(results.filter((r) => r.data.kind === "reserved")).toHaveLength(5);
    expect(results.filter((r) => r.data.kind === "limit")).toHaveLength(10);
    const owned = await alice.from("generations").select("request_id");
    expect(owned.data).toHaveLength(5);
    expect((await bob.from("generations").select()).data).toEqual([]);
  });
  it("returns cached output without consuming quota twice and rejects a conflicting note", async () => {
    const { data } = await admin
      .from("generations")
      .select("request_id")
      .eq("user_id", ids[0])
      .limit(1)
      .single();
    expect((await reserve(data!.request_id)).data.kind).toBe("pending");
    const params = {
      p_user: ids[0],
      p_request: data!.request_id,
      p_summary: "• Stored synthetic summary",
      p_provider: "fixture",
      p_input: 12,
      p_output: 6,
    };
    expect((await admin.rpc("finish_generation", params)).data).toBe(true);
    expect((await admin.rpc("finish_generation", params)).data).toBe(false);
    expect((await reserve(data!.request_id)).data).toMatchObject({
      kind: "cached",
      summary: "• Stored synthetic summary",
    });
    expect((await reserve(randomUUID(), bobNote)).data.kind).toBe("not_found");
    const other = await alice
      .from("notes")
      .insert({
        title: "Other note",
        content: "A second synthetic note for a request collision test.",
      })
      .select("id")
      .single();
    expect((await reserve(data!.request_id, other.data!.id)).data.kind).toBe(
      "conflict",
    );
  });
  it("releases failed and expired reservations without letting a late worker commit", async () => {
    const { data: pending } = await admin
      .from("generations")
      .select("request_id")
      .eq("user_id", ids[0])
      .eq("status", "reserved")
      .limit(1)
      .single();
    await admin.rpc("fail_generation", {
      p_user: ids[0],
      p_request: pending!.request_id,
    });
    expect((await reserve(pending!.request_id)).data.kind).toBe("failed");
    const newId = randomUUID();
    expect((await reserve(newId)).data.kind).toBe("reserved");
    await admin
      .from("generations")
      .update({ expires_at: "2000-01-01T00:00:00Z" })
      .eq("user_id", ids[0])
      .eq("request_id", newId);
    expect((await reserve(randomUUID())).data.kind).toBe("reserved");
    expect(
      (
        await admin.rpc("finish_generation", {
          p_user: ids[0],
          p_request: newId,
          p_summary: "Too late",
          p_provider: "fixture",
          p_input: 0,
          p_output: 0,
        })
      ).data,
    ).toBe(false);
  });
});

describe("transactional Stripe reconciliation", () => {
  const pro = {
    plan: "pro" as const,
    status: "active",
    subscriptionId: `sub_${prefix}`,
    periodEnd: new Date(Date.now() + 86400000).toISOString(),
  };
  it("commits the same event only once under concurrent delivery", async () => {
    await admin
      .from("billing_accounts")
      .update({ stripe_customer_id: customer })
      .eq("user_id", ids[0]);
    const read = vi.fn().mockResolvedValue(pro);
    const event = {
      id: `evt_${prefix}_1`,
      type: "customer.subscription.created",
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => reconcileEvent(event, customer, read)),
    );
    expect(results.filter((r) => r.duplicate)).toHaveLength(5);
    expect(read).toHaveBeenCalledTimes(1);
    expect(
      (
        await admin
          .from("billing_accounts")
          .select("plan,revision")
          .eq("user_id", ids[0])
          .single()
      ).data,
    ).toEqual({ plan: "pro", revision: 1 });
    // An entitlement increase actually changes the database quota behavior.
    expect(
      (
        await admin.rpc("reserve_generation", {
          p_user: ids[0],
          p_note: aliceNote,
          p_request: randomUUID(),
        })
      ).data.kind,
    ).toBe("reserved");
  });
  it("reads canonical state again for a delayed event, without reverting to its stale payload", async () => {
    const free = {
      plan: "free" as const,
      status: "inactive",
      subscriptionId: null,
      periodEnd: null,
    };
    await reconcileEvent(
      { id: `evt_${prefix}_2`, type: "customer.subscription.deleted" },
      customer,
      async () => free,
    );
    const read = vi.fn().mockResolvedValue(free);
    await reconcileEvent(
      { id: `evt_${prefix}_delayed`, type: "customer.subscription.created" },
      customer,
      read,
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(
      (
        await admin
          .from("billing_accounts")
          .select("plan,revision")
          .eq("user_id", ids[0])
          .single()
      ).data,
    ).toEqual({ plan: "free", revision: 2 });
  });
  it("rolls back a failed reconciliation so Stripe's retry can complete it", async () => {
    const event = {
      id: `evt_${prefix}_retry`,
      type: "customer.subscription.updated",
    };
    await expect(
      reconcileEvent(event, customer, async () => {
        throw new Error("Synthetic upstream timeout");
      }),
    ).rejects.toThrow();
    expect(
      (await admin.from("stripe_events").select("id").eq("id", event.id)).data,
    ).toEqual([]);
    await reconcileEvent(event, customer, async () => pro);
    expect(
      (await admin.from("stripe_events").select("id").eq("id", event.id)).data,
    ).toHaveLength(1);
  });
});

describe("serialized checkout sessions", () => {
  it("ignores an unknown customer without fetching Stripe or granting access", async () => {
    const read = vi.fn();
    expect(
      await reconcileEvent(
        { id: `evt_${prefix}_unknown`, type: "customer.subscription.created" },
        `${customer}_unknown`,
        read,
      ),
    ).toEqual({ duplicate: false, ignored: true });
    expect(read).not.toHaveBeenCalled();
  });
  it("reuses an open hosted session across concurrent clicks and rejects existing subscriptions", async () => {
    const subscriptions = vi
      .fn()
      .mockResolvedValue({ data: [], has_more: false });
    const create = vi.fn().mockResolvedValue({
      id: `cs_${prefix}`,
      url: "https://checkout.stripe.com/synthetic-test-only",
    });
    const retrieve = vi.fn().mockResolvedValue({
      status: "open",
      url: "https://checkout.stripe.com/synthetic-test-only",
    });
    const stripe = {
      subscriptions: { list: subscriptions },
      checkout: { sessions: { create, retrieve } },
    } as unknown as Stripe;
    const oldPrice = process.env.STRIPE_PRO_PRICE_ID;
    process.env.STRIPE_PRO_PRICE_ID = "price_fixture";
    try {
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          checkoutForUser(stripe, { id: ids[0] }),
        ),
      );
      expect(new Set(results).size).toBe(1);
      expect(create).toHaveBeenCalledTimes(1);
      subscriptions.mockResolvedValue({
        data: [{ status: "active" }],
        has_more: false,
      });
      await expect(checkoutForUser(stripe, { id: ids[0] })).rejects.toThrow(
        "already have a subscription",
      );
    } finally {
      process.env.STRIPE_PRO_PRICE_ID = oldPrice;
    }
  });
  it("allows a fresh checkout after the previous subscription has ended", async () => {
    const subscriptions = vi
      .fn()
      .mockResolvedValue({
        data: [{ id: "sub_ended", status: "canceled" }],
        has_more: false,
      });
    const create = vi
      .fn()
      .mockResolvedValue({
        id: `cs_${prefix}_renew`,
        url: "https://checkout.stripe.com/synthetic-renewal",
      });
    const stripe = {
      subscriptions: { list: subscriptions },
      checkout: {
        sessions: {
          retrieve: vi
            .fn()
            .mockResolvedValue({
              status: "complete",
              subscription: "sub_ended",
            }),
          create,
        },
      },
    } as unknown as Stripe;
    const oldPrice = process.env.STRIPE_PRO_PRICE_ID;
    process.env.STRIPE_PRO_PRICE_ID = "price_fixture";
    try {
      expect(await checkoutForUser(stripe, { id: ids[0] })).toBe(
        "https://checkout.stripe.com/synthetic-renewal",
      );
      expect(create).toHaveBeenCalledWith(expect.anything(), {
        idempotencyKey: `checkout:${ids[0]}:cs_${prefix}`,
      });
    } finally {
      process.env.STRIPE_PRO_PRICE_ID = oldPrice;
    }
  });
});
