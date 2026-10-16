# Verification and evidence boundaries

All checks use synthetic data. The default app runs local sentence extraction;
manual oracle outputs and provider doubles establish contracts, not live LLM quality.
See [current Actions](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/workflows/ci.yml)
for the exact revision and required job status.

The complete checkpoint at [`34c694d`](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/runs/38826691940)
passed both required jobs, including real desktop/mobile app acceptance, whole clean
bootstrap, actual Phoenix readback, collector outage/recovery and launcher lifecycle.
The expanded contract/migration checks at [`602b4d0`](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/runs/38827575492)
passed 131 light tests, 36 real database checks, production build and genuine media
capture. Its browser job stopped before execution because Node required an explicit
JSON import attribute; the corrected discovery lists all eight tests. That failed
job is not browser acceptance. Final independent verification remains a separate gate.

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
| Repository gates          | Format/lint/types, dependency audit, OSS Gitleaks with negative twin, actual bad/corrected git-hook commits and client bundle/source-map canaries                                        | CodeQL analysis skipped while private; native public scanning pending                                               |
| Media                     | Genuine 16-second GIF, current workspace/mobile, exact hashes/revisions                                                                                                                  | Synthetic identity, local extraction, unavailable billing; see [provenance](../demos/README.md)                     |

The actual collector outage completed the summary with HTTP200 and saved DB output
in about one second, then a subsequent trace returned all four spans after recovery.
App/exporter stdout and returned spans passed source/auth canary checks. Earlier
receiver startup failures were corrected by waiting for its database-backed `/readyz`
endpoint; a running container alone did not establish receiver readiness.

Live candidate evaluation and LLM-as-judge require explicit owner approval, a supported
dated snapshot, provisioned key and one combined persistent spending cap. Actual
Stripe-hosted test payment, hosted Auth/deployment and public visibility/scanning also
remain pending owner prerequisites. No fixture, skipped job, redirect or local Docker
result passes those gates. The result is a local reference, not full AI/hosted SaaS
acceptance or a promise of semantic correctness or universal injection protection.

Reproduce with README commands and inspect the run artifacts: evaluator results,
DB ledgers/migration receipts, browser traces/screenshots, hook controls, real Phoenix
readback/outage/lifecycle and original recording. Browser files live under
`test-results/browser` so earlier database receipts survive browser startup.
