# Verification and evidence boundaries

All checks use synthetic data. The default app runs local sentence extraction;
manual oracle outputs and provider doubles establish contracts, not live LLM quality.
Actions are disabled while private; all prepared CI/CodeQL jobs are also public-only
before runner allocation. Use the [local acceptance commands](TESTING.md) for current
verification. Links below preserve genuine historical runs, not a current CI promise.

Local/offline verification passed at
[`9195e721`](https://github.com/IgorFedchenko/signal-notes-ai-saas/tree/9195e7219e5cd8fe4b66d6eaf9340e969b416f47)
on 2026-10-16. Both required jobs passed in
[run 38830344251](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/runs/38830344251):
**132 light tests, 36 real database tests, eight desktop/mobile browser tests**, and
the **12-case / 40-fact evaluator with 11 named negative controls**. The full checks
ran after all seven deliberate source mutations were detected and restored. The
separate clean-launch/Phoenix job also passed. The same full workflow subsequently
passed on main at
[`c9c50f2`](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/runs/38832349784).
These results cover the local reference. Live model/judge, Stripe-hosted payment and
cloud deployment are **removed from this case's scope**, not pending acceptance gates
and not passed by mocks. Visibility stays private until the common portfolio review.

| Lane                      | Executed boundary                                                                                                                                                                        | Limit                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Output/provider contracts | Strict schema/cardinality, original Unicode quotes, reported usage, serialized caps, one-call and refusal/truncation/error handling                                                      | Transport doubles and one actual 25-second hanging loopback endpoint; no model network                              |
| Real database             | Actual Supabase JWT/RLS, Free5/Pro100, positive exposure/settlement, committed begin with lost acknowledgement, timeout/expiry, direct owner deletion and late finalization              | Controlled synthetic rows and SQL interleavings, no hosted data                                                     |
| Migration/UTC             | Empty and baseline-seeded additive upgrades, byte-identical original migration, actual old service-role RPC denial; old/new UTC ledgers                                                  | Minimal Auth scaffold and clock substitution only in disposable migration databases; genuine Auth tested separately |
| App browser               | Signup/login/logout, two users, persistence/replay, exact evidence/metrics, insufficient outcomes, literal HTML, sixth-request denial, deletion and responsive controls                  | Real Next/Auth/Postgres/local provider; desktop and iPhone viewport; no intercepted responses                       |
| Evaluator                 | 12 manual canonical cases/40 facts, 11 named negative twins, source-span evidence support, numeric denominators and actual local-provider kind/evidence checks                           | Narrow frozen lexical oracle; manual output is not recorded live output                                             |
| Judge/spending contract   | Strict 0–4 rubric/complete case parser, factual-only means, durable shared spending arithmetic, process lock and crash/restart                                                           | Labeled offline scores; no actual judge verdict or external spend                                                   |
| Billing                   | Raw Stripe SDK signatures and signed handler, duplicates/out-of-order/rollback, real DB customer locks and concurrent checkout reuse                                                     | Stripe API doubled; no hosted Checkout/Portal payment                                                               |
| Phoenix/privacy           | Actual route=response/DB/Phoenix trace ID; root plus reserve/provider/persist children with parents/statuses; stopped collector still permits saved summary, recovery exports next trace | Pinned local Phoenix20.22.0; synthetic logs/SDK/span canaries; no tracing cloud                                     |
| Launcher                  | Whole command from clean checkout, startup/ready SIGINT, documented restart, ports/owned resources and owner-file preservation                                                           | Dedicated ephemeral local stack; setup-error subprocess boundary additionally doubled                               |
| Repository gates          | Format/lint/types, dependency audit, OSS Gitleaks with negative twin, actual bad/corrected git-hook commits and client bundle/source-map canaries                                        | CodeQL/native public scanning are outside local acceptance while private                                            |
| Media                     | Genuine 16-second GIF, current workspace/mobile, exact hashes/revisions                                                                                                                  | Synthetic identity, local extraction, unavailable billing; see [provenance](../demos/README.md)                     |

## Mutation checks

Seven deliberate changes to actual source were exercised at `9195e721`. Four changed
SQL functions were deployed to the dedicated test database before the focused check.
Each change produced its intended assertion failure (**exit 1**), followed by exact
source restoration and the **same command passing, exit 0**. All four deployed SQL
function definitions also matched their original hashes after restoration.

| Boundary                 | Deliberate break                                                 | Observed failure                                                 |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Original evidence        | Removed exact-source quote rejection                             | Six non-original quotes no longer threw the required error       |
| Attempt fence            | Removed the SQL not-attempted predicate                          | Four positive acknowledgements instead of one                    |
| Unknown cost exposure    | Released exposure after an attempted failure                     | Ledger exposure was 17 instead of 100000 micro-USD               |
| Deletion privacy         | Removed SQL summary/result clearing, preserving the deleted flag | Legacy summary text remained after direct owner-JWT deletion     |
| Free quota               | Raised the SQL maximum from five to six                          | Six concurrent requests were admitted instead of five            |
| Telemetry privacy        | Recorded a poisoned Error through the real SDK                   | A synthetic canary appeared in captured SDK spans                |
| Evaluator contradictions | Treated unknown/contradictory clauses as supported               | A changed-owner response lost its required contradiction failure |

The [acceptance artifact](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/runs/38830344251/artifacts/12016508901)
contains the seven diffs, red/green logs and hash receipts under
`test-results/source-boundaries`. After restoration, the same job passed the complete
format/lint/type/unit/evaluator/database/build/bundle/browser suite. No test expectation,
corpus or threshold was weakened, and no mutant remains in the committed source.
These focused checks demonstrate detection of these seven broken boundaries; they do
not establish general semantic correctness or universal injection protection.

The actual collector outage completed the summary with HTTP200 and saved DB output
in about one second, then a subsequent trace returned all four spans after recovery.
App/exporter stdout and returned spans passed source/auth canary checks. Earlier
receiver startup failures were corrected by waiting for its database-backed `/readyz`
endpoint; a running container alone did not establish receiver readiness.

The committed GIF, workspace and mobile images retain their actual `602b4d0` capture
provenance; the landing image comes from `34c694d`. Exact media hashes and source runs
remain in
[media.json](../demos/media.json).

The optional model/judge and Stripe adapters remain unconnected. Their offline
contracts are tested, but no actual model verdict or Stripe-hosted payment is claimed.
Cloud deployment is also outside scope. No credentials or external connections are
needed to accept this local reference. It makes no promise of general semantic
correctness or universal injection protection.

Reproduce with README commands and inspect the run artifacts: evaluator results,
DB ledgers/migration receipts, browser traces/screenshots, hook controls, real Phoenix
readback/outage/lifecycle and original recording. Browser files live under
`test-results/browser` so earlier database receipts survive browser startup.
