import { z } from "zod";
import { identity, sameOrigin, readJson, failure, HttpError } from "@/lib/http";
const schema = z
  .object({
    title: z.string().trim().min(1).max(120),
    content: z
      .string()
      .trim()
      .min(20, "Add at least 20 characters.")
      .max(12000),
  })
  .strict();
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { db, user } = await identity();
    const note = schema.parse(await readJson(request));
    const { data, error } = await db
      .from("notes")
      .insert({ ...note, user_id: user.id })
      .select()
      .single();
    if (error) throw new HttpError(503, "Could not save your note.");
    return Response.json({ note: data }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const { db } = await identity();
    const { id } = z.object({ id: z.uuid() }).parse(await readJson(request));
    const { data, error } = await db
      .from("notes")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw new HttpError(503, "Could not delete your note.");
    if (!data?.length) throw new HttpError(404, "Note not found.");
    return Response.json({ deleted: true });
  } catch (error) {
    return failure(error);
  }
}
