import { afterEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import {
  currentSubscription,
  stripeClient,
  verifyEvent,
} from "@/lib/billing/stripe";
afterEach(() => vi.unstubAllEnvs());
describe("Stripe boundary", () => {
  it("accepts a signed raw payload and rejects tampering or an old timestamp", () => {
    const stripe = new Stripe("sk_test_local_only");
    const secret = "whsec_synthetic_test_secret";
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      id: "evt_test",
      type: "customer.subscription.updated",
      data: { object: {} },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    expect(verifyEvent(payload, signature).id).toBe("evt_test");
    expect(() => verifyEvent(payload + " ", signature)).toThrow(
      "Invalid webhook signature",
    );
    expect(() =>
      verifyEvent(
        payload,
        stripe.webhooks.generateTestHeaderString({
          payload,
          secret,
          timestamp: 1,
        }),
      ),
    ).toThrow();
  });
  it("fails closed for live keys", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_synthetic_not_a_credential");
    expect(() => stripeClient()).toThrow("test billing");
  });
  it("maps only the configured recurring price to Pro", async () => {
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro");
    const list = vi.fn().mockResolvedValue({
      has_more: false,
      data: [
        {
          id: "sub_1",
          status: "active",
          items: {
            data: [
              { price: { id: "price_pro" }, current_period_end: 2000000000 },
            ],
          },
        },
      ],
    });
    const stripe = { subscriptions: { list } } as unknown as Stripe;
    expect(await currentSubscription(stripe, "cus_fixture")).toMatchObject({
      plan: "pro",
      subscriptionId: "sub_1",
    });
    list.mockResolvedValue({
      has_more: false,
      data: [
        {
          id: "sub_2",
          status: "past_due",
          items: { data: [{ price: { id: "price_pro" } }] },
        },
      ],
    });
    expect(await currentSubscription(stripe, "cus_fixture")).toMatchObject({
      plan: "free",
    });
    list.mockResolvedValue({
      has_more: false,
      data: [
        {
          id: "sub_3",
          status: "active",
          items: { data: [{ price: { id: "price_unknown" } }] },
        },
      ],
    });
    expect(await currentSubscription(stripe, "cus_fixture")).toMatchObject({
      plan: "free",
    });
  });
});
