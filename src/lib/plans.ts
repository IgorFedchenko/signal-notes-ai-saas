export const PLANS = {
  free: { name: "Free", limit: 5, price: "$0" },
  pro: { name: "Pro", limit: 100, price: "$12" },
} as const;
export type BillingAccount = {
  plan: string;
  status: string;
  period_end: string | null;
  stripe_customer_id?: string | null;
};
export function effectivePlan(
  account: BillingAccount | null,
  now = new Date(),
): "free" | "pro" {
  return account?.plan === "pro" &&
    ["active", "trialing"].includes(account.status) &&
    account.period_end &&
    new Date(account.period_end) > now
    ? "pro"
    : "free";
}
export function periodStart(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
