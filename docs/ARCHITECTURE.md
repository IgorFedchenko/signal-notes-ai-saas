# Architecture

Signal Notes is a synchronous Next.js App Router application backed by Supabase
Auth and Postgres. The [README diagram](../README.md#architecture) shows the runtime
flow. Local extraction is the default; no external model or payment service is connected.

| Area                                  | Responsibility                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/app`, `src/components/workspace` | HTTP boundaries and focused note/evidence/usage/billing views                              |
| `src/lib/ai`                          | Versioned prompt, frozen pricing, bounded provider call, strict schema and original quotes |
| `src/lib/billing`                     | Checkout reuse, signed webhook reconciliation and canonical entitlement state              |
| `src/lib/supabase`                    | User-JWT clients and narrowly scoped server credentials                                    |
| `src/lib/observability`               | Privacy-safe logs and generation/reserve/provider/persist spans                            |
| `supabase/migrations`                 | RLS, durable reservations, UTC quotas, settlement, deletion and billing transactions       |

## A summary request

1. Authenticate the user and read their immutable note through RLS.
2. Atomically reserve count and conservative cost exposure for a durable request ID.
3. Obtain a positively acknowledged, unexpired attempt permit with frozen configuration.
4. Call the selected provider once. The default selects sentences locally for $0.
5. Validate the strict output and exact original evidence, then persist result and usage.

Successful replay returns the saved result. Ambiguous/attempted failures retain their
maximum unknown exposure, and stale workers cannot spend or resurrect deleted text.
Postgres owns those invariants so direct API access cannot bypass them.

Billing code verifies raw signed events and reconciles canonical Stripe state under
a database customer lock. Local tests double the Stripe API and use actual database
transactions. Hosted Checkout/Portal is outside this reference's acceptance scope.

## Key decisions

- [001 · Postgres authorization and ledger boundaries](adr/001-postgres-boundaries.md)
- [002 · Attempt fencing, uncertain costs and deletion](adr/002-attempts-cost-and-deletion.md)
- [003 · Output contracts versus quality evidence](adr/003-ai-contract-and-evaluation.md)
- [004 · Minimal private telemetry](adr/004-private-telemetry.md)

The bounded workflow needs no vector store, worker queue, retrieval or model tools.
See [testing](TESTING.md) for boundary coverage and [verification](VERIFICATION.md)
for executed evidence and its limits.
