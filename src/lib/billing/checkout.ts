import "server-only";
import type Stripe from "stripe";
import { billingSql } from "./store";
import { HttpError } from "@/lib/http";

export async function checkoutForUser(
  stripe: Stripe,
  user: { id: string; email?: string },
) {
  const price = process.env.STRIPE_PRO_PRICE_ID;
  if (!price) throw new HttpError(503, "Pro pricing is not configured.");
  return billingSql().begin(async (tx) => {
    const [account] =
      await tx`select stripe_customer_id, checkout_session_id from public.billing_accounts where user_id = ${user.id} for update`;
    if (!account) throw new Error("Billing account unavailable");
    let customer = account.stripe_customer_id as string | null;
    if (!customer) {
      const created = await stripe.customers.create(
        { email: user.email, metadata: { user_id: user.id } },
        { idempotencyKey: `customer:${user.id}` },
      );
      customer = created.id;
      await tx`update public.billing_accounts set stripe_customer_id = ${customer} where user_id = ${user.id}`;
    }
    const existing = await stripe.subscriptions.list({
      customer,
      status: "all",
      limit: 100,
    });
    if (
      existing.has_more ||
      existing.data.some(
        (s) => !["canceled", "incomplete_expired"].includes(s.status),
      )
    ) {
      throw new HttpError(
        409,
        "You already have a subscription. Manage it in the billing portal.",
      );
    }
    if (account.checkout_session_id) {
      const previous = await stripe.checkout.sessions.retrieve(
        account.checkout_session_id,
      );
      if (previous.status === "open" && previous.url) return previous.url;
      const previousSubscription =
        typeof previous.subscription === "string"
          ? previous.subscription
          : previous.subscription?.id;
      const previousEnded = existing.data.some(
        (s) =>
          s.id === previousSubscription &&
          ["canceled", "incomplete_expired"].includes(s.status),
      );
      if (previous.status === "complete" && !previousEnded)
        throw new HttpError(
          409,
          "Checkout is being finalized. Refresh your plan shortly.",
        );
    }
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer,
        line_items: [{ price, quantity: 1 }],
        success_url: `${process.env.APP_URL}/workspace?billing=success`,
        cancel_url: `${process.env.APP_URL}/workspace?billing=canceled`,
        client_reference_id: user.id,
        subscription_data: { metadata: { user_id: user.id } },
        allow_promotion_codes: false,
      },
      {
        idempotencyKey: `checkout:${user.id}:${account.checkout_session_id ?? "initial"}`,
      },
    );
    if (!session.url) throw new Error("Missing checkout URL");
    await tx`update public.billing_accounts set checkout_session_id = ${session.id} where user_id = ${user.id}`;
    return session.url;
  });
}
