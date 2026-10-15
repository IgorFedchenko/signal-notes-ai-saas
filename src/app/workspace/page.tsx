import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase/server";
import { Workspace } from "@/components/workspace";
import { billingReady } from "@/lib/billing/stripe";
import { periodStart } from "@/lib/plans";
export const dynamic = "force-dynamic";
export default async function WorkspacePage() {
  const db = await userClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect("/login");
  const [notes, generations, account, monthly] = await Promise.all([
    db
      .from("notes")
      .select("id,title,content,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("generations")
      .select(
        "request_id,note_id,summary,provider,status,period,input_tokens,output_tokens,created_at,expires_at",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("billing_accounts")
      .select("plan,status,period_end,stripe_customer_id")
      .eq("user_id", auth.user.id)
      .single(),
    db
      .from("generations")
      .select("input_tokens,output_tokens")
      .eq("period", periodStart())
      .or(
        `status.eq.succeeded,and(status.eq.reserved,expires_at.gt.${new Date().toISOString()})`,
      ),
  ]);
  if (notes.error || generations.error || account.error || monthly.error)
    throw new Error("Workspace is temporarily unavailable");
  return (
    <Workspace
      email={auth.user.email ?? "Your account"}
      notes={notes.data}
      generations={generations.data}
      account={account.data}
      monthlyUsage={{
        used: monthly.data.length,
        tokens: monthly.data.reduce(
          (sum, row) => sum + row.input_tokens + row.output_tokens,
          0,
        ),
      }}
      billingEnabled={billingReady()}
      fixture={process.env.AI_PROVIDER === "fixture"}
    />
  );
}
