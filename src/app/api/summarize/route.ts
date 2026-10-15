import { z } from "zod";
import { errorCode } from "@/lib/error-codes";
import { identity, sameOrigin, readJson, failure, HttpError } from "@/lib/http";
import { adminClient } from "@/lib/supabase/admin";
import { summarize } from "@/lib/ai";
import {
  boundConfigSchema,
  generationConfig,
  reservationCost,
} from "@/lib/ai/pricing";
import { parseSummary } from "@/lib/ai/schema";
import { safeLog } from "@/lib/observability/log";
import { flushTelemetry, traced } from "@/lib/observability/tracing";
export const maxDuration = 60;
const generationSchema = z.object({
  summary: z.string().nullable(),
  provider: z.string().nullable(),
  result: z.unknown().nullable(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  estimated_micro_usd: z.number().int().nonnegative().nullable(),
  latency_ms: z.number().int().nonnegative().nullable(),
  trace_id: z.string().nullable(),
  config: z.object({ promptVersion: z.string() }).nullable(),
  contract_version: z.string(),
});
function databaseValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("invalid_database_reply");
  return parsed.data;
}
function responseGeneration(value: unknown, content: string, cached: boolean) {
  const row = databaseValue(generationSchema, value);
  if (row.contract_version === "v2") parseSummary(row.result, content);
  return Response.json({
    summary: row.summary,
    result: row.result,
    provider: row.provider,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedMicroUsd: row.estimated_micro_usd,
    latencyMs: row.latency_ms,
    traceId: row.trace_id,
    promptVersion: row.config?.promptVersion ?? "legacy-v1",
    cached,
  });
}
const errors: Record<string, [number, string]> = {
  limit: [
    429,
    "Monthly summary limit reached. Upgrade to Pro or wait for the next UTC month.",
  ],
  budget: [
    429,
    "Monthly estimated cost exposure limit reached. Unknown attempts retain their reserved cost.",
  ],
  pending: [409, "This summary is still processing. Retry shortly."],
  conflict: [409, "This request key belongs to a different note."],
  failed: [409, "The previous attempt failed. Start a new summary."],
  not_found: [404, "Note not found."],
  attempt_denied: [
    409,
    "This attempt expired or already started. Start a new summary.",
  ],
  deleted: [409, "The note was deleted before the summary was saved."],
  expired: [409, "The attempt expired before the summary was saved."],
};
function reject(kind: string): never {
  const [status, message] = errors[kind] ?? [
    503,
    "Could not persist the summary.",
  ];
  throw new HttpError(status, message, errorCode(kind));
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { db, user } = await identity();
    const { noteId, requestId } = z
      .object({ noteId: z.uuid(), requestId: z.uuid() })
      .strict()
      .parse(await readJson(request));
    const { data: note, error: noteError } = await db
      .from("notes")
      .select("content")
      .eq("id", noteId)
      .single();
    if (noteError || !note) reject("not_found");
    // A cached success remains readable even when live generation is disabled.
    let config: ReturnType<typeof generationConfig> | null = null;
    let configurationError: unknown;
    try {
      config = generationConfig();
    } catch (error) {
      configurationError = error;
    }
    const reserved = config ? reservationCost(note.content, config) : 0;
    const admin = adminClient();
    return await traced(
      "generation",
      undefined,
      {
        "request.id": requestId,
        model: config?.model ?? "unconfigured",
        "prompt.version": config?.promptVersion ?? "unconfigured",
      },
      async (root) => {
        let release = false;
        const traceId = root.spanContext().traceId;
        try {
          const reservation = await traced("reserve", root, {}, async () => {
            const { data, error } = await admin.rpc("reserve_generation_v2", {
              p_user: user.id,
              p_note: noteId,
              p_request: requestId,
              p_config: config,
              p_reserved: reserved,
              p_trace: traceId,
            });
            if (error)
              throw configurationError ?? new Error("reservation_failed");
            return databaseValue(
              z.object({
                kind: z.string(),
                generation: z.unknown().optional(),
              }),
              data,
            );
          });
          if (reservation.kind === "cached")
            return responseGeneration(
              reservation.generation,
              note.content,
              true,
            );
          if (reservation.kind !== "reserved") reject(reservation.kind);
          release = true;
          const gateStarted = performance.now();
          const { data, error } = await admin.rpc(
            "begin_generation_attempt_v2",
            { p_user: user.id, p_request: requestId },
          );
          if (error) throw new Error("attempt_ack_failed");
          const ack = databaseValue(
            z.object({
              kind: z.string(),
              config: z.unknown().optional(),
              period: z.string().optional(),
              reservedMicroUsd: z.number().optional(),
              traceId: z.string().optional(),
              databaseNow: z.string().optional(),
              expiresAt: z.string().optional(),
            }),
            data,
          );
          if (ack.kind !== "attempt") reject(ack.kind);
          const bound = databaseValue(boundConfigSchema, ack.config);
          if (
            !ack.period ||
            ack.reservedMicroUsd === undefined ||
            ack.traceId !== traceId ||
            reservationCost(note.content, bound) > ack.reservedMicroUsd
          )
            throw new Error("attempt_ack_invalid");
          // Anchor remaining DB TTL to the monotonic time BEFORE the RPC. A late
          // acknowledgement cannot extend the permit or authorize an expired call.
          const remaining =
            Date.parse(ack.expiresAt ?? "") - Date.parse(ack.databaseNow ?? "");
          const deadline = gateStarted + remaining;
          if (
            !Number.isFinite(remaining) ||
            remaining <= 0 ||
            remaining > 120000 ||
            performance.now() >= deadline
          )
            reject("attempt_denied");
          // Only this positively acknowledged CAS winner may reach the network.
          const result = await traced(
            "provider",
            root,
            { model: bound.model, "prompt.version": bound.promptVersion },
            () => summarize(note.content, bound, deadline),
          );
          parseSummary(result.result, note.content);
          const finished = await traced("persist", root, {}, async () => {
            const { data, error } = await admin.rpc("finish_generation_v2", {
              p_user: user.id,
              p_request: requestId,
              p_result: result.result,
              p_input: result.inputTokens,
              p_output: result.outputTokens,
              p_latency: result.latencyMs,
            });
            if (error) throw new Error("persist_failed");
            return databaseValue(
              z.object({
                kind: z.string(),
                generation: z.unknown().optional(),
              }),
              data,
            );
          });
          if (finished.kind !== "succeeded") reject(finished.kind);
          release = false;
          const row = databaseValue(generationSchema, finished.generation);
          root.setAttributes({
            "input.tokens": result.inputTokens,
            "output.tokens": result.outputTokens,
            "estimated.micro_usd": row.estimated_micro_usd ?? 0,
            "latency.ms": result.latencyMs,
          });
          safeLog("generation_completed", {
            requestId,
            traceId,
            model: bound.model,
            promptVersion: bound.promptVersion,
            latencyMs: result.latencyMs,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            estimatedMicroUsd: row.estimated_micro_usd ?? undefined,
          });
          return responseGeneration(finished.generation, note.content, false);
        } finally {
          // A lost begin acknowledgement may have committed; SQL keeps that exposure.
          if (release)
            await admin
              .rpc("fail_generation_v2", {
                p_user: user.id,
                p_request: requestId,
              })
              .then(
                () => undefined,
                () => undefined,
              );
        }
      },
    );
  } catch (error) {
    return failure(error);
  } finally {
    await flushTelemetry();
  }
}
