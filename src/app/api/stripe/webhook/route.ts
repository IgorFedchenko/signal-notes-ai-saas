import type Stripe from "stripe";
import {
  verifyEvent,
  stripeClient,
  currentSubscription,
} from "@/lib/billing/stripe";
import { reconcileEvent } from "@/lib/billing/store";
import { failure, HttpError, readText } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 262144)
      throw new HttpError(413, "Webhook too large.");
    const raw = await readText(request, 262144);
    const event = verifyEvent(
      raw,
      request.headers.get("stripe-signature") ?? "",
    );
    if (event.livemode)
      throw new HttpError(400, "Only Stripe test mode is supported.");
    if (
      ![
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "checkout.session.completed",
      ].includes(event.type)
    ) {
      return Response.json({ received: true, ignored: true });
    }
    const object = event.data.object as
      Stripe.Subscription | Stripe.Checkout.Session;
    const customer =
      typeof object.customer === "string"
        ? object.customer
        : object.customer?.id;
    if (!customer) throw new HttpError(400, "Missing customer.");
    const result = await reconcileEvent(event, customer, () =>
      currentSubscription(stripeClient(), customer),
    );
    return Response.json({ received: true, ...result });
  } catch (error) {
    return failure(error);
  }
}
