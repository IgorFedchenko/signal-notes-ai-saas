# Delivery and acceptance

Build a usable note summarizer for SaaS clients who need authentication, billing,
private data, and bounded AI consumption without assembling those concerns themselves.

1. Foundation: private MIT repository, pinned dependencies, one-command local Supabase setup.
2. Identity and persistence: signup/login/logout; create and delete personal notes;
   two real Auth users cannot read, mutate, or transfer each other's data.
3. Metering: reserve usage atomically before generation; concurrent requests cannot
   exceed Free (5) or Pro (100) summaries per UTC calendar month. Retry the same request
   without charging twice. Provider failures release quota. Record actual model tokens.
4. Billing: test-only Stripe checkout and customer portal; authenticate all requests;
   verify raw webhook signatures. Serialize reconciliation per customer in Postgres,
   read current Stripe state, and atomically commit state with the event receipt.
5. Interface: responsive workspace, clear errors/limits, pricing, summary and usage history.
6. Evidence: unit tests, real Supabase integration/RLS/concurrency tests, browser E2E,
   screenshots, CI passing on the remote commit, English README and portfolio copy.

External acceptance requires owner-provided test credentials: actual hosted Stripe
Checkout/Portal roundtrip and a Vercel/Supabase hosted deployment. Do not claim these
were verified using a fake provider. Do not make the repository public before review.

Architecture: Next.js server routes coordinate external effects; Postgres owns
authorization, atomic quota reservations, and durable idempotency. No queue or separate
backend is needed for bounded, synchronous note summaries in this reference app.
