"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
export function AuthForm({ initialMode }: { initialMode: "login" | "signup" }) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error);
        return;
      }
      if (result.confirmEmail) {
        setMessage("Check your email to confirm your account, then sign in.");
        return;
      }
      router.replace("/workspace");
      router.refresh();
    } catch {
      setMessage("Could not connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-card">
      <div className="eyebrow">YOUR PERSONAL WORKSPACE</div>
      <h1>{mode === "login" ? "Welcome back." : "Make space for ideas."}</h1>
      <p>
        {mode === "login"
          ? "Your notes. Your next clear thought."
          : "A little less noise starts here."}
      </p>
      <form onSubmit={submit}>
        <label>
          Email address
          <input
            type="email"
            name="email"
            placeholder="you@example.com"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            placeholder="At least 10 characters"
            minLength={10}
            maxLength={128}
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            required
          />
        </label>
        {message && (
          <div role="alert" className="alert">
            {message}
          </div>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <>
              {mode === "login" ? "Sign in" : "Create account"}{" "}
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>
      <p className="auth-switch">
        {mode === "login" ? "New to Signal Notes?" : "Already have a space?"}{" "}
        <button
          className="text-button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setMessage("");
          }}
        >
          {mode === "login" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </div>
  );
}
