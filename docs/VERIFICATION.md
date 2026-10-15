# Verification and evidence boundaries

## Current structured-contract checkpoint

Revision `d33f77a` passed [GitHub Actions run 38819722421](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/runs/38819722421)
on 2026-10-16: lint/types, 18 unit/API checks, real local Supabase/DB tests, production
build, browser bundle-secret check and desktop/mobile browser acceptance. This proves
preservation of those existing checks for the structured-result/attempt-fence change.
It does not establish all adversarial races, the expanded final test matrix or live quality.

Revision `2f786aa` [CI run 38821579755](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/runs/38821579755)
passed the verify job (including the evaluator/scanner), but its mandatory launcher/Phoenix
job failed: real Auth/note/summarize succeeded, then export failed and four-span readback
was absent. The cause is under diagnosis; the failure remains open until the same
actual-route assertion passes at a corrected revision. The offline command
currently checks 12 canonical synthetic cases, 40 facts, 11 named negative twins,
actual local-provider kinds/evidence and persistent budget arithmetic.

## What each lane establishes

| Lane                          | Boundary                                                                       | Status                                              |
| ----------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| Unit/provider contract        | Strict output, pricing/config and mocked transport/route faults                | Checkpoint passed; expanded verification pending    |
| Local DB integration          | Actual Auth/RLS, concurrency, metering and transactional billing               | Checkpoint passed; full upgrade/race matrix pending |
| Application browser           | Actual Next/Auth/DB, desktop/mobile, disclosed local extraction                | Checkpoint passed                                   |
| Recorded evaluator            | Manual synthetic oracle, parser, clause/source-span metrics, negative controls | Local passed; final CI pending                      |
| Live LLM                      | Actual supported snapshot on frozen corpus                                     | Pending owner approval/key/budget                   |
| Live judge                    | Actual model, frozen rubric and combined spend ledger                          | Pending owner approval/key/budget                   |
| Stripe hosted test roundtrip  | Real hosted Checkout/Portal + real signed delivery                             | Pending owner test settings                         |
| Phoenix                       | Actual summarize route/DB trace ID and four spans read back                    | Failed at `2f786aa`; correction pending             |
| Whole launcher                | Clean bootstrap through HTTP/Auth/DB readiness and shutdown                    | Failed at `2f786aa`; correction pending             |
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
