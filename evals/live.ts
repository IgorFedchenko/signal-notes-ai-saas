import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve, relative } from "node:path";
import { z } from "zod";
import { providerJson } from "../src/lib/ai/transport";
import dataset from "./dataset.json";
import { traced, flushTelemetry } from "../src/lib/observability/tracing";
import {
  completionBody,
  PROMPT_HASH,
  PROMPT_VERSION,
} from "../src/lib/ai/prompt";
import { SCHEMA_VERSION, parseSummary } from "../src/lib/ai/schema";
import { type BoundConfig } from "../src/lib/ai/pricing";
import { BudgetLedger, approvalSchema } from "./budget";
import { digest, EVALUATOR_VERSION, evaluateSet } from "./evaluator";
import {
  JUDGE_PROMPT,
  JUDGE_HASH,
  JUDGE_VERSION,
  judgeJsonSchema,
  evaluateJudge,
} from "./judge";

const envelope = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z.object({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .length(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
  }),
});
async function call(body: unknown, config: BoundConfig) {
  const started = performance.now();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("live_provider_unavailable");
  const parsed = envelope.parse(await providerJson(response));
  const choice = parsed.choices[0];
  if (choice.message.refusal) throw new Error("live_provider_refused");
  if (choice.finish_reason !== "stop" || !choice.message.content)
    throw new Error("live_provider_truncated_or_invalid");
  if (
    parsed.usage.completion_tokens > config.outputCap ||
    parsed.usage.prompt_tokens > config.inputCap + 256
  )
    throw new Error("live_usage_invalid");
  return {
    value: JSON.parse(choice.message.content) as unknown,
    inputTokens: parsed.usage.prompt_tokens,
    outputTokens: parsed.usage.completion_tokens,
    latencyMs: Math.round(performance.now() - started),
  };
}
function privatePath(value: string | undefined) {
  if (!value || !isAbsolute(value))
    throw new Error("live_requires_absolute_private_paths");
  const path = resolve(value),
    rel = relative(process.cwd(), path);
  if (!rel.startsWith(".."))
    throw new Error("live_artifacts_must_be_outside_product_repository");
  return path;
}
export async function runLive(args: string[]) {
  const arg = (name: string) => args[args.indexOf(name) + 1];
  if (
    !args.includes("--approval") ||
    !args.includes("--ledger") ||
    !args.includes("--output") ||
    !args.includes("--round")
  )
    throw new Error(
      "live_approval_pending: --live and a key alone do not authorize spending",
    );
  const approvalPath = privatePath(arg("--approval")),
    ledgerPath = privatePath(arg("--ledger")),
    outputPath = privatePath(arg("--output"));
  const approval = approvalSchema.parse(
    JSON.parse(readFileSync(approvalPath, "utf8")),
  );
  if (
    approval.datasetHash !== digest(dataset) ||
    approval.evaluatorVersion !== EVALUATOR_VERSION ||
    approval.judgePromptHash !== JUDGE_HASH ||
    approval.generator.provider !== "openai" ||
    approval.judge.provider !== "openai"
  )
    throw new Error("live_frozen_contract_mismatch");
  const round = approval.rounds.find((round) => round.id === arg("--round"));
  if (!round || !round.candidate || !process.env.OPENAI_API_KEY)
    throw new Error("live_round_not_approved_or_key_missing");
  type Captures = Record<
    string,
    {
      result: unknown;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      model: string;
      captureHash: string;
      requestId: string;
      traceId: string;
      capturedAt: string;
    }
  >;
  const previous = existsSync(outputPath)
    ? JSON.parse(readFileSync(outputPath, "utf8"))
    : null;
  if (
    previous &&
    (previous.scopeId !== approval.scopeId ||
      previous.roundId !== round.id ||
      previous.datasetHash !== digest(dataset))
  ) {
    throw new Error("live_capture_scope_changed");
  }
  const captures: Captures = previous?.captures ?? {};
  mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
  const persist = (extra: Record<string, unknown> = {}) =>
    writeFileSync(
      outputPath,
      `${JSON.stringify({ provenance: "live-recorded", scopeId: approval.scopeId, roundId: round.id, datasetHash: digest(dataset), model: approval.generator.model, promptVersion: PROMPT_VERSION, promptHash: PROMPT_HASH, schemaVersion: SCHEMA_VERSION, captures, ...extra }, null, 2)}\n`,
      { mode: 0o600, flush: true },
    );
  const ledger = new BudgetLedger(ledgerPath, approval);
  try {
    for (const test of dataset.cases) {
      const id = `${round.id}/candidate/${test.id}`;
      if (ledger.has(id)) {
        if (
          !captures[test.id] ||
          captures[test.id].requestId !== id ||
          captures[test.id].captureHash !== digest(captures[test.id].result)
        )
          throw new Error("live_prior_attempt_unknown_no_automatic_retry");
        continue;
      }
      const body = completionBody(
        test.note,
        approval.generator.model,
        approval.generator.outputCap,
      );
      await traced(
        "generation",
        undefined,
        {
          operation: "eval_candidate",
          model: approval.generator.model,
          "prompt.version": PROMPT_VERSION,
        },
        async (span) => {
          ledger.reserve(id, "candidate", body, approval.generator);
          const reply = await traced(
            "provider",
            span,
            { model: approval.generator.model },
            () => call(body, approval.generator),
          );
          const result = parseSummary(reply.value, test.note);
          ledger.settle(
            id,
            reply.inputTokens,
            reply.outputTokens,
            approval.generator,
          );
          captures[test.id] = {
            result,
            inputTokens: reply.inputTokens,
            outputTokens: reply.outputTokens,
            latencyMs: reply.latencyMs,
            model: approval.generator.model,
            captureHash: digest(result),
            requestId: id,
            traceId: span.spanContext().traceId,
            capturedAt: new Date().toISOString(),
          };
          persist();
        },
      );
    }
    const deterministic = evaluateSet(
      Object.fromEntries(
        Object.entries(captures).map(([id, capture]) => [id, capture.result]),
      ),
    );
    persist({ deterministic });
    if (!deterministic.pass)
      throw new Error("live_deterministic_failure_needs_human_review");
    if (round.judge) {
      const id = `${round.id}/judge/all`;
      if (ledger.has(id))
        throw new Error(
          "live_judge_attempt_already_consumed_no_automatic_retry",
        );
      const body = {
        model: approval.judge.model,
        max_completion_tokens: approval.judge.outputCap,
        messages: [
          { role: "system", content: JUDGE_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              cases: dataset.cases.map((test) => ({
                id: test.id,
                note: test.note,
                facts: test.facts,
                candidate: captures[test.id].result,
              })),
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "judge_scores",
            strict: true,
            schema: judgeJsonSchema,
          },
        },
      };
      ledger.reserve(id, "judge", body, approval.judge);
      const reply = await call(body, approval.judge);
      const judge = evaluateJudge(reply.value);
      ledger.settle(id, reply.inputTokens, reply.outputTokens, approval.judge);
      persist({
        deterministic,
        judge: {
          ...judge,
          model: approval.judge.model,
          promptVersion: JUDGE_VERSION,
          promptHash: JUDGE_HASH,
          inputTokens: reply.inputTokens,
          outputTokens: reply.outputTokens,
          latencyMs: reply.latencyMs,
        },
        exposureMicroUsd: ledger.used(),
      });
      if (!judge.pass) throw new Error("live_judge_gate_failed");
    }
    console.log(
      JSON.stringify({
        lane: "live",
        complete: true,
        deterministic: deterministic.pass,
        exposureMicroUsd: ledger.used(),
      }),
    );
  } finally {
    ledger.close();
    await flushTelemetry();
  }
}
