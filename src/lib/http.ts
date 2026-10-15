import "server-only";
import { userClient } from "@/lib/supabase/server";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function identity() {
  const db = await userClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user)
    throw new HttpError(401, "Please sign in to continue.");
  return { db, user: data.user };
}
export function sameOrigin(request: Request) {
  const expected = new URL(process.env.APP_URL!).origin;
  if (request.headers.get("origin") !== expected)
    throw new HttpError(403, "Request origin rejected.");
}
export async function readText(request: Request, limit = 65536) {
  // Bound the stream, including chunked requests that omit Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Request body is required.");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > limit) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large.");
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
  const text = await readText(request);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError)
    return Response.json(
      { error: error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  // Do not log user content, keys, provider responses, or DB connection strings.
  console.error("request_failed", {
    category: error instanceof Error ? error.name : "unknown",
  });
  return Response.json(
    { error: "Something went wrong. Please try again." },
    { status: 503 },
  );
}
