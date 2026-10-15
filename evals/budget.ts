import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  existsSync,
} from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { hostname } from "node:os";
import { z } from "zod";
import {
  boundConfigSchema,
  estimatedCost,
  type BoundConfig,
} from "../src/lib/ai/pricing";
import { digest } from "./evaluator";

export const approvalSchema = z
  .object({
    status: z.literal("approved"),
    owner: z.literal("Igor"),
    scopeId: z.string().min(1).max(100),
    ledgerPath: z.string().refine(isAbsolute),
    approvedMicroUsd: z.number().int().min(1).max(1_000_000),
    datasetHash: z.string().length(64),
    evaluatorVersion: z.string(),
    judgePromptHash: z.string().length(64),
    generator: boundConfigSchema,
    judge: boundConfigSchema,
    rounds: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,40}$/),
            candidate: z.boolean(),
            judge: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();
export type Approval = z.infer<typeof approvalSchema>;
const microUsd = z.number().int().nonnegative().max(1_000_000);
const attemptSchema = z
  .object({
    id: z.string(),
    role: z.enum(["candidate", "judge"]),
    model: z.string(),
    reservedMicroUsd: microUsd,
    exposureMicroUsd: microUsd,
    status: z.enum(["unknown", "settled"]),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    estimatedMicroUsd: microUsd.optional(),
  })
  .strict();
const ledgerSchema = z
  .object({
    version: z.literal(1),
    scopeId: z.string(),
    approvalHash: z.string(),
    approvedMicroUsd: microUsd,
    attempts: z.array(attemptSchema),
  })
  .strict();
type Ledger = z.infer<typeof ledgerSchema>;
export class BudgetLedger {
  private state: Ledger;
  private lockPath: string;
  private approvedConfigs: { candidate: BoundConfig; judge: BoundConfig };
  constructor(
    private path: string,
    approval: Approval,
  ) {
    this.approvedConfigs = structuredClone({
      candidate: approval.generator,
      judge: approval.judge,
    });
    this.path = resolve(path);
    if (this.path !== resolve(approval.ledgerPath))
      throw new Error("budget_ledger_path_not_approved");
    this.lockPath = `${this.path}.lock`;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    // One lock spans candidate and judge execution, including crashes/restarts.
    try {
      mkdirSync(this.lockPath, { mode: 0o700 });
    } catch {
      throw new Error(
        "budget_ledger_locked: inspect the owning process before recovering a crashed lock",
      );
    }
    try {
      writeFileSync(
        `${this.lockPath}/owner.json`,
        JSON.stringify({ pid: process.pid, host: hostname() }),
        { mode: 0o600 },
      );
      const approvalHash = digest(approval);
      this.state = existsSync(this.path)
        ? ledgerSchema.parse(JSON.parse(readFileSync(this.path, "utf8")))
        : {
            version: 1,
            scopeId: approval.scopeId,
            approvalHash,
            approvedMicroUsd: approval.approvedMicroUsd,
            attempts: [],
          };
      if (
        this.state.scopeId !== approval.scopeId ||
        this.state.approvalHash !== approvalHash ||
        this.state.approvedMicroUsd !== approval.approvedMicroUsd
      )
        throw new Error("budget_ledger_scope_changed");
      if (
        new Set(this.state.attempts.map((row) => row.id)).size !==
          this.state.attempts.length ||
        this.used() > approval.approvedMicroUsd
      )
        throw new Error("budget_ledger_invalid");
      for (const row of this.state.attempts) {
        const config =
          row.role === "candidate" ? approval.generator : approval.judge;
        if (
          row.model !== config.model ||
          row.exposureMicroUsd > row.reservedMicroUsd ||
          (row.status === "unknown" &&
            row.exposureMicroUsd !== row.reservedMicroUsd) ||
          (row.status === "settled" &&
            (row.inputTokens === undefined ||
              row.outputTokens === undefined ||
              row.estimatedMicroUsd !== row.exposureMicroUsd ||
              estimatedCost(row.inputTokens, row.outputTokens, config) !==
                row.exposureMicroUsd))
        )
          throw new Error("budget_ledger_invalid");
      }
      this.save();
    } catch (error) {
      this.close();
      throw error;
    }
  }
  private save() {
    writeFileSync(
      `${this.path}.tmp`,
      `${JSON.stringify(this.state, null, 2)}\n`,
      { mode: 0o600, flush: true },
    );
    renameSync(`${this.path}.tmp`, this.path);
  }
  used() {
    return this.state.attempts.reduce(
      (sum, attempt) => sum + attempt.exposureMicroUsd,
      0,
    );
  }
  has(id: string) {
    return this.state.attempts.some((attempt) => attempt.id === id);
  }
  reserve(
    id: string,
    role: "candidate" | "judge",
    body: unknown,
    config: BoundConfig,
  ) {
    if (digest(config) !== digest(this.approvedConfigs[role]))
      throw new Error("budget_model_config_changed");
    if (this.has(id)) throw new Error("budget_attempt_already_consumed");
    const bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
    if (bytes > config.inputCap) throw new Error("budget_input_cap");
    const reservedMicroUsd = estimatedCost(
      bytes + 256,
      config.outputCap,
      config,
    );
    if (this.used() + reservedMicroUsd > this.state.approvedMicroUsd)
      throw new Error("budget_exhausted");
    this.state.attempts.push({
      id,
      role,
      model: config.model,
      reservedMicroUsd,
      exposureMicroUsd: reservedMicroUsd,
      status: "unknown",
    });
    this.save(); // Persist worst-case exposure BEFORE any request can leave.
  }
  settle(
    id: string,
    inputTokens: number,
    outputTokens: number,
    config: BoundConfig,
  ) {
    const row = this.state.attempts.find((attempt) => attempt.id === id);
    if (
      !row ||
      row.status !== "unknown" ||
      !Number.isSafeInteger(inputTokens) ||
      !Number.isSafeInteger(outputTokens) ||
      inputTokens < 0 ||
      outputTokens < 0 ||
      outputTokens > config.outputCap ||
      inputTokens > config.inputCap + 256
    )
      throw new Error("budget_usage_invalid");
    if (digest(config) !== digest(this.approvedConfigs[row.role]))
      throw new Error("budget_model_config_changed");
    const cost = estimatedCost(inputTokens, outputTokens, config);
    if (cost > row.reservedMicroUsd || config.model !== row.model)
      throw new Error("budget_usage_exceeds_reservation");
    Object.assign(row, {
      status: "settled",
      inputTokens,
      outputTokens,
      estimatedMicroUsd: cost,
      exposureMicroUsd: cost,
    });
    this.save();
  }
  close() {
    rmSync(this.lockPath, { recursive: true, force: true });
  }
}
