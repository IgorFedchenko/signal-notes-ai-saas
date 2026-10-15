# Verification record

Application revision: `223cfc1723576d28a4166ea88410ee0f93c6c74f`.
Full acceptance: [GitHub Actions run 38816000124](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/runs/38816000124), successful on 2026-10-15 UTC / 2026-10-16 Asia/Yerevan.

| Check                           | Evidence                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------- |
| ESLint + TypeScript             | Passed locally and on Ubuntu / Node 24                                        |
| Unit/API boundary tests         | 14 passed                                                                     |
| Real Supabase integration tests | 12 passed; separate Auth users and real Postgres                              |
| Playwright                      | 6 passed, desktop and mobile Chromium, against the production build           |
| Next.js production build        | Passed                                                                        |
| Browser secret check            | Configured server credentials absent from `.next/static`                      |
| Dependency audit                | 0 vulnerabilities, including development dependencies                         |
| Synthetic screenshots           | Captured from this successful browser run; committed under `docs/screenshots` |

The original DB test configuration also included the unit suite, reporting 26
passes (12 integration + 14 unit). Its include configuration now runs only the
12 integration tests; the unit suite remains a separate CI step.

## Observed acceptance

- Signup creates a real Auth identity and billing account. Login/logout work with
  Supabase cookies; an anonymous request is rejected.
- Saving a note creates a real Postgres row. A summary is persisted independently
  of React state and survives a page reload.
- Free users receive five summaries and then a disabled action with a limit state.
  Concurrent database requests also stop exactly at five active reservations.
- Two users cannot read/delete each other's notes, forge an owner, transfer a row,
  write a billing plan, inspect webhook receipts or invoke privileged metering RPCs.
- Provider failure releases quota. Expired requests cannot be finalized by a late
  worker. A repeated successful request returns the stored summary.
- Stripe SDK accepts a valid signature and rejects changed bodies and expired
  timestamps. Live keys are rejected before network access.
- Six concurrent deliveries of one billing event produce one canonical Stripe read
  and one database revision. Delayed events read current state, and upstream failure
  rolls back the receipt so a retry can commit.
- Concurrent checkout requests reuse an open hosted-session test double; canceled
  subscriptions can start a new session. Unrelated customers cannot gain access.
- The browser exercises signup, create, summarize, persisted history, usage, plan
  disclosure, quota exhaustion, delete, logout and password login. Landing/pricing
  and the main workspace fit desktop and mobile widths.

## External acceptance still pending

- Actual Stripe-hosted test Checkout and customer portal roundtrip: owner test
  credentials are not configured. Database tests use mocked Stripe reads and
  synthetic signed events; they do not establish an actual hosted payment.
- Live LLM response: no API key or paid call was used. The real provider adapter is
  tested with recorded response shapes; the default UI uses disclosed local extraction.
- Hosted Vercel/Supabase URL: no owner-provided access has been confirmed. No hosted
  deployment, paid resource or externally accessible demo has been created.
- Publication: the GitHub repository remains private until Igor explicitly approves
  making it public after reviewing the result.

The initial browser run failed on an exact text selector for a label containing
nested explanatory text. The selector was changed to inspect its banner container;
the full flow then passed on both viewports. No acceptance assertions were removed.

Heavy execution ran on GitHub's standard Ubuntu runner. Studio's shared queue
remained occupied; this task's waiting local setup was canceled before execution.
No existing Studio job was interrupted and no queue was bypassed.
