import { describe, expect, it } from "vitest";
import { effectivePlan, periodStart } from "@/lib/plans";
describe("entitlements", () => {
  const now = new Date("2026-10-16T10:00:00Z");
  it("requires an active, unexpired Pro subscription", () => {
    expect(
      effectivePlan(
        { plan: "pro", status: "active", period_end: "2026-11-01" },
        now,
      ),
    ).toBe("pro");
    for (const status of [
      "past_due",
      "canceled",
      "unpaid",
      "incomplete",
      "paused",
    ]) {
      expect(
        effectivePlan({ plan: "pro", status, period_end: "2026-11-01" }, now),
      ).toBe("free");
    }
    expect(
      effectivePlan(
        { plan: "pro", status: "active", period_end: "2026-10-15" },
        now,
      ),
    ).toBe("free");
    expect(effectivePlan(null, now)).toBe("free");
  });
  it("uses UTC calendar months at a local timezone boundary", () => {
    expect(periodStart(new Date("2026-11-01T00:30:00+04:00"))).toBe(
      "2026-10-01",
    );
  });
});
