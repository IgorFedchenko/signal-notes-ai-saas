import { identity, sameOrigin, failure, HttpError } from "@/lib/http";
import { stripeClient } from "@/lib/billing/stripe";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { user, db } = await identity();
    const { data, error } = await db
      .from("billing_accounts")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();
    if (error || !data?.stripe_customer_id)
      throw new HttpError(409, "Start a test subscription first.");
    const session = await stripeClient().billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${process.env.APP_URL}/workspace`,
    });
    return Response.json({ url: session.url });
  } catch (error) {
    return failure(error);
  }
}
