import { AuthForm } from "@/components/auth-form";
import { Brand } from "@/components/brand";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; confirmation?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="auth-page">
      <Brand />
      <div className="auth-layout">
        <aside>
          <div className="eyebrow">LESS NOISE. MORE SIGNAL.</div>
          <h2>
            Good ideas deserve
            <br />a little room
            <br />
            to <em>breathe.</em>
          </h2>
          <p>
            Capture the thought. Find the takeaway.
            <br />
            Come back to what matters.
          </p>
          <div className="auth-art">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </aside>
        <div>
          {params.confirmation === "failed" && (
            <p role="alert" className="alert">
              That confirmation link could not be verified. Try signing in or
              request a new account confirmation.
            </p>
          )}
          <AuthForm
            initialMode={params.mode === "signup" ? "signup" : "login"}
          />
        </div>
      </div>
      <div className="auth-footer">
        Private by design. A reference implementation with synthetic demo data.
      </div>
    </main>
  );
}
