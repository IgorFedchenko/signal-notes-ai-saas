import { z } from "zod";
import { summarySchema } from "@/lib/ai/schema";
import { errorCode, type ErrorCode } from "@/lib/error-codes";

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
const count = z.number().int().nonnegative();
const noteReply = z.object({
  note: z.object({
    id: z.uuid(),
    title: z.string(),
    content: z.string(),
    created_at: z.string(),
  }),
});
const summaryReply = z.object({
  summary: z.string().nullable(),
  result: summarySchema.nullable(),
  provider: z.string().nullable(),
  inputTokens: count,
  outputTokens: count,
  estimatedMicroUsd: count.nullable(),
  latencyMs: count.nullable(),
  traceId: z.string().nullable(),
  promptVersion: z.string(),
  cached: z.boolean(),
});
const redirectReply = z.object({
  url: z.url().refine((value) => new URL(value).protocol === "https:"),
});
const okReply = z.object({ ok: z.literal(true) });
const deleteReply = z.object({ deleted: z.literal(true) });
async function call<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  method = "POST",
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const failure = z
      .object({ code: z.unknown().optional(), error: z.string().optional() })
      .safeParse(data);
    throw new ApiError(
      errorCode(failure.success ? failure.data.code : undefined),
      failure.success
        ? (failure.data.error ?? "Please try again.")
        : "Please try again.",
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new ApiError(
      "temporarily_unavailable",
      "Unexpected server response. Please try again.",
    );
  return parsed.data;
}
export const createNote = (body: {
  title: FormDataEntryValue | null;
  content: FormDataEntryValue | null;
}) => call("/api/notes", body, noteReply);
export const generateSummary = (body: { noteId: string; requestId: string }) =>
  call("/api/summarize", body, summaryReply);
export const openBilling = (kind: "checkout" | "portal") =>
  call(`/api/billing/${kind}`, {}, redirectReply);
export const signOut = () => call("/api/auth", { action: "logout" }, okReply);
export const deleteNote = (id: string) =>
  call("/api/notes", { id }, deleteReply, "DELETE");
