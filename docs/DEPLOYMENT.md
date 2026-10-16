# Optional deployment reference

No hosted project, live model or Stripe-hosted payment is connected. All three are
outside this case's scope, with no access or credentials requested for acceptance.
The checklist below is retained for a separately authorized future deployment.
Do not execute it as part of local verification or enable a paid plan/model call.

1. Owner creates or grants access to a free Supabase project and an eligible Vercel
   project. Confirm Vercel's Hobby terms permit the intended personal demo use.
2. Deploy only a clean, published `main` matching `origin/main`, using the platform's
   normal Git deployment. Never bypass deployment guards or publish another branch.
3. Apply all checked-in migrations in order to the new, empty Supabase project with the
   normal Supabase migration workflow. Do not run local test scripts against hosted data.
4. In Supabase Auth, configure the exact public site URL, enable email confirmation,
   set up SMTP, and set the confirmation template to:

   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup"
     >Confirm your account</a
   >
   ```

   Local email confirmation is deliberately disabled for isolated E2E. Do not reuse
   the public local demo credentials in a hosted project.

5. Owner places `.env.example` values in Vercel project settings, never chat or Git.
   Use the hosted Supabase URL/publishable key, server-only service-role key and
   transaction-pooler DSN. Use `APP_URL` with the exact canonical HTTPS origin.
   Start with `AI_PROVIDER=fixture`, without an LLM key. No server key uses a
   `NEXT_PUBLIC_` prefix.
6. For the optional Stripe integration, configure a monthly USD 12 recurring test
   price and enable its customer portal. Server-only settings are `STRIPE_SECRET_KEY`,
   `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` and `SUPABASE_DB_URL`.
   Register a snapshot
   webhook for `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, and `customer.subscription.deleted` at `/api/stripe/webhook`; use the SDK's
   matching API version. Enable the customer portal with only the configured price.
7. Verify on the hosted URL: signup/confirmation/login, private note and summary,
   test checkout, plan updated via webhook, customer portal cancellation, repeat
   webhook and unchanged revision. Check another user's account is isolated.
8. Record the URL and deployed SHA in `docs/VERIFICATION.md`. Keep GitHub private
   until the common portfolio review and explicit publication approval.

For a public fixture demo, UI disclosure must stay visible. Optional real generation
requires approval of the model key and spend, provider-side caps and abuse controls.

## Upgrading an existing reference database

Stop only this app's old workers before the v2 migration; do not cut over with old
in-flight provider jobs. Keep the original migration unchanged and apply the additive
`202610160002_generation_contract.sql`. It labels historical costs unknown, retains
successful count/dedup history, fails unfinished legacy reservations, and removes the
old mutating RPC signatures even for service_role. Do not keep an old caller running
against the new schema. Validate empty and baseline-seeded upgrades on disposable
local databases before touching any hosted database.

Note deletion purges derived text at the DB boundary, including direct RLS DELETE;
non-content usage/cost/dedup IDs intentionally remain. Attempted/ambiguous failures
retain conservative exposure. Review privacy retention and operator reconciliation
before any real-data deployment; this demo uses synthetic data only.
