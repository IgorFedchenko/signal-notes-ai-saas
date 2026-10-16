import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import postgres from "postgres";

// Run only against the disposable local stack created by local:setup.
const database = new URL(process.env.SUPABASE_DB_URL ?? "");
if (
  database.hostname !== "127.0.0.1" ||
  database.port !== "56322" ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56321"
)
  throw Error("Dedicated local database required");
const sql = postgres(database.toString(), { max: 1 });
const directory = "test-results/source-boundaries";
mkdirSync(directory, { recursive: true });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw Error(`git ${args[0]} failed`);
  return result.stdout;
};
const replaceOnce = (source, before, after) => {
  if (source.split(before).length !== 2)
    throw Error("Source boundary changed; review mutation before execution");
  return source.replace(before, after);
};
const migration = "supabase/migrations/202610160002_generation_contract.sql";
const cases = [
  {
    id: "M1",
    file: "src/lib/ai/schema.ts",
    mutate: (source) =>
      replaceOnce(
        source,
        '  if (parsed.data.takeaways.some((item) => !source.includes(item.evidence)))\n    throw new ProviderError("invalid_evidence");\n',
        "",
      ),
    args: [
      "test",
      "--",
      "tests/unit/contract-boundaries.test.ts",
      "-t",
      "rejects non-original evidence",
    ],
    assertion: /expected .*to throw|did not throw/i,
  },
  {
    id: "M2",
    file: migration,
    function: "begin_generation_attempt_v2",
    mutate: (source) =>
      replaceOnce(
        source,
        "and status = 'reserved' and attempt_started is null",
        "and status = 'reserved'",
      ),
    args: [
      "run",
      "test:db",
      "--",
      "tests/db/generation-contract.test.ts",
      "-t",
      "same ID has one row",
    ],
    assertion: /to have a length of 1 but got 4/i,
  },
  {
    id: "M3",
    file: migration,
    function: "fail_generation_v2",
    mutate: (source) => {
      const start = source.indexOf(
        "create function public.fail_generation_v2(",
      );
      if (start < 0) throw Error("Missing failure function");
      return (
        source.slice(0, start) +
        replaceOnce(
          source.slice(start),
          "exposure_micro_usd = case when attempt_started is null then 0 else reserved_micro_usd end",
          "exposure_micro_usd = 0",
        )
      );
    },
    args: [
      "run",
      "test:db",
      "--",
      "tests/db/generation-contract.test.ts",
      "-t",
      "races eight for exactly two",
    ],
    assertion: /100000[\s\S]*17|17[\s\S]*100000/,
  },
  {
    id: "M4",
    file: migration,
    function: "purge_note_generations",
    mutate: (source) =>
      replaceOnce(
        source,
        "update public.generations set summary = null, result = null, source_deleted = true",
        "update public.generations set source_deleted = true",
      ),
    args: [
      "run",
      "test:db",
      "--",
      "tests/db/generation-contract.test.ts",
      "-t",
      "owner JWT delete purges",
    ],
    assertion: /Mira owns the launch|LEGACY_PRIVATE_TEXT/,
  },
  {
    id: "M5",
    file: migration,
    function: "reserve_generation_v2",
    mutate: (source) =>
      replaceOnce(
        source,
        "else max_requests := 5; max_budget := 100000;",
        "else max_requests := 6; max_budget := 100000;",
      ),
    args: [
      "run",
      "test:db",
      "--",
      "tests/db/generation-contract.test.ts",
      "-t",
      "admits five of fifteen",
    ],
    assertion: /to have a length of 5 but got 6/i,
  },
  {
    id: "M6",
    file: "src/lib/observability/tracing.ts",
    mutate: (source) =>
      replaceOnce(
        source,
        "    // Error messages/stack/cause are deliberately never recorded as span events.",
        "    span.recordException(error);",
      ),
    args: ["test", "--", "tests/unit/telemetry-privacy.test.ts"],
    assertion:
      /not to contain.*PRIVATE_NOTE_CANARY|PRIVATE_NOTE_CANARY[\s\S]*not to contain/i,
  },
  {
    id: "M7",
    file: "evals/evaluator.ts",
    mutate: (source) =>
      replaceOnce(
        source,
        `        metrics.failures.push("unsupported_clause");
        if (
          test.forbiddenClauses.some(
            (forbidden) => clauseKey(forbidden) === clause,
          )
        )
          metrics.failures.push("contradiction");`,
        `        metrics.recognizedClauses++;
        supportedQuotes++;`,
      ),
    args: [
      "test",
      "--",
      "tests/unit/evaluation-contract.test.ts",
      "-t",
      "evidence-only facts",
    ],
    assertion: /expected.*recall.*to (?:include|contain).*contradiction/i,
  },
];

function functionDefinition(source, name) {
  const start = source.indexOf(`create function public.${name}(`);
  const end = source.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw Error("Cannot extract SQL function");
  return source
    .slice(start, end + 4)
    .replace("create function", "create or replace function");
}
async function deployedDefinition(name) {
  const rows = await sql`select pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=${name}`;
  if (rows.length !== 1) throw Error("Expected one deployed function");
  return rows[0].definition;
}
function check(test, phase) {
  const result = spawnSync("npm", test.args, {
    encoding: "utf8",
    timeout: 90000,
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(`${directory}/${test.id}-${phase}.log`, output);
  return {
    command: ["npm", ...test.args],
    exit: result.status,
    signal: result.signal,
    error: result.error?.code,
    outputHash: hash(output),
    output,
  };
}
const receipts = [];
const report = {
  sourceSha: git("rev-parse", "HEAD").trim(),
  reviewedRuntimeSha: "6a84c6e4b262fecc46d0a2200ef7bbf23072de41",
  receipts,
};
const save = () =>
  writeFileSync(`${directory}/receipts.json`, JSON.stringify(report, null, 2));
let failed = false;
try {
  for (const test of cases) {
    const original = readFileSync(test.file);
    const changed = test.mutate(original.toString());
    const beforeDefinition = test.function
      ? await deployedDefinition(test.function)
      : undefined;
    const receipt = {
      id: test.id,
      sourceFile: test.file,
      originalSourceHash: hash(original),
      mutatedSourceHash: hash(changed),
      deployedBeforeHash: beforeDefinition && hash(beforeDefinition),
    };
    receipts.push(receipt);
    try {
      writeFileSync(test.file, changed);
      const diff = git("diff", "--", test.file);
      writeFileSync(`${directory}/${test.id}.diff`, diff);
      receipt.diffHash = hash(diff);
      if (test.function) {
        await sql.unsafe(functionDefinition(changed, test.function));
        receipt.deployedMutantHash = hash(
          await deployedDefinition(test.function),
        );
        if (receipt.deployedMutantHash === receipt.deployedBeforeHash)
          throw Error("SQL deployment did not change function");
      }
      const red = check(test, "red");
      receipt.red = { ...red, output: undefined };
      receipt.assertionObserved =
        red.exit !== null &&
        red.exit !== 0 &&
        !red.error &&
        test.assertion.test(red.output) &&
        /AssertionError|Negative control did not fail/.test(red.output);
      if (!receipt.assertionObserved) failed = true;
    } finally {
      writeFileSync(test.file, original);
      if (test.function) {
        await sql.unsafe(
          functionDefinition(original.toString(), test.function),
        );
        receipt.deployedRestoredHash = hash(
          await deployedDefinition(test.function),
        );
      }
      receipt.restoredSourceHash = hash(readFileSync(test.file));
      receipt.restorationExact =
        receipt.restoredSourceHash === receipt.originalSourceHash &&
        receipt.deployedRestoredHash === receipt.deployedBeforeHash;
      if (!receipt.restorationExact) failed = true;
      const green = check(test, "green");
      receipt.green = { ...green, output: undefined };
      if (green.exit !== 0 || green.error) failed = true;
      save();
    }
    console.log(
      `${test.id}: assertion red=${receipt.assertionObserved}, exact restoration=${receipt.restorationExact}, green=${receipt.green.exit}`,
    );
  }
  report.trackedSourceRestored =
    git("diff", "--", ...new Set(cases.map((test) => test.file))) === "";
  if (!report.trackedSourceRestored) failed = true;
  report.pass = !failed && receipts.length === 7;
  save();
} finally {
  await sql.end();
}
if (failed) process.exitCode = 1;
