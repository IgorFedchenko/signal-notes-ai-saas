import "server-only";
import { userClient } from "@/lib/supabase/server";
import { z } from "zod";
import { ProviderError } from "./ai/schema";
import type { ErrorCode } from "./error-codes";
import { safeLog } from "./observability/log";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: ErrorCode = "request_rejected",
  ) {
    super(message);
  }
}
export async function identity() {
  const db = await userClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user)
    throw new HttpError(
      401,
      "Please sign in to continue.",
      "authentication_required",
    );
  return { db, user: data.user };
}
export function sameOrigin(request: Request) {
  const expected = new URL(process.env.APP_URL!).origin;
  if (request.headers.get("origin") !== expected)
    throw new HttpError(403, "Request origin rejected.", "origin_rejected");
}
export async function readText(request: Request, limit = 65536) {
  // Bound the stream, including chunked requests that omit Content-Length.
  const reader = request.body?.getReader();
  if (!reader)
    throw new HttpError(400, "Request body is required.", "body_required");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > limit) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large.", "request_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(body);
}
export async function readJson(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new HttpError(415, "Use application/json.", "invalid_content_type");
  const text = await readText(request);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON.", "invalid_json");
  }
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  if (error instanceof ProviderError) {
    safeLog("request_failed", { code: error.code });
    return Response.json(
      {
        error:
          error.code === "ai_unconfigured"
            ? "AI is not configured for approved use."
            : "The summary could not be completed. Start a new attempt.",
        code: error.code,
      },
      { status: 503 },
    );
  }
  if (error instanceof z.ZodError)
    return Response.json(
      { error: "Invalid input.", code: "invalid_input" },
      { status: 400 },
    );
  safeLog("request_failed", { code: "temporarily_unavailable" });
  return Response.json(
    {
      error: "Something went wrong. Please try again.",
      code: "temporarily_unavailable",
    },
    { status: 503 },
  );
}
