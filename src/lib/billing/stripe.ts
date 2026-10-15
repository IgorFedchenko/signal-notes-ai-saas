import "server-only";
import Stripe from "stripe";
import { HttpError } from "@/lib/http";

export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_"))
    throw new HttpError(
      503,
      "Stripe test billing has not been configured yet.",
    );
  return new Stripe(key, { timeout: 8000, maxNetworkRetries: 1 });
}
export function billingReady() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") &&
    process.env.STRIPE_PRO_PRICE_ID &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.SUPABASE_DB_URL,
  );
}
export function verifyEvent(payload: string, signature: string) {
  if (!process.env.STRIPE_WEBHOOK_SECRET)
    throw new HttpError(503, "Webhook is not configured.");
  // Signature verification needs no API key and never calls Stripe.
  const stripe = new Stripe("sk_test_signature_verification_only");
  try {
    return stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    throw new HttpError(400, "Invalid webhook signature.");
  }
}
export type SubscriptionSnapshot = {
  plan: "free" | "pro";
  status: string;
  subscriptionId: string | null;
  periodEnd: string | null;
};
export async function currentSubscription(
  stripe: Stripe,
  customer: string,
): Promise<SubscriptionSnapshot> {
  const subscriptions = await stripe.subscriptions.list({
    customer,
    status: "all",
    limit: 100,
  });
  if (subscriptions.has_more)
    throw new Error("Subscription reconciliation requires pagination");
  const candidates = subscriptions.data.filter(
    (s) =>
      ["active", "trialing"].includes(s.status) &&
      s.items.data.some(
        (item) => item.price.id === process.env.STRIPE_PRO_PRICE_ID,
      ),
  );
  // Refuse ambiguous entitlements instead of silently picking one of two paid subscriptions.
  if (candidates.length > 1)
    throw new Error("Multiple active subscriptions require review");
  const sub = candidates[0];
  if (!sub)
    return {
      plan: "free",
      status: "inactive",
      subscriptionId: null,
      periodEnd: null,
    };
  const item = sub.items.data.find(
    (item) => item.price.id === process.env.STRIPE_PRO_PRICE_ID,
  )!;
  return {
    plan: "pro",
    status: sub.status,
    subscriptionId: sub.id,
    periodEnd: new Date(item.current_period_end * 1000).toISOString(),
  };
}
