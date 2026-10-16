import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as checkout } from "@/app/api/billing/checkout/route";
import { POST as portal } from "@/app/api/billing/portal/route";
import { identity, HttpError } from "@/lib/http";
import { stripeClient } from "@/lib/billing/stripe";
import { checkoutForUser } from "@/lib/billing/checkout";
vi.mock("@/lib/http", async (original) => ({
  ...(await original<typeof import("@/lib/http")>()),
  identity: vi.fn(),
}));
vi.mock("@/lib/billing/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/billing/stripe")>()),
  stripeClient: vi.fn(),
}));
vi.mock("@/lib/billing/checkout", () => ({ checkoutForUser: vi.fn() }));
const user = { id: "authenticated-owner" },
  create = vi.fn();
function request() {
  return new Request("http://127.0.0.1:3210/api/billing", {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:3210",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: "forged",
      customer: "cus_foreign",
      plan: "pro",
      price: "price_attacker",
    }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "http://127.0.0.1:3210");
  vi.mocked(identity).mockResolvedValue({
    user,
    db: {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { stripe_customer_id: "cus_owned" },
              error: null,
            }),
          }),
        }),
      }),
    },
  } as unknown as Awaited<ReturnType<typeof identity>>);
  create.mockResolvedValue({
    url: "https://billing.stripe.com/synthetic-only",
  });
  vi.mocked(stripeClient).mockReturnValue({
    billingPortal: { sessions: { create } },
  } as unknown as ReturnType<typeof stripeClient>);
  vi.mocked(checkoutForUser).mockResolvedValue(
    "https://checkout.stripe.com/synthetic-only",
  );
});
afterEach(() => vi.unstubAllEnvs());
it("T26 checkout and portal use authenticated owner/server customer despite forged body", async () => {
  expect((await checkout(request())).status).toBe(200);
  expect(checkoutForUser).toHaveBeenCalledWith(expect.anything(), user);
  expect((await portal(request())).status).toBe(200);
  expect(create).toHaveBeenCalledWith({
    customer: "cus_owned",
    return_url: "http://127.0.0.1:3210/workspace",
  });
});
it.each([checkout, portal])(
  "T26 billing requires authenticated identity before Stripe work",
  async (route) => {
    vi.mocked(identity).mockRejectedValue(
      new HttpError(401, "Please sign in.", "authentication_required"),
    );
    expect((await route(request())).status).toBe(401);
    expect(stripeClient).not.toHaveBeenCalled();
    expect(checkoutForUser).not.toHaveBeenCalled();
  },
);
