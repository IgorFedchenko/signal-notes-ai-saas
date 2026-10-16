# Signal Notes

Canonical instructions for agents working in this repository. MIT reference app;
synthetic data only. `AGENTS.md` points here so both agents share these rules.

## Start here

Fetch the latest remote refs before analysis; record the reviewed SHA. Read
[README.md](README.md), [architecture](docs/ARCHITECTURE.md),
[testing](docs/TESTING.md) and the relevant ADR before changing a boundary.
Keep edits focused and preserve the existing commit history and agent attribution.
Do not rewrite dates or history. New commit subjects include `[skip ci]`.

## Structure

- `src/app`: Next.js pages, Auth and HTTP route handlers.
- `src/components/workspace`: note, evidence, usage and billing views.
- `src/lib/ai`: provider contract, schema/evidence validation, prompt and pricing.
- `src/lib/billing`, `src/lib/supabase`: server billing and database access.
- `src/lib/observability`: allowlisted JSON logs and explicit OpenTelemetry spans.
- `supabase/migrations`: authorization, reservations, settlement and deletion invariants.
- `tests/unit`, `tests/db`, `tests/e2e`: contract, real database and browser checks.
- `evals`: frozen synthetic corpus, manual fixtures, evaluator and offline judge contract.
- `scripts`: guarded local setup, launcher, smoke and negative controls.
- `docs`, `demos`: technical documentation, ADRs and genuine synthetic demo media.

## Run and verify

Use Node.js 22–26, npm and Docker. `npm run demo` installs locked dependencies,
starts isolated Supabase, applies migrations and runs the app at `127.0.0.1:3210`.
Ctrl+C stops its owned resources. Do not overwrite or inspect owner-managed env files.
The launcher rejects inherited application settings and owner-managed dotenv files.

```sh
npm run check                 # format, lint, types, unit and offline evaluation
npm run hooks:install         # staged format and fast checks
npm run local:setup           # dedicated local Auth/Postgres and synthetic seed
npm run test:db               # real RLS, quotas, concurrency and billing transactions
npm run build
node --env-file=.env.local scripts/check-client-secrets.mjs
npx playwright install chromium
npm run test:e2e              # built app + real Auth/DB, desktop and mobile
npm run demo -- --smoke --phoenix
npm run local:stop
```

On Studio, every build, Docker operation, browser E2E and heavy suite must run through
`~/.local/bin/studio-heavy-run -- <command>`; never bypass the shared queue or interrupt
another job. Database tests must use only the dedicated loopback stack at API 56321 /
Postgres 56322. Check dedicated ports before startup; stop only resources this run owns.
Detailed setup and meaningful negative controls are in [TESTING.md](docs/TESTING.md).

## Safety and evidence

Keep `AI_PROVIDER=fixture`: local extraction makes no LLM calls. Live model/judge,
Stripe-hosted payment and cloud deployment are outside the current case scope.
Do not request or provision external credentials, create connections or make paid calls.
Never print/commit secrets; local generated fixtures must be labeled synthetic/local.
Keep credentials in ignored server settings and modules importing `server-only`.

User data uses the user's JWT and RLS; elevated access is restricted to billing
reconciliation and metering RPCs. Preserve additive migration history and exercise
real DB tests for SQL invariants. Validate exact original evidence; note text and
provider output are untrusted. Keep note/prompt/response/auth values out of telemetry.
Manual responses, API doubles and offline judge scores establish contracts only.
Do not describe them as live model quality or completed hosted payment.

## Repository and delivery

Keep this repository private until the common review across portfolio projects.
GitHub Actions are disabled while private; every CI/CodeQL job must also have a
job-level public-only guard, including eligibility jobs. Do not dispatch, rerun or
spend private Actions minutes. Use supervised local verification and `[skip ci]` commits.
Keep the prepared workflows and honest historical run links.

Store portfolio sales copy, process plans, model ledgers and reviewer/run reports
outside the product repository. Technical verification and media provenance belong
in `docs/` and `demos/`; instruction files and existing agent attribution stay visible.
No public visibility change, deployment, push or merge is implied by documentation work.
