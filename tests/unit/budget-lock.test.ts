import { expect, it } from "vitest";
import { fork } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MODEL_PRICES, boundConfigSchema } from "@/lib/ai/pricing";
import { PROMPT_HASH, PROMPT_VERSION } from "@/lib/ai/prompt";
import { SCHEMA_VERSION } from "@/lib/ai/schema";
import { BudgetLedger, type Approval } from "../../evals/budget";
it("T19 simultaneous processes have one spending-lock winner; terminated unknown attempt survives inspected restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "signal-budget-processes-")),
    path = join(directory, "ledger.json"),
    worker = join(directory, "worker.mjs");
  const model = "gpt-5.4-mini-2026-03-17",
    config = boundConfigSchema.parse({
      ...MODEL_PRICES[model],
      model,
      inputCap: 65536,
      outputCap: 800,
      promptVersion: PROMPT_VERSION,
      promptHash: PROMPT_HASH,
      schemaVersion: SCHEMA_VERSION,
    });
  const approval: Approval = {
    status: "approved",
    owner: "Igor",
    scopeId: "synthetic-test-only-no-network",
    ledgerPath: path,
    approvedMicroUsd: 10000,
    datasetHash: "a".repeat(64),
    evaluatorVersion: "lexical-clauses-v1",
    judgePromptHash: "b".repeat(64),
    generator: config,
    judge: config,
    rounds: [{ id: "contract", candidate: true, judge: true }],
  };
  writeFileSync(join(directory, "approval.json"), JSON.stringify(approval));
  writeFileSync(
    worker,
    `import {readFileSync} from 'node:fs'; import {BudgetLedger} from ${JSON.stringify(pathToFileURL(resolve("evals/budget.ts")).href)}; const approval=JSON.parse(readFileSync(process.argv[2])); let calls=0;globalThis.fetch=()=>{calls++;throw Error('No network allowed')};process.send({ready:true});process.once('message',()=>{try{const ledger=new BudgetLedger(approval.ledgerPath,approval);ledger.reserve('candidate/unknown','candidate',{input:'synthetic'},approval.generator);process.send({winner:true,used:ledger.used(),calls});}catch{process.send({winner:false,calls});process.exit(0);}});`,
  );
  const children = Array.from({ length: 2 }, () =>
    fork(worker, [join(directory, "approval.json")], {
      execArgv: ["--conditions=react-server", "--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }),
  );
  try {
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((done, reject) => {
            child.once("error", reject);
            child.once("message", () => done());
          }),
      ),
    );
    const replies = children.map(
      (child) =>
        new Promise<{ winner: boolean; used?: number; calls: number }>((done) =>
          child.once("message", (value) =>
            done(value as { winner: boolean; used?: number; calls: number }),
          ),
        ),
    );
    for (const child of children) child.send("start");
    const result = await Promise.all(replies);
    expect(result.filter((r) => r.winner)).toHaveLength(1);
    expect(result.every((r) => r.calls === 0)).toBe(true);
    const winner = children[result.findIndex((r) => r.winner)],
      held = result.find((r) => r.winner)!.used!;
    expect(() => new BudgetLedger(path, approval)).toThrow("locked");
    const exited = new Promise((resolve) => winner.once("exit", resolve));
    winner.kill("SIGKILL");
    await exited;
    // Owner process has been positively observed terminated; recover ONLY this
    // test-owned lock, then verify durable exposure cannot reset on restart.
    const lock = JSON.parse(readFileSync(`${path}.lock/owner.json`, "utf8"));
    expect(lock.pid).toBe(winner.pid);
    rmSync(`${path}.lock`, { recursive: true });
    const resumed = new BudgetLedger(path, approval);
    try {
      expect(resumed.used()).toBe(held);
      expect(() =>
        resumed.reserve("candidate/unknown", "candidate", {}, config),
      ).toThrow("already_consumed");
      resumed.reserve("judge/next", "judge", { input: "synthetic" }, config);
      expect(resumed.used()).toBeGreaterThan(held);
    } finally {
      resumed.close();
    }
  } finally {
    for (const child of children)
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
}, 10000);
