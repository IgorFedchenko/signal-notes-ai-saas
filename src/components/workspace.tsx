"use client";
import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  FileText,
  LoaderCircle,
  LogOut,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Brand } from "./brand";
import { PLANS, effectivePlan, type BillingAccount } from "@/lib/plans";

type Note = { id: string; title: string; content: string; created_at: string };
type Generation = {
  request_id: string;
  note_id: string | null;
  summary: string | null;
  provider: string | null;
  status: string;
  period: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  expires_at: string;
};
type View = "notes" | "usage" | "billing";
export function Workspace(props: {
  email: string;
  notes: Note[];
  generations: Generation[];
  account: BillingAccount;
  billingEnabled: boolean;
  fixture: boolean;
  monthlyUsage: { used: number; tokens: number };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState<View>("notes");
  const [notes, setNotes] = useState(props.notes);
  const [selected, setSelected] = useState<Note | null>(props.notes[0] ?? null);
  const [composer, setComposer] = useState(!props.notes.length);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<{
    noteId: string;
    text: string;
    provider: string;
  } | null>(null);
  const request = useRef<{ noteId: string; key: string } | null>(null);
  const plan = effectivePlan(props.account);
  const { used, tokens } = props.monthlyUsage;
  const completed = props.generations.filter((g) => g.status === "succeeded");
  const previous = props.generations.find(
    (g) => g.note_id === selected?.id && g.status === "succeeded",
  );
  const currentAnswer =
    answer?.noteId === selected?.id
      ? answer
      : previous
        ? { text: previous.summary!, provider: previous.provider! }
        : null;

  async function call(path: string, body: unknown, method = "POST") {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      if (
        path === "/api/summarize" &&
        response.status !== 503 &&
        !(response.status === 409 && data.error.includes("processing"))
      )
        request.current = null;
      throw new Error(data.error || "Please try again.");
    }
    return data;
  }
  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy("");
    }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run("save", async () => {
      const { note } = await call("/api/notes", {
        title: form.get("title"),
        content: form.get("content"),
      });
      setNotes([note, ...notes]);
      setSelected(note);
      setComposer(false);
      router.refresh();
    });
  }
  async function generate() {
    if (!selected) return;
    await run("summary", async () => {
      if (request.current?.noteId !== selected.id)
        request.current = { noteId: selected.id, key: crypto.randomUUID() };
      const result = await call("/api/summarize", {
        noteId: selected.id,
        requestId: request.current.key,
      });
      setAnswer({
        noteId: selected.id,
        text: result.summary,
        provider: result.provider,
      });
      request.current = null;
      router.refresh();
    });
  }
  async function billing(kind: "checkout" | "portal") {
    await run(kind, async () => {
      const result = await call(`/api/billing/${kind}`, {});
      window.location.assign(result.url);
    });
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand dark />
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav aria-label="Workspace">
          {[
            { id: "notes", icon: BookOpen, text: "My notes" },
            { id: "usage", icon: Clock3, text: "Usage & activity" },
            { id: "billing", icon: CreditCard, text: "Plan & billing" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setView(item.id as View);
                setError("");
              }}
              className={`nav-item ${view === item.id ? "active" : ""}`}
            >
              <item.icon size={18} />
              {item.text}
              {item.id === "notes" && <span>{notes.length}</span>}
            </button>
          ))}
          <button
            className="nav-item mobile-signout"
            aria-label="Sign out"
            disabled={!!busy}
            onClick={() =>
              run("logout", async () => {
                await call("/api/auth", { action: "logout" });
                router.replace("/login");
                router.refresh();
              })
            }
          >
            <LogOut size={18} />
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="plan-mini">
            <div>
              <Sparkles size={15} />
              {PLANS[plan].name} plan
              <span>
                {used}/{PLANS[plan].limit}
              </span>
            </div>
            <progress
              aria-label="Monthly summaries used"
              value={used}
              max={PLANS[plan].limit}
            />
            <small>Summaries this month</small>
            {plan === "free" && (
              <button onClick={() => setView("billing")}>
                A little more room <ArrowUpRight size={14} />
              </button>
            )}
          </div>
          <div className="account">
            <div className="avatar">{props.email[0].toUpperCase()}</div>
            <div>
              <strong>Your workspace</strong>
              <span>{props.email}</span>
            </div>
            <button
              aria-label="Sign out"
              disabled={!!busy}
              onClick={() =>
                run("logout", async () => {
                  await call("/api/auth", { action: "logout" });
                  router.replace("/login");
                  router.refresh();
                })
              }
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="app-topbar">
          <span>
            Workspace <ChevronRight size={13} />
            <strong>
              {view === "notes"
                ? "My notes"
                : view === "usage"
                  ? "Usage & activity"
                  : "Plan & billing"}
            </strong>
          </span>
          <div>
            <ShieldCheck size={14} /> Private workspace
          </div>
        </header>
        <div className="workspace-content">
          <div className="page-heading">
            <div className="eyebrow">A LITTLE CLARITY GOES A LONG WAY</div>
            <div className="heading-row">
              <div>
                <h1>
                  {view === "notes"
                    ? "Your ideas, in focus."
                    : view === "usage"
                      ? "Room to think."
                      : "Make room for more."}
                </h1>
                <p>
                  {view === "notes"
                    ? "Capture a thought. Keep what matters."
                    : view === "usage"
                      ? "A clear view of what you have used this month."
                      : "Simple plans for your next good idea."}
                </p>
              </div>
              {view === "notes" && (
                <button
                  className="button primary"
                  onClick={() => {
                    setComposer(true);
                    setError("");
                  }}
                >
                  <Plus size={17} />
                  New note
                </button>
              )}
            </div>
          </div>
          {props.fixture && (
            <div className="demo-banner">
              <span className="dot" />
              Local demo{" "}
              <span>
                Summaries use sentence extraction. No AI API calls or charges.
              </span>
            </div>
          )}
          {params.get("billing") === "success" && (
            <div className="notice">
              <Check size={16} />
              Checkout complete. Your plan updates after the verified webhook
              arrives.
              <button className="text-button" onClick={() => router.refresh()}>
                Refresh plan
              </button>
            </div>
          )}
          {params.get("billing") === "canceled" && (
            <div className="notice">
              Checkout canceled. Your current plan is unchanged.
            </div>
          )}
          {error && (
            <div role="alert" className="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="stats-grid">
            <article>
              <span>
                YOUR NOTES <FileText size={16} />
              </span>
              <strong>{notes.length.toString().padStart(2, "0")}</strong>
              <small>A home for your ideas</small>
            </article>
            <article>
              <span>
                MONTHLY SUMMARIES <Sparkles size={16} />
              </span>
              <strong data-testid="usage-count">
                {used.toString().padStart(2, "0")}
                <em> / {PLANS[plan].limit}</em>
              </strong>
              <small>
                {Math.max(0, PLANS[plan].limit - used)} left to find your focus
              </small>
            </article>
            <article>
              <span>
                CURRENT PLAN <ArrowUpRight size={16} />
              </span>
              <strong>
                {PLANS[plan].name}
                <i className="small-tag">
                  {plan === "pro" ? "TEST" : "PERSONAL"}
                </i>
              </strong>
              <small>Resets on the first of each UTC month</small>
            </article>
          </div>
          {view === "notes" && (
            <section className="note-workbench">
              <div className="note-list">
                <div className="panel-heading">
                  <h2>
                    All notes <span>{notes.length}</span>
                  </h2>
                  <FileText size={16} />
                </div>
                {notes.length === 0 && (
                  <p className="empty-list">
                    Your next idea starts here.
                    <br />
                    Create your first note.
                  </p>
                )}
                {notes.map((note) => (
                  <button
                    key={note.id}
                    className={`note-item ${selected?.id === note.id && !composer ? "selected" : ""}`}
                    onClick={() => {
                      setSelected(note);
                      setComposer(false);
                      setError("");
                    }}
                  >
                    <span className="note-icon">
                      <FileText size={16} />
                    </span>
                    <strong>{note.title}</strong>
                    <p>{note.content}</p>
                    <small>
                      {new Date(note.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                      <ArrowUpRight size={13} />
                    </small>
                  </button>
                ))}
                <div className="list-footer">
                  <ShieldCheck size={13} />
                  Only you can see these notes
                </div>
              </div>
              <div className="note-detail">
                {composer ? (
                  <form onSubmit={save} className="note-composer">
                    <div className="detail-toolbar">
                      <span className="tag">
                        <Plus size={13} /> A NEW THOUGHT
                      </span>
                      {selected && (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Cancel new note"
                          onClick={() => setComposer(false)}
                        >
                          <X size={18} />
                        </button>
                      )}
                    </div>
                    <label>
                      Note title
                      <input
                        name="title"
                        placeholder="Give your idea a name…"
                        maxLength={120}
                        required
                      />
                    </label>
                    <label>
                      Your note
                      <textarea
                        name="content"
                        placeholder="Meeting notes, a rough idea, something worth remembering…"
                        minLength={20}
                        maxLength={12000}
                        rows={9}
                        required
                      />
                    </label>
                    <div className="composer-footer">
                      <small>20–12,000 characters · Plain text</small>
                      <button className="button primary" disabled={!!busy}>
                        {busy === "save" ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <>
                            <Check size={16} />
                            Save note
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                ) : selected ? (
                  <>
                    <div className="detail-toolbar">
                      <span className="tag">
                        <FileText size={13} /> NOTE
                      </span>
                      <button
                        className="icon-button delete-button"
                        disabled={!!busy}
                        aria-label="Delete note"
                        onClick={() =>
                          run("delete", async () => {
                            if (
                              !window.confirm(
                                "Delete this note? This cannot be undone.",
                              )
                            )
                              return;
                            await call(
                              "/api/notes",
                              { id: selected.id },
                              "DELETE",
                            );
                            const remaining = notes.filter(
                              (n) => n.id !== selected.id,
                            );
                            setNotes(remaining);
                            setSelected(remaining[0] ?? null);
                            setComposer(!remaining.length);
                            router.refresh();
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <h2 className="note-title">{selected.title}</h2>
                    <div className="note-date">
                      <Clock3 size={13} />
                      {new Date(selected.created_at).toLocaleDateString(
                        "en-US",
                        { month: "long", day: "numeric", year: "numeric" },
                      )}
                      <span>·</span>
                      {selected.content.split(/\s+/).length} words
                    </div>
                    <p className="note-body">{selected.content}</p>
                    <div className="summary-panel">
                      <div className="summary-heading">
                        <span>
                          <Sparkles size={18} />
                          <strong>The important parts</strong>
                        </span>
                        <span className="summary-label">
                          {props.fixture ? "LOCAL DEMO" : "AI SUMMARY"}
                        </span>
                      </div>
                      {currentAnswer ? (
                        <>
                          <p className="summary-text">{currentAnswer.text}</p>
                          <div className="summary-meta">
                            <Check size={13} />
                            Saved to your workspace{" "}
                            <span>{currentAnswer.provider}</span>
                          </div>
                        </>
                      ) : (
                        <div className="summary-empty">
                          <p>A long note. A few clear takeaways.</p>
                          <small>
                            Bring the important parts to the surface.
                          </small>
                        </div>
                      )}
                      <div className="summary-actions">
                        <small>
                          {used >= PLANS[plan].limit
                            ? "Monthly limit reached"
                            : "Uses 1 summary from your monthly plan"}
                        </small>
                        <button
                          className="button primary"
                          disabled={!!busy || used >= PLANS[plan].limit}
                          onClick={generate}
                        >
                          {busy === "summary" ? (
                            <>
                              <LoaderCircle className="spin" size={16} />
                              Finding the signal…
                            </>
                          ) : (
                            <>
                              <Sparkles size={15} />
                              {currentAnswer
                                ? "Summarize again"
                                : "Summarize note"}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="note-footnote">
                      <ShieldCheck size={13} />
                      {props.fixture
                        ? "No note data leaves your local workspace."
                        : "This note is sent to your configured AI provider when you summarize. Review AI output before relying on it."}
                    </div>
                  </>
                ) : null}
              </div>
            </section>
          )}
          {view === "usage" && (
            <section className="activity-panel">
              <div className="panel-heading">
                <h2>Summary activity</h2>
                <span className="tag">
                  {tokens.toLocaleString()} MODEL TOKENS THIS MONTH
                </span>
              </div>
              {completed.length === 0 ? (
                <div className="empty-state">
                  <Sparkles size={28} />
                  <h3>A fresh start.</h3>
                  <p>Your first summary will appear here.</p>
                  <button
                    className="button secondary"
                    onClick={() => setView("notes")}
                  >
                    Go to notes <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                <div className="activity-table">
                  <div className="table-row table-head">
                    <span>NOTE</span>
                    <span>PROVIDER</span>
                    <span>TOKENS</span>
                    <span>CREATED</span>
                  </div>
                  {completed.map((g) => (
                    <div className="table-row" key={g.request_id}>
                      <span>
                        <ArrowDownLeft size={15} />
                        {notes.find((n) => n.id === g.note_id)?.title ??
                          "Deleted note"}
                      </span>
                      <span>{g.provider}</span>
                      <span>{g.input_tokens + g.output_tokens}</span>
                      <span>
                        {new Date(g.created_at).toLocaleDateString("en-US")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="panel-footnote">
                Usage includes completed summaries and active reservations.
                Failed attempts release their reservation. Local extraction
                records zero model tokens.
              </p>
            </section>
          )}
          {view === "billing" && (
            <section className="billing-panel">
              <div className="price-grid">
                {(["free", "pro"] as const).map((p) => (
                  <article
                    key={p}
                    className={`price-card ${p === "pro" ? "featured" : ""}`}
                  >
                    <span className="tag">
                      {PLANS[p].name}
                      {p === plan ? " · CURRENT PLAN" : ""}
                    </span>
                    <h3>
                      {PLANS[p].price}
                      <small>/ month</small>
                    </h3>
                    <p>
                      {p === "free"
                        ? "For a fresh perspective."
                        : "For a mind full of ideas."}
                    </p>
                    <div className="price-feature">
                      <Check size={16} />
                      {PLANS[p].limit} summaries per UTC month
                    </div>
                    <div className="price-feature">
                      <Check size={16} />
                      Private notes & summary history
                    </div>
                    <button
                      className={`button ${p === "pro" ? "primary" : "secondary"}`}
                      disabled={
                        !!busy ||
                        p === plan ||
                        p === "free" ||
                        !props.billingEnabled
                      }
                      onClick={() => billing("checkout")}
                    >
                      {p === plan
                        ? "Your current plan"
                        : p === "free"
                          ? "Manage in billing portal"
                          : "Try Pro in test mode"}
                      <ArrowUpRight size={15} />
                    </button>
                  </article>
                ))}
              </div>
              <div className="billing-note">
                <CreditCard size={20} />
                <div>
                  <h3>Billing, on your terms.</h3>
                  <p>
                    {props.billingEnabled
                      ? "Stripe test mode is enabled. Use test payment details only. No real money is collected."
                      : "Stripe test billing is not connected in this local demo. Checkout becomes available when the owner configures test credentials."}
                  </p>
                  <button
                    className="text-button"
                    disabled={
                      !!busy ||
                      !props.billingEnabled ||
                      !props.account.stripe_customer_id
                    }
                    onClick={() => billing("portal")}
                  >
                    Open customer portal <ArrowUpRight size={14} />
                  </button>
                </div>
              </div>
            </section>
          )}
          <div className="workspace-footer">
            <span>
              <span className="dot" />A little less noise.
            </span>
            <span>Signal Notes · Reference implementation</span>
          </div>
        </div>
      </main>
    </div>
  );
}
