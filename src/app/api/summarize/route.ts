import { z } from "zod";
import { identity, sameOrigin, readJson, failure, HttpError } from "@/lib/http";
import { adminClient } from "@/lib/supabase/admin";
import { summarize } from "@/lib/ai";
export const maxDuration = 60;
export async function POST(request: Request) {
  let release: (() => Promise<void>) | undefined;
  try {
    sameOrigin(request);
    const { db, user } = await identity();
    const { noteId, requestId } = z
      .object({ noteId: z.uuid(), requestId: z.uuid() })
      .parse(await readJson(request));
    const { data: note, error: noteError } = await db
      .from("notes")
      .select("content")
      .eq("id", noteId)
      .single();
    if (noteError || !note) throw new HttpError(404, "Note not found.");
    const admin = adminClient();
    const { data: reservation, error } = await admin.rpc("reserve_generation", {
      p_user: user.id,
      p_note: noteId,
      p_request: requestId,
    });
    if (error) throw error;
    if (reservation.kind === "cached")
      return Response.json({
        summary: reservation.summary,
        provider: reservation.provider,
        cached: true,
      });
    const errors: Record<string, [number, string]> = {
      limit: [
        429,
        "Monthly summary limit reached. Upgrade to Pro or wait for the next UTC month.",
      ],
      pending: [409, "This summary is still processing. Retry shortly."],
      conflict: [409, "This request key belongs to a different note."],
      failed: [409, "The previous attempt failed. Start a new summary."],
      not_found: [404, "Note not found."],
    };
    if (reservation.kind !== "reserved") {
      const [code, message] = errors[reservation.kind] ?? [
        503,
        "Could not reserve usage.",
      ];
      throw new HttpError(code, message);
    }
    release = async () => {
      await admin.rpc("fail_generation", {
        p_user: user.id,
        p_request: requestId,
      });
    };
    const result = await summarize(note.content);
    const { data: finished, error: finishError } = await admin.rpc(
      "finish_generation",
      {
        p_user: user.id,
        p_request: requestId,
        p_summary: result.text,
        p_provider: result.provider,
        p_input: result.inputTokens,
        p_output: result.outputTokens,
      },
    );
    if (finishError || !finished) throw new Error("Could not persist summary");
    release = undefined;
    return Response.json({
      summary: result.text,
      provider: result.provider,
      cached: false,
    });
  } catch (error) {
    if (release) await release().catch(() => undefined);
    return failure(error);
  }
}
