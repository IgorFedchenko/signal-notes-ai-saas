import { type EmailOtpType } from "@supabase/supabase-js";
import { userClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (hash && type === "signup") {
    const db = await userClient();
    const { error } = await db.auth.verifyOtp({
      token_hash: hash,
      type: type as EmailOtpType,
    });
    if (!error)
      return NextResponse.redirect(new URL("/workspace", process.env.APP_URL));
  }
  return NextResponse.redirect(
    new URL("/login?confirmation=failed", process.env.APP_URL),
  );
}
