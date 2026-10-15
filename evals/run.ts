import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudgetLedger, type Approval } from "./budget";
import { MODEL_PRICES, boundConfigSchema } from "../src/lib/ai/pricing";
import { writeFileSync, mkdirSync } from "node:fs";
import dataset from "./dataset.json";
import canonical from "./fixtures/canonical.json";
import { fixtureSummary } from "../src/lib/ai/provider";
import { PROMPT_HASH, PROMPT_VERSION } from "../src/lib/ai/prompt";
import { SCHEMA_VERSION } from "../src/lib/ai/schema";
import {
  clauses,
  digest,
  evaluateCase,
  evaluateSet,
  EVALUATOR_VERSION,
} from "./evaluator";
import { evaluateJudge, JUDGE_HASH, JUDGE_VERSION } from "./judge";
import { runLive } from "./live";

export function offline() {
  assert.equal(canonical.provenance, "synthetic/manual");
  assert.equal(canonical.datasetVersion, dataset.version);
  for (const test of dataset.cases) {
    assert.equal(
      createHash("sha256").update(test.note).digest("hex"),
      test.sha256,
    );
    for (const fact of test.facts)
      assert.equal(
        test.note.slice(fact.sourceSpan.start, fact.sourceSpan.end),
        fact.sourceSpan.text,
      );
  }
  const positive = evaluateSet(canonical.responses);
  assert.equal(positive.pass, true, "canonical quality gates");
  assert.equal(positive.macroRecall, 1);
  assert.equal(positive.factualDenominator, 10);
  const local = dataset.cases.map((test) => {
    const output = fixtureSummary(test.note);
    assert.equal(output.result.kind, test.expectedKind, test.id);
    return {
      id: test.id,
      kind: output.result.kind,
      exactEvidence: output.result.takeaways.every((item) =>
        test.note.includes(item.evidence),
      ),
    };
  });
  assert.ok(local.every((row) => row.exactEvidence));
  const n01 = dataset.cases.find((test) => test.id === "N01")!,
    n03 = dataset.cases.find((test) => test.id === "N03")!,
    x01 = dataset.cases.find((test) => test.id === "X01")!;
  const base = canonical.responses.N01;
  const mutate = (text: string, evidence = n01.note) => ({
    kind: "summary",
    takeaways: [{ text, evidence }],
  });
  const controls: {
    id: string;
    expected: string;
    metrics: ReturnType<typeof evaluateCase>;
  }[] = [];
  const check = (
    id: string,
    test: typeof n01,
    output: unknown,
    expected: string,
  ) => {
    const metrics = evaluateCase(test, output);
    assert.equal(metrics.pass, false, id);
    assert.ok(metrics.failures.includes(expected), `${id}: ${expected}`);
    controls.push({ id, expected, metrics });
    return metrics;
  };
  const allFacts = base.takeaways[0].text;
  check(
    "invented-extra",
    n01,
    mutate(`${allFacts} The budget is unlimited.`),
    "precision",
  );
  for (const [id, from, to] of [
    ["changed-date", "2026-11-02", "2026-11-03"],
    ["changed-owner", "Mira", "Leo"],
    ["changed-number", "120 USD", "121 USD"],
  ])
    check(id, n01, mutate(allFacts.replace(from, to)), "contradiction");
  const negation = canonical.responses.N03.takeaways[0];
  check(
    "changed-negation",
    n03,
    {
      kind: "summary",
      takeaways: [
        {
          ...negation,
          text: negation.text.replace("did not approve", "approved"),
        },
      ],
    },
    "contradiction",
  );
  const unrelated = check(
    "unrelated-genuine-evidence",
    n01,
    mutate(allFacts, n01.facts[0].clause),
    "evidence_support",
  );
  assert.equal(unrelated.precision, 1);
  assert.equal(unrelated.recall, 1);
  assert.equal(unrelated.evidenceSupport, 0.25);
  const half = check(
    "precision-denominator",
    n01,
    mutate(`${n01.facts[0].clause} The moon is blue.`),
    "precision",
  );
  assert.equal(half.precision, 0.5);
  const omitted = check(
    "two-of-four",
    n01,
    mutate(
      n01.facts
        .slice(0, 2)
        .map((f) => f.clause)
        .join(" "),
    ),
    "recall",
  );
  assert.equal(omitted.recall, 0.5);
  check(
    "attack-obedience",
    x01,
    {
      kind: "summary",
      takeaways: [{ text: "ATTACK_ACK_X01", evidence: x01.note }],
    },
    "safety",
  );
  check(
    "wrong-kind",
    n01,
    { kind: "insufficient_content", takeaways: [] },
    "kind",
  );
  check(
    "invented-evidence",
    n01,
    mutate(allFacts, "Fabricated quote"),
    "schema_or_exact_evidence",
  );
  const lowRecall = structuredClone(canonical.responses) as Record<
    string,
    unknown
  >;
  for (const test of dataset.cases.filter((test) => test.facts.length))
    lowRecall[test.id] = {
      kind: "summary",
      takeaways: [
        {
          text: test.facts
            .slice(0, 3)
            .map((f) => f.clause)
            .join(" "),
          evidence: test.note,
        },
      ],
    };
  const macro = evaluateSet(lowRecall);
  assert.equal(macro.macroRecall, 0.75);
  assert.equal(
    macro.results.every((row) => row.pass),
    true,
  );
  assert.equal(macro.pass, false);
  assert.deepEqual(
    clauses("Budget is 1.5 USD. Visit https://example.invalid/path."),
    ["budget is 1.5 usd", "visit https://example.invalid/path"],
  );
  const judge = {
    cases: dataset.cases.map((test) => ({
      id: test.id,
      factuality: 4,
      coverage: 4,
      clarity: 4,
      safety: 4,
      rationale: "Synthetic labeled oracle.",
    })),
  };
  assert.equal(evaluateJudge(judge).pass, true);
  const badJudge = structuredClone(judge);
  badJudge.cases[0].factuality = 2;
  assert.equal(evaluateJudge(badJudge).pass, false);
  const unsafeJudge = structuredClone(judge);
  unsafeJudge.cases.find((test) => test.id === "X01")!.safety = 3;
  assert.equal(evaluateJudge(unsafeJudge).pass, false);
  assert.throws(() => evaluateJudge({ cases: judge.cases.slice(1) }));
  // Exercise the exact persistent spend pipeline with synthetic usage; no network.
  const temporary = mkdtempSync(join(tmpdir(), "signal-eval-budget-"));
  try {
    const model = "gpt-5.4-mini-2026-03-17";
    const config = boundConfigSchema.parse({
      ...MODEL_PRICES[model],
      model,
      inputCap: 65536,
      outputCap: 800,
      promptVersion: PROMPT_VERSION,
      promptHash: PROMPT_HASH,
      schemaVersion: SCHEMA_VERSION,
    });
    const path = join(temporary, "ledger.json");
    const approval: Approval = {
      status: "approved",
      owner: "Igor",
      scopeId: "synthetic-harness-only",
      ledgerPath: path,
      approvedMicroUsd: 10000,
      datasetHash: digest(dataset),
      evaluatorVersion: EVALUATOR_VERSION,
      judgePromptHash: JUDGE_HASH,
      generator: config,
      judge: config,
      rounds: [{ id: "synthetic", candidate: true, judge: true }],
    };
    const ledger = new BudgetLedger(path, approval);
    assert.throws(() => new BudgetLedger(path, approval), /locked/);
    ledger.reserve("candidate", "candidate", { input: "synthetic" }, config);
    const held = ledger.used();
    assert.ok(held > 0);
    ledger.settle("candidate", 100, 10, config);
    assert.equal(ledger.used(), 120);
    ledger.reserve("judge", "judge", { input: "synthetic" }, config);
    const afterUnknown = ledger.used();
    ledger.close();
    const resumed = new BudgetLedger(path, approval);
    assert.equal(resumed.used(), afterUnknown);
    assert.throws(
      () => resumed.reserve("judge", "judge", {}, config),
      /already_consumed/,
    );
    assert.throws(
      () =>
        resumed.reserve(
          "too-large",
          "candidate",
          { input: "x".repeat(20000) },
          config,
        ),
      /exhausted/,
    );
    resumed.close();
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  const report = {
    lane: "offline-contract-and-evaluator-regression",
    provenance: canonical.provenance,
    datasetVersion: dataset.version,
    datasetHash: digest(dataset),
    responseHash: digest(canonical),
    evaluatorVersion: EVALUATOR_VERSION,
    model: "manual-oracle / extractive-local-v2",
    promptVersion: PROMPT_VERSION,
    promptHash: PROMPT_HASH,
    schemaVersion: SCHEMA_VERSION,
    judgeVersion: JUDGE_VERSION,
    judgeHash: JUDGE_HASH,
    positive,
    localContractOnly: local,
    controls,
    liveModel: "pending-owner-approval",
    liveJudge: "pending-owner-approval",
  };
  mkdirSync("evals/results", { recursive: true });
  writeFileSync(
    "evals/results/offline.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      lane: report.lane,
      cases: 12,
      facts: 40,
      macroRecall: positive.macroRecall,
      negativeControls: controls.length,
      pass: true,
      liveModel: report.liveModel,
    }),
  );
}
try {
  if (process.argv.includes("--live")) await runLive(process.argv.slice(2));
  else offline();
} catch {
  // Provider replies/keys/errors are not printed; private captures carry synthetic results.
  console.error(
    JSON.stringify({
      lane: process.argv.includes("--live") ? "live" : "offline",
      pass: false,
      code: "eval_failed_or_approval_pending",
    }),
  );
  process.exitCode = 1;
}
