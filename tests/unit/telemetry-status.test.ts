import { expect, it } from "vitest";
import { exportFailureStatus } from "@/lib/observability/export-status";
it("exposes only bounded transport classifications, never arbitrary SDK error fields", () => {
  expect(
    exportFailureStatus({
      code: 415,
      data: "Synthetic private body",
      message: "Synthetic private URL",
    }),
  ).toBe("http_415");
  expect(exportFailureStatus({ code: "ECONNREFUSED" })).toBe("ECONNREFUSED");
  expect(exportFailureStatus(new TypeError("Synthetic private body"))).toBe(
    "type_error",
  );
  expect(
    exportFailureStatus({
      code: "Synthetic private code",
      name: "Synthetic private name",
      cause: "Synthetic private cause",
    }),
  ).toBe("unknown");
});
