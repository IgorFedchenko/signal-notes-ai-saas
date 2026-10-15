# 001 · Keep authorization and ledgers in Postgres

Status: accepted · 2026-10-16

A note belongs to one Supabase Auth user. Browser operations use that user's JWT;
RLS enforces ownership even if the application sends the wrong filter. Notes are
immutable. Authenticated users can read billing and generation metadata, but cannot
write entitlements, usage, or webhook receipts.

Next.js coordinates external effects. Privileged, server-only metering functions
serialize per-user count and exposure admission. Stripe reconciliation keeps its
customer lock, canonical Stripe read, and account/event commit in one transaction.
There is no separate queue or backend for this bounded synchronous reference.

Consequences: a service credential remains sensitive, and DB/RLS integration tests
are required. A client-side ownership check cannot establish isolation.
