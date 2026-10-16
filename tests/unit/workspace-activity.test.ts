import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { UsagePanel } from "@/components/workspace/usage-panel";
import type { Generation } from "@/components/workspace/types";
const generation: Generation = {
  request_id: "synthetic",
  note_id: "retained-earlier-note",
  summary: null,
  provider: "fixture",
  status: "failed",
  period: "2026-10-01",
  input_tokens: 0,
  output_tokens: 0,
  created_at: "2026-10-01",
  expires_at: "2026-10-01",
  result: null,
  estimated_micro_usd: null,
  exposure_micro_usd: 250,
  cost_status: "unknown",
  latency_ms: null,
  trace_id: null,
  config: null,
  contract_version: "v2",
};
function render(row: Partial<Generation>) {
  return renderToStaticMarkup(
    createElement(UsagePanel, {
      generations: [{ ...generation, ...row }],
      notes: [],
      tokens: 0,
      exposureMicroUsd: 250,
      plan: "free",
      onNotes() {},
    }),
  );
}
it("distinguishes current uncertainty from legacy and settled costs", () => {
  const current = render({});
  expect(current).toContain("Attempt cost unknown");
  expect(current).not.toContain("Unknown (legacy)");
  expect(current).toContain("conservative maximum cost exposure");
  expect(
    render({ cost_status: "legacy_unknown", contract_version: "legacy-v1" }),
  ).toContain("Historical cost unknown");
  expect(
    render({ cost_status: "settled", estimated_micro_usd: 250 }),
  ).toContain("$0.000250");
});
it("uses actual deletion state independently of the loaded notes window", () => {
  expect(render({})).toContain("Earlier note");
  expect(render({})).not.toContain("Deleted note");
  expect(render({ note_id: null })).toContain("Deleted note");
});
