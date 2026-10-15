# Verification and evidence boundaries

## Current structured-contract checkpoint

Revision `d33f77a` passed [GitHub Actions run 38819722421](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/runs/38819722421)
on 2026-10-16: lint/types, 18 unit/API checks, real local Supabase/DB tests, production
build, browser bundle-secret check and desktop/mobile browser acceptance. This proves
preservation of those existing checks for the structured-result/attempt-fence change.
It does not establish all adversarial races, the expanded final test matrix or live quality.

Revision `0b3dc26` passed [GitHub Actions run 38824102295](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/runs/38824102295)
on 2026-10-16. Both `verify` and `launcher-and-phoenix` passed: format/lint/types,
32 focused unit/API/render/launcher checks, real local DB integration, production
build, bundle-secret check, desktop/mobile browser acceptance, dependency audit,
OSS secret scanning, and the offline evaluator. The evaluator checks 12 canonical
synthetic cases, 40 facts, 11 named negative twins, actual local-provider kinds/evidence
and persistent budget arithmetic.

The whole launcher started from a clean checkout, performed real Auth/note/summarize
requests, checked persisted output, replay and deletion, and read the actual application
trace back from pinned Phoenix 20.22.0. Response, DB and Phoenix trace IDs matched;
all four generation/reserve/provider/persist spans had the expected parents/statuses
and passed source/auth redaction checks. Shutdown released all dedicated app, DB and
Phoenix ports. Sanitized evidence is in the run's `launcher-phoenix-evidence` artifact.

The earlier mandatory Phoenix check failed at `2f786aa` and again at `49e3be7`:
exports reset before the receiver was ready, then readback returned HTTP 404. The
corrected launcher waits for the receiver's database-backed `/readyz` endpoint before
starting Next. The successful run recorded transport unavailable → HTTP 200 after
20.2 seconds, then passed the unchanged actual-route four-span check. Compose's running
container state alone did not establish HTTP readiness; no protocol or assertion changed.

These are executed checkpoint results. The full adversarial upgrade/race/error-path
matrix, updated media and independent final verification remain required. No live
model quality, hosted payment or hosted deployment acceptance is inferred.

## What each lane establishes

| Lane                          | Boundary                                                                       | Status                                              |
| ----------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| Unit/provider contract        | Strict output, pricing/config and mocked transport/route faults                | Checkpoint passed; expanded verification pending    |
| Local DB integration          | Actual Auth/RLS, concurrency, metering and transactional billing               | Checkpoint passed; full upgrade/race matrix pending |
| Application browser           | Actual Next/Auth/DB, desktop/mobile, disclosed local extraction                | Checkpoint passed                                   |
| Recorded evaluator            | Manual synthetic oracle, parser, clause/source-span metrics, negative controls | Passed in checkpoint CI                             |
| Live LLM                      | Actual supported snapshot on frozen corpus                                     | Pending owner approval/key/budget                   |
| Live judge                    | Actual model, frozen rubric and combined spend ledger                          | Pending owner approval/key/budget                   |
| Stripe hosted test roundtrip  | Real hosted Checkout/Portal + real signed delivery                             | Pending owner test settings                         |
| Phoenix                       | Actual summarize route/DB trace ID and four spans read back                    | Passed at `0b3dc26`                                 |
| Whole launcher                | Clean bootstrap through HTTP/Auth/DB readiness and shutdown                    | Passed at `0b3dc26`                                 |
| GIF                           | Real synthetic browser recording, no DOM substitution                          | Capture command ready; capture pending              |
| Hosted demo                   | Real deployed URL, Auth confirmation/SMTP, TLS/pooler                          | Pending owner access/consent                        |
| Public CodeQL/native scanning | Eligible public execution                                                      | Pending publication approval; skipped while private |

No live model/judge, Stripe-hosted payment, paid service or hosted deployment was
used to create this checkpoint. Manual oracle responses are not recorded live output.
A mock collector is not Phoenix acceptance. Screenshots currently show the earlier
real local app flow and will be replaced by genuine updated capture.

## Reproduce

See README commands, `evals/README.md`, `demos/README.md` and CI artifacts. Report the
actual revision, environment and lane when publishing results. A missing prerequisite
stays pending; a failed terminal check stays failed until fixed. Security scanning
and an exact evidence check do not establish general semantic correctness or immunity
to prompt injection.
