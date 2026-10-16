import { setTimeout as delay } from "node:timers/promises";

// Compose --wait accepts a running image without a healthcheck. Wait for the
// pinned receiver's database-backed readiness endpoint before the first export.
export async function phoenixReadiness() {
  const started = Date.now();
  const statuses = [];
  while (Date.now() - started < 90000) {
    const response = await fetch("http://127.0.0.1:56006/readyz", {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    const status = response
      ? `http_${response.status}`
      : "transport_unavailable";
    if (statuses.at(-1) !== status && statuses.length < 20)
      statuses.push(status);
    if (response?.status === 200)
      return { ready: true, statuses, elapsedMs: Date.now() - started };
    await delay(500);
  }
  return { ready: false, statuses, elapsedMs: Date.now() - started };
}
