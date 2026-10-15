import { z } from "zod";
import { userClient } from "@/lib/supabase/server";
import { sameOrigin, failure, HttpError, readJson } from "@/lib/http";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = z
      .object({
        action: z.enum(["login", "signup", "logout"]),
        email: z.email().optional(),
        password: z.string().min(10).max(128).optional(),
      })
      .parse(await readJson(request));
    const db = await userClient();
    if (body.action === "logout") {
      const { error } = await db.auth.signOut();
      if (error) throw new HttpError(503, "Could not sign out. Please retry.");
      return Response.json({ ok: true });
    }
    if (!body.email || !body.password)
      throw new HttpError(400, "Email and password are required.");
    if (body.action === "login") {
      const { error } = await db.auth.signInWithPassword({
        email: body.email,
        password: body.password,
      });
      if (error)
        throw new HttpError(
          400,
          "Could not sign in. Check your email and password.",
        );
      return Response.json({ ok: true });
    }
    const { data, error } = await db.auth.signUp({
      email: body.email,
      password: body.password,
    });
    if (error)
      throw new HttpError(
        400,
        "Could not create your account. Please try again later.",
      );
    return Response.json({ ok: true, confirmEmail: !data.session });
  } catch (error) {
    return failure(error);
  }
}
