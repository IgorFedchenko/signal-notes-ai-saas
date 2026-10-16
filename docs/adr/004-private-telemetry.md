# 004 · Export minimal application spans

Status: accepted · 2026-10-16

Use a real OpenTelemetry SDK with explicit generation/reserve/provider/persist spans.
Keep the provider instance separate from global automatic HTTP instrumentation so
headers, URLs and payloads cannot enter these spans accidentally. Safe metadata
includes request/trace IDs, model/prompt versions, timings, tokens and estimated cost.
Never record note, prompt, response/evidence, email, cookies, keys or Error objects.

Export is off by default. The optional pinned Phoenix container binds only loopback
and uses ephemeral local storage. A whole-launch smoke calls the actual authenticated
summarize route, checks its DB trace ID, and reads the four matching spans back from
Phoenix. An exporter outage logs only a safe code and cannot fail the summary.

Consequences: tracing is useful for correlation and latency, not content inspection.
A standalone exporter test cannot establish application-to-Phoenix acceptance.
