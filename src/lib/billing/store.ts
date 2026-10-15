import "server-only";
import postgres from "postgres";
import type { SubscriptionSnapshot } from "./stripe";

let connection: ReturnType<typeof postgres> | undefined;
export function billingSql() {
  if (connection) return connection;
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("Billing database is not configured");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(url).hostname,
  );
  connection = postgres(url, {
    max: 2,
    prepare: false,
    ssl: local ? false : "verify-full",
    connect_timeout: 5,
    idle_timeout: 5,
    onnotice: () => undefined,
  });
  return connection;
}
export async function reconcileEvent(
  event: { id: string; type: string },
  customer: string,
  readCurrent: () => Promise<SubscriptionSnapshot>,
) {
  return billingSql().begin(async (tx) => {
    // Keep the lock while reading Stripe. Fetching before this lock permits stale concurrent writes.
    await tx`select pg_advisory_xact_lock(hashtextextended(${customer}, 2))`;
    const existing =
      await tx`select id from public.stripe_events where id = ${event.id}`;
    if (existing.length) return { duplicate: true, ignored: false };
    const accounts =
      await tx`select user_id from public.billing_accounts where stripe_customer_id = ${customer} for update`;
    if (!accounts.length) return { duplicate: false, ignored: true };
    const state = await readCurrent();
    await tx`update public.billing_accounts set plan = ${state.plan}, status = ${state.status},
      stripe_subscription_id = ${state.subscriptionId}, period_end = ${state.periodEnd},
      revision = revision + 1, updated_at = now() where stripe_customer_id = ${customer}
      and (plan, status, stripe_subscription_id, period_end) is distinct from
      (${state.plan}::text, ${state.status}::text, ${state.subscriptionId}::text, ${state.periodEnd}::timestamptz)`;
    await tx`insert into public.stripe_events(id, event_type, customer_id) values (${event.id}, ${event.type}, ${customer})`;
    return { duplicate: false, ignored: false };
  });
}
