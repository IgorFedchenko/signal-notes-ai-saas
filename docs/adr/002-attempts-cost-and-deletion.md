# 002 · Fence attempts and retain uncertain cost

Status: accepted · 2026-10-16

A reservation holds a count slot and maximum estimated token cost before networking.
Only a positively acknowledged, unexpired database compare-and-set grants permission
to attempt the provider. It returns the frozen model, rates, caps, and UTC period.
An expired, repeated, failed or unacknowledged permit grants no network access.

Successful results settle reported token usage. Failure before an attempt releases
exposure; an attempted/ambiguous failure retains maximum unknown exposure while
releasing its count slot. Late usage may be recorded but does not refund that
conservative exposure. No automatic retry or exactly-once external-call guarantee.
Money is integer micro-USD with conservative rounding, an estimate rather than a bill.

A DB deletion trigger purges every generation's summary/result/evidence, including
legacy rows. Non-content metering and deduplication IDs remain. Finalization locks
source first, then generation, so a worker cannot restore text after deletion.
Legacy costs stay explicitly unknown. The additive cutover removes all old mutating
RPC signatures; stop old app workers before applying it.

Consequences: a timeout can consume budget despite producing no summary. Operators
can reconcile against provider records; the app does no background polling.
