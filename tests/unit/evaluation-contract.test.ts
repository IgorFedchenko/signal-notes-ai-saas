import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import dataset from "../../evals/dataset.json";
import canonical from "../../evals/fixtures/canonical.json";
import { evaluateCase, evaluateSet } from "../../evals/evaluator";
import { evaluateJudge, judgeSchema } from "../../evals/judge";
import { runLive } from "../../evals/live";
const normal = dataset.cases.find((c) => c.id === "N01")!,
  unicode = dataset.cases.find((c) => c.id === "N04")!;
const summary = (text: string, evidence = normal.note) => ({
  kind: "summary",
  takeaways: [{ text, evidence }],
});
const judges = () => ({
  cases: dataset.cases.map((c) => ({
    id: c.id,
    factuality: 4,
    coverage: 4,
    clarity: 4,
    safety: 4,
    rationale: "Labeled synthetic fixture, not a judge call.",
  })),
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("T17 metric normalization preserves exact evidence and has explicit 10-case denominator", () => {
  const text = canonical.responses.N04.takeaways[0].text
    .normalize("NFD")
    .replaceAll("24", "２４");
  const result = evaluateCase(unicode, summary(text, unicode.note));
  expect(result).toMatchObject({
    pass: true,
    precision: 1,
    recall: 1,
    evidenceSupport: 1,
  });
  const wrongEvidence = evaluateCase(
    unicode,
    summary(text, unicode.note.normalize("NFD")),
  );
  expect(wrongEvidence.failures).toContain("schema_or_exact_evidence");
  expect(evaluateSet(canonical.responses)).toMatchObject({
    pass: true,
    factualDenominator: 10,
    macroRecall: 1,
  });
});
it("T18 evidence-only facts, unknown text and duplicate text cannot manufacture recall", () => {
  for (const text of [
    "Details are in the source.",
    normal.facts[0].clause.repeat(2),
  ]) {
    const result = evaluateCase(normal, summary(text));
    expect(result.pass).toBe(false);
    expect(result.recall).toBeLessThanOrEqual(0.25);
    expect(result.failures).toContain("recall");
  }
  const duplicated = evaluateCase(
    normal,
    summary(`${normal.facts[0].clause} ${normal.facts[0].clause}`),
  );
  expect(duplicated).toMatchObject({
    precision: 1,
    recall: 0.25,
    allClauses: 2,
    recognizedClauses: 2,
  });
  const lied = evaluateCase(
    normal,
    summary("Leo owns the launch.", normal.facts[0].clause),
  );
  expect(lied.failures).toContain("contradiction");
  expect(lied.failures).toContain("unsupported_clause");
  const wrongI = dataset.cases.find((c) => c.id === "I01")!;
  expect(
    evaluateCase(wrongI, summary("A fabricated fact.", wrongI.note)).failures,
  ).toContain("kind");
  expect(
    evaluateCase(wrongI, {
      kind: "insufficient_content",
      takeaways: [{ text: "bad", evidence: wrongI.note }],
    }).failures,
  ).toContain("schema_or_exact_evidence");
});
it("T18 one weak factual case fails despite macro 0.95; attack text in evidence alone is not obedience", () => {
  const responses = structuredClone(canonical.responses);
  responses.N01 = summary(
    normal.facts
      .slice(0, 2)
      .map((f) => f.clause)
      .join(" "),
  );
  const result = evaluateSet(responses);
  expect(result.macroRecall).toBe(0.95);
  expect(result.pass).toBe(false);
  expect(result.results.find((r) => r.id === "N01")!.failures).toContain(
    "recall",
  );
  const attack = dataset.cases.find((c) => c.id === "X01")!;
  expect(evaluateCase(attack, canonical.responses.X01)).toMatchObject({
    pass: true,
    precision: 1,
    evidenceSupport: 1,
  });
});
it.each([-1, 5, 1.5, "4", null, undefined])(
  "T20 refuses invalid judge score %s without dropping case",
  (value) => {
    const reply = judges();
    Object.assign(reply.cases[0], { clarity: value });
    expect(() => evaluateJudge(reply)).toThrow();
  },
);
it("T20 all score anchors, factual-only means and attack safety thresholds are enforced", () => {
  for (let score = 0; score <= 4; score++) {
    const normalScore = judges();
    normalScore.cases[0].factuality = score;
    expect(evaluateJudge(normalScore).pass).toBe(score >= 3);
    for (const dimension of ["coverage", "clarity"] as const) {
      const reply = judges();
      for (const c of reply.cases)
        c[dimension] = c.id.startsWith("I") ? 0 : score;
      const result = evaluateJudge(reply);
      expect(result.pass).toBe(score >= 3);
      expect(result[dimension]).toBe(score);
      expect(result.factualDenominator).toBe(10);
    }
    for (const id of ["X01", "I02"]) {
      const reply = judges();
      reply.cases.find((c) => c.id === id)!.safety = score;
      expect(evaluateJudge(reply).pass).toBe(score === 4);
    }
  }
});
it("T20 refuses extra/missing/unknown/duplicate cases and malformed/refusal/truncated judge objects", () => {
  const duplicate = judges();
  duplicate.cases[0].id = duplicate.cases[1].id;
  const unknown = judges();
  unknown.cases[0].id = "UNKNOWN";
  for (const reply of [
    { ...judges(), extra: true },
    { cases: judges().cases.slice(1) },
    duplicate,
    unknown,
    { refusal: "No" },
    "{",
    null,
    { cases: [{ ...judges().cases[0], extra: true }] },
  ])
    expect(() => evaluateJudge(reply)).toThrow();
  expect(
    judgeSchema.safeParse({
      cases: judges().cases.map((c) => ({ ...c, rationale: "x".repeat(501) })),
    }).success,
  ).toBe(false);
});
it("T19 --live plus a dummy key alone authorizes zero calls", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(runLive(["--live"])).rejects.toThrow("live_approval_pending");
  expect(fetch).not.toHaveBeenCalled();
});
it("T19 whole offline CLI is deterministic and cannot open outbound sockets", () => {
  const directory = mkdtempSync(join(tmpdir(), "signal-eval-network-"));
  try {
    const guard = join(directory, "guard.mjs");
    // Intercept socket creation before CLI imports, including future accidental use.
    const source = `import net from 'node:net'; import tls from 'node:tls'; import {syncBuiltinESMExports} from 'node:module'; const deny=()=>{throw Error('Unexpected offline outbound socket')}; net.Socket.prototype.connect=deny; tls.connect=deny; globalThis.fetch=deny; syncBuiltinESMExports();`;
    writeFileSync(guard, source);
    const results = [];
    for (let i = 0; i < 2; i++) {
      const run = spawnSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          guard,
          "--import",
          "tsx",
          "evals/run.ts",
        ],
        { encoding: "utf8" },
      );
      expect(run.status, run.stderr).toBe(0);
      results.push(
        createHash("sha256")
          .update(readFileSync("evals/results/offline.json"))
          .digest("hex"),
      );
    }
    expect(results[0]).toBe(results[1]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
