import { ArrowUpRight, Check, CreditCard } from "lucide-react";
import { PLANS, type BillingAccount } from "@/lib/plans";
export function BillingPanel({
  account,
  billingEnabled,
  busy,
  plan,
  billing,
}: {
  account: BillingAccount;
  billingEnabled: boolean;
  busy: string;
  plan: "free" | "pro";
  billing: (kind: "checkout" | "portal") => Promise<void>;
}) {
  return (
    <section className="billing-panel">
      <div className="price-grid">
        {(["free", "pro"] as const).map((p) => (
          <article
            key={p}
            className={`price-card ${p === "pro" ? "featured" : ""}`}
          >
            <span className="tag">
              {PLANS[p].name}
              {p === plan ? " · CURRENT PLAN" : ""}
            </span>
            <h3>
              {PLANS[p].price}
              <small>/ month</small>
            </h3>
            <p>
              {p === "free"
                ? "For a fresh perspective."
                : "For a mind full of ideas."}
            </p>
            <div className="price-feature">
              <Check size={16} />
              {PLANS[p].limit} summaries per UTC month
            </div>
            <div className="price-feature">
              <Check size={16} />
              Private notes & summary history
            </div>
            <button
              className={`button ${p === "pro" ? "primary" : "secondary"}`}
              disabled={!!busy || p === plan || p === "free" || !billingEnabled}
              onClick={() => billing("checkout")}
            >
              {p === plan
                ? "Your current plan"
                : p === "free"
                  ? "Manage in billing portal"
                  : "Try Pro in test mode"}
              <ArrowUpRight size={15} />
            </button>
          </article>
        ))}
      </div>
      <div className="billing-note">
        <CreditCard size={20} />
        <div>
          <h3>Billing, on your terms.</h3>
          <p>
            {billingEnabled
              ? "Stripe test mode is enabled. Use test payment details only. No real money is collected."
              : "Stripe test billing is not connected in this local demo. Checkout becomes available when the owner configures test credentials."}
          </p>
          <button
            className="text-button"
            disabled={!!busy || !billingEnabled || !account.stripe_customer_id}
            onClick={() => billing("portal")}
          >
            Open customer portal <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
