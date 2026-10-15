# Signal Notes

[![CI](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Stack: Next.js · Supabase · Stripe](https://img.shields.io/badge/stack-Next.js_·_Supabase_·_Stripe-315b4c)

**Private notes → evidence-backed takeaways, with authentication, subscriptions and bounded AI usage.**

A small SaaS reference for clients shipping a Next.js product with Supabase Auth/RLS,
Stripe test billing, durable request keys, and understandable AI limits. All inputs
are synthetic. MIT licensed; no employer/client code or data.

![Earlier real local workspace acceptance](docs/screenshots/workspace.png)

[Mobile](docs/screenshots/mobile.png) · [Verification](docs/VERIFICATION.md) ·
[Demo recording](demos/README.md) — the updated GIF is pending real capture.

## Two-minute tour

1. Sign in, create a short release note with a decision, date and owner, and save it.
2. Summarize: expand **Evidence** to see exact source quotes. Reload to see persistence.
3. Open **Usage & activity**: inspect tokens, estimated cost/exposure, prompt version,
   latency and trace ID. Free allows 5 summaries; Pro allows 100 per UTC month.
4. Open **Plan & billing**. Checkout is visibly unavailable until Stripe test settings
   exist; a redirect never grants Pro access.

The default **local extractive provider** selects source sentences and abstains on
empty-of-facts/instruction-only inputs. It makes no model calls and costs $0. It is
not evidence of live LLM quality. Live model/judge, actual Stripe-hosted test payment,
hosted deployment and public visibility remain [separate pending gates](docs/VERIFICATION.md).

## Run from a clean clone

Node.js 22–26, npm and a running Docker engine are required:

```sh
npm run demo
```

The launcher installs locked dependencies, starts this project's isolated Supabase,
applies migrations, seeds synthetic data and starts Next.js at **http://127.0.0.1:3210**.
Sign in as `demo@signal.local` / `SignalNotes-Demo-2026!`, or create a local account.
These disposable credentials are never for a hosted service. The first image download
may take several minutes. Owner-managed `.env.local` files are never overwritten.

**Ctrl+C stops the app and its dedicated stack.** Recovery: `npm run local:stop`;
if Phoenix was enabled, `docker compose --profile observability down`.
Ports: app 3210, Supabase API 56321, Postgres 56322, local mail 56324.

On Studio, wrap the whole command in `~/.local/bin/studio-heavy-run --`.
Builds, Docker operations and browser checks on that host use the same queue.

```sh
npm run demo -- --smoke            # whole bootstrap, real HTTP/Auth/DB smoke, shutdown
npm run demo -- --smoke --phoenix  # also read actual route spans back from Phoenix
npm run demo -- --capture          # real UI → GIF; needs ffmpeg + Chromium system libs
```

## Architecture

```mermaid
flowchart LR
    Browser --> Next[Next.js routes]
    Next --> Auth[Supabase Auth]
    Next -->|user JWT + RLS| DB[(Postgres)]
    Next --> Reserve[Atomic count + cost reservation]
    Reserve --> DB
    Reserve --> Permit[Acknowledged unexpired attempt CAS]
    Permit --> Model[Local extraction / approved model]
    Model --> Validate[Strict JSON + original evidence]
    Validate --> Persist[Result + usage settlement]
    Persist --> DB
    Next -. safe spans .-> Phoenix[Optional local Phoenix]
    Next --> Checkout[Stripe test Checkout / Portal]
    Stripe[Signed webhook] --> Lock[Customer transaction lock]
    Lock --> Current[Read canonical Stripe state]
    Current --> Commit[Entitlement + unique event receipt]
    Commit --> DB
```

Pages/routes stay in `src/app`; focused views in `src/components/workspace`; contract,
prompt/provider/prices in `src/lib/ai`; safe logs and explicit OTel spans in
`src/lib/observability`. Additive SQL migrations own authorization and ledger invariants.
No vector DB, worker queue, retrieval, agents or model tools.

## Reliability, privacy and money

- **Isolation:** immutable notes use user JWTs and RLS. Users cannot write billing,
  metering or webhook receipts. Elevated credentials stay server-only.
- **Bounded attempts:** one provider call, zero automatic retries/tools; full serialized
  UTF-8 input ≤65,536 bytes; output default 800 tokens, hard maximum 2,000; timeout 25s,
  reservation TTL 2 minutes. Unknown model/price/cap fails before networking.
- **Fencing:** only a positive DB attempt acknowledgement permits a call. Its frozen
  snapshot binds model, dated rates, caps and UTC month. Success retries return saved
  results; failed/expired/ambiguous IDs cannot start another provider call.
- **Cost:** reserve conservative maximum exposure, settle successful reported tokens.
  Free holds at most **$0.10** and Pro **$2** estimated exposure per month. Attempted
  failures/timeouts keep maximum unknown exposure, even after freeing their count slot;
  late workers cannot refund it. These integer micro-USD estimates are not provider bills.
  Local extraction is $0. Historical records explicitly have unknown costs.
- **Deletion:** a DB trigger removes source-derived summary/evidence for API and direct
  user-JWT deletes. IDs, usage and costs remain. Coordinated finalization prevents late
  text resurrection; history labels the note deleted.
- **AI boundaries:** strict schema and exact original quotes, explicit insufficient
  outcome, versioned prompt/hash/model/schema. Notes are untrusted data; React escapes
  output. Exact quotes alone do not prove a claim is true or defeat every injection.
- **Billing:** Stripe test keys/events only, raw signature verification, unique receipts,
  customer transaction locks, canonical current-state reconciliation and checkout reuse.
  Upstream failure rolls back the receipt; delayed events cannot restore stale access.
- **Observability:** allowlisted JSON and real generation/reserve/provider/persist spans;
  no note, prompt, response/evidence, email, cookie, key or arbitrary Error serialization.
  Export off by default; exporter outage does not fail a summary.

See four short [architecture decisions](docs/adr/001-postgres-boundaries.md) and
[deployment/cutover notes](docs/DEPLOYMENT.md). Exactly-once external model execution
is not promised. Conservative unknown exposure may require operator reconciliation.

## Evaluation and checks

```sh
npm run check            # format, lint, types, unit, recorded evaluator + negative controls
npm run hooks:install    # staged format + fast checks; no Docker/build/browser in hook
npm run local:setup
npm run test:db          # real local Supabase Auth/RLS/quotas/billing transactions
npm run build
node --env-file=.env.local scripts/check-client-secrets.mjs
npx playwright install chromium
npm run test:e2e         # actual app/Auth/DB, local extraction, desktop + mobile
```

The [frozen evaluator](evals/README.md) contains **12 synthetic cases / 40 facts**:
6 normal, 4 fact-plus-attack, 2 insufficient. Manual canonical responses validate the
harness: schema/exact evidence and fact-source support 100%, precision 1.0, macro recall
≥0.85 and each factual case ≥0.67, attack leakage 0. Negative controls must fail their
named gates. Actual local-provider kind/evidence checks are reported separately.
This is contract/evaluator evidence, not live model quality or a live judge verdict.

GitHub CI runs these checks plus actual DB/browser tests, dependency audit, pinned OSS
Gitleaks scan/negative twin, whole-launch shutdown and optional Phoenix readback.
Dependabot covers npm/Actions weekly. CodeQL analysis is public-only and is skipped
while private; native public secret scanning awaits publication approval. No paid
security upgrade or model key is used in CI.

## Optional services

**Phoenix:** `npm run demo -- --smoke --phoenix` uses pinned image 20.22.0 plus digest,
loopback `http://127.0.0.1:56006`, ephemeral storage and no cloud account. For an
owner-managed app, set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the controlled OTLP HTTP
endpoint (local `/v1/traces`). Never put auth values in URL query/userinfo.

**Stripe test mode:** create a monthly USD 12 recurring test price, enable the customer
portal for that price, and provide `STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID`,
`STRIPE_WEBHOOK_SECRET` and `SUPABASE_DB_URL` in ignored server settings. Forward the
four subscription/checkout events to `/api/stripe/webhook` using Stripe CLI. Sign in,
choose **Try Pro in test mode**, complete an actual hosted test checkout and verify
its webhook before claiming payment acceptance. No such roundtrip is claimed yet.

**Live model/judge:** owner consent, a provisioned key, current supported snapshot/rates
and one approved persistent candidate+judge budget ≤$1 are prerequisites. See
[the fail-closed live runner contract](evals/README.md). Key presence is not consent.
App-live generation additionally requires explicit spend allocation and
`AI_PROVIDER=openai`, approved server config and `AI_LIVE_APPROVED=true`.
The checked-in snapshot is a dated reference to reverify, not permission to use it.

## Scope

A reference implementation, not an operated hosted service. Latest 100 notes and 200
history rows are displayed; monthly totals query the full ledger separately. Quotas
reset on UTC calendar months, independent of invoice dates. Hosted Auth/SMTP, public
signup abuse controls and free-host eligibility require owner-assisted deployment.
No uploads, organization sharing, real personal data, paid infrastructure or Stripe
live payments. Repository visibility stays private until owner review.

Built by Igor Fedchenko · [Portfolio copy](docs/PORTFOLIO.md) · [Changelog](CHANGELOG.md)
