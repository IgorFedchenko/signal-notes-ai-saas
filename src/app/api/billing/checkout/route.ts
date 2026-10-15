import { identity, sameOrigin, failure } from "@/lib/http";
import { stripeClient } from "@/lib/billing/stripe";
import { checkoutForUser } from "@/lib/billing/checkout";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { user } = await identity();
    const url = await checkoutForUser(stripeClient(), user);
    return Response.json({ url });
  } catch (error) {
    return failure(error);
  }
}
