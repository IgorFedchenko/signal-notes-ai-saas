# Testing

All fixtures and identities are synthetic. The default provider is local sentence
extraction: tests require no live model, judge, Stripe account or cloud service.
Use Node.js 22–26, npm and Docker. On Studio, wrap each heavy check separately with
`~/.local/bin/studio-heavy-run -- <command>` so each test run gets its own queue
ticket; do not start a raw build, Docker startup/test workload or browser run.
Read-only Docker info/status inspection may run directly; it starts no workload and
the wrapper rejects those commands. Docker services
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

The seven actual source/SQL mutation checks in [verification](VERIFICATION.md) are
historical evidence. A documentation-only update reruns local acceptance above;
unchanged runtime source does not require repeating those optional mutations.

`scripts/check-source-boundaries.mjs` invokes 14 focused test processes for the
seven red/restore/green controls. Do not wrap that whole script as one Studio ticket.
On Studio, split each focused red/restore/green test invocation into its own queue
admission and restore source/deployed SQL exactly, or defer these optional controls.
Never hide the series inside another script to bypass the queue. The complete
mutation script is prepared for an isolated runner without this host restriction.

Whole-launch checks also use a disposable checkout and supervised queue:

```sh
# After stopping the DB used for local acceptance above:
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

Actions remain disabled after publication, and every CI/CodeQL job has a public-only guard
before runner allocation. Do not dispatch/rerun private Actions or rely on free minutes.
The prepared workflow documents the complete automation path; earlier successful
runs remain [historical evidence](VERIFICATION.md). Current acceptance runs locally.
CodeQL and native public secret scanning are outside local acceptance while private.
Live model/judge, hosted payment and cloud deployment have been removed from this
case's scope; skipped optional integrations are never counted as passed tests.

Automatic Dependabot version updates stay disabled. The configuration in
[examples](examples/dependabot.yml) is inactive and requires owner approval before activation.
