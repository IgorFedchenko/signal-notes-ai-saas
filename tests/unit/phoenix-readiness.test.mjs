import { afterEach, expect, it, vi } from "vitest";
import { phoenixReadiness } from "../../scripts/phoenix-readiness.mjs";
vi.mock("node:timers/promises", () => ({
  setTimeout: () => new Promise((resolve) => setTimeout(resolve, 500)),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("waits through receiver startup and database unavailability before allowing app launch", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("synthetic startup reset"))
    .mockResolvedValueOnce({ status: 503 })
    .mockResolvedValue({ status: 200 });
  vi.stubGlobal("fetch", fetch);
  const pending = phoenixReadiness();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(pending).resolves.toEqual({
    ready: true,
    statuses: ["transport_unavailable", "http_503", "http_200"],
    elapsedMs: 1000,
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch).toHaveBeenLastCalledWith(
    "http://127.0.0.1:56006/readyz",
    expect.any(Object),
  );
});
it("fails closed after the bounded readiness deadline without exposing response/error bodies", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("synthetic private body")),
  );
  const pending = phoenixReadiness();
  await vi.advanceTimersByTimeAsync(90000);
  await expect(pending).resolves.toEqual({
    ready: false,
    statuses: ["transport_unavailable"],
    elapsedMs: 90000,
  });
});
