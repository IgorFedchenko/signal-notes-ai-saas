# Testing

All fixtures and identities are synthetic. The default provider is local sentence
extraction: tests require no live model, judge, Stripe account or cloud service.
Use Node.js 22–26, npm and Docker. On Studio, wrap each heavy check separately with
`~/.local/bin/studio-heavy-run -- <command>` so each test run gets its own queue
ticket; do not start a raw build, Docker operation or browser run. Docker services
must fit the wrapper's verified CPU/memory limits; otherwise defer or move the run.
Check that dedicated ports 3210, 56321, 56322, 56324 and
56006 are free before startup. Never point these scripts at hosted data.

## Local acceptance

From a clean checkout with no owner-managed environment:

```sh
npm ci --no-audit --no-fund
npm run check
node scripts/check-repository-gates.mjs
npm run local:setup
npm run test:db
npm run build
node --env-file=.env.local scripts/check-client-secrets.mjs
npx playwright install chromium
npm run test:e2e
npm run local:stop
```

`local:setup` rejects inherited app secrets and owner-managed dotenv files, writes
only its generated local configuration and seeds the dedicated Supabase project.
Browser tests start the production build themselves and refuse an existing server.
Keep `.env.production*` absent in the disposable checkout as well. Generated local
credentials are not suitable for hosted services.

| Check                               | Boundary and evidence                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                     | Format/lint/types, unit and provider contracts, 12-case/40-fact evaluator and 11 named negative controls                               |
| `npm run test:db`                   | Real Auth/JWT/RLS, Free5/Pro100, count/cost admission, attempt races, deletion, billing transactions and additive/UTC migration checks |
| `npm run test:e2e`                  | Actual Next/Auth/Postgres/local provider on desktop and mobile; no intercepted route responses                                         |
| `check-repository-gates.mjs`        | Disposable git-hook commits and client-asset/source-map secret canaries                                                                |
| `check-client-secrets.mjs`          | Actual built browser assets checked against supplied server values                                                                     |
| `npm run demo -- --smoke --phoenix` | Whole launcher, actual route/DB/span readback, collector outage/recovery and shutdown                                                  |

The [evaluation contract](../evals/README.md) describes oracle denominators,
thresholds and fixture provenance. Manual canonical answers and labeled judge scores
validate the harness; they do not establish live model quality.

## Additional regression controls

The following existing operational checks run only inside the same supervised queue
and disposable local checkout:

```sh
# After local:setup: seven actual source/SQL breaks, exact restoration, same checks green.
node --env-file=.env.local scripts/check-source-boundaries.mjs
npm run check
npm run test:db

# After stopping the DB used above: real whole-launch and lifecycle checks.
npm run demo -- --smoke --phoenix
node scripts/check-launcher-lifecycle.mjs
node scripts/check-stopped.mjs
```

The mutation script temporarily deploys SQL changes to the dedicated local database;
it must never run against owner data. Re-run full checks only after exact restoration.
The lifecycle script briefly replaces its own generated env file with a synthetic
owner-file sentinel and proves rejection/preservation. It never needs an owner's file.
`--capture` adds genuine browser recording with ffmpeg; existing GIF/PNG provenance
is recorded in [demos](../demos/README.md).

For secret scanning, use OSS Gitleaks (`gitleaks git --redact --no-banner`) and
`node scripts/check-secret-scanner.mjs` for its generated negative twin. The prepared
workflow pins the scanner archive for Linux; use a trusted host installation locally.
`npm audit --audit-level=high` checks dependency advisories without paid services.

## Automation policy

Actions are disabled while private, and every CI/CodeQL job has a public-only guard
before runner allocation. Do not dispatch/rerun private Actions or rely on free minutes.
The prepared workflow documents the complete automation path; earlier successful
runs remain [historical evidence](VERIFICATION.md). Current acceptance runs locally.
CodeQL and native public secret scanning are outside local acceptance while private.
Live model/judge, hosted payment and cloud deployment have been removed from this
case's scope; skipped optional integrations are never counted as passed tests.
