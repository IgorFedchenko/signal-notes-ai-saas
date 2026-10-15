import { z } from "zod";
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
import { traced } from "@/lib/observability/tracing";
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
  config: boundConfigSchema.nullable(),
  contract_version: z.string(),
});
function responseGeneration(value: unknown, content: string, cached: boolean) {
  const row = generationSchema.parse(value);
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
  throw new HttpError(status, message, kind);
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
    const config = generationConfig();
    const reserved = reservationCost(note.content, config);
    const admin = adminClient();
    return await traced(
      "generation",
      undefined,
      {
        "request.id": requestId,
        model: config.model,
        "prompt.version": config.promptVersion,
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
            if (error) throw new Error("reservation_failed");
            return z
              .object({ kind: z.string(), generation: z.unknown().optional() })
              .parse(data);
          });
          if (reservation.kind === "cached")
            return responseGeneration(
              reservation.generation,
              note.content,
              true,
            );
          if (reservation.kind !== "reserved") reject(reservation.kind);
          release = true;
          const { data, error } = await admin.rpc(
            "begin_generation_attempt_v2",
            { p_user: user.id, p_request: requestId },
          );
          if (error) throw new Error("attempt_ack_failed");
          const ack = z
            .object({
              kind: z.string(),
              config: z.unknown().optional(),
              period: z.string().optional(),
              reservedMicroUsd: z.number().optional(),
              traceId: z.string().optional(),
            })
            .parse(data);
          if (ack.kind !== "attempt") reject(ack.kind);
          const bound = boundConfigSchema.parse(ack.config);
          if (
            !ack.period ||
            ack.reservedMicroUsd === undefined ||
            ack.traceId !== traceId ||
            reservationCost(note.content, bound) > ack.reservedMicroUsd
          )
            throw new Error("attempt_ack_invalid");
          // Only this positively acknowledged CAS winner may reach the network.
          const result = await traced(
            "provider",
            root,
            { model: bound.model, "prompt.version": bound.promptVersion },
            () => summarize(note.content, bound),
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
            return z
              .object({ kind: z.string(), generation: z.unknown().optional() })
              .parse(data);
          });
          if (finished.kind !== "succeeded") reject(finished.kind);
          release = false;
          const row = generationSchema.parse(finished.generation);
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
  }
}
