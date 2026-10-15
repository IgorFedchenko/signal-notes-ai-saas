"use client";
import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  FileText,
  LogOut,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Brand } from "./brand";
import type { Note, Generation, SummaryAnswer } from "./workspace/types";
import { call, ApiError } from "./workspace/api";
import { NoteComposer } from "./workspace/note-composer";
import { SummaryPanel } from "./workspace/summary-panel";
import { UsagePanel } from "./workspace/usage-panel";
import { BillingPanel } from "./workspace/billing-panel";
import { PLANS, effectivePlan, type BillingAccount } from "@/lib/plans";

type View = "notes" | "usage" | "billing";
export function Workspace(props: {
  email: string;
  notes: Note[];
  generations: Generation[];
  account: BillingAccount;
  billingEnabled: boolean;
  fixture: boolean;
  monthlyUsage: { used: number; tokens: number; exposureMicroUsd: number };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState<View>("notes");
  const [notes, setNotes] = useState(props.notes);
  const [selected, setSelected] = useState<Note | null>(props.notes[0] ?? null);
  const [composer, setComposer] = useState(!props.notes.length);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<SummaryAnswer | null>(null);
  const request = useRef<{ noteId: string; key: string } | null>(null);
  const plan = effectivePlan(props.account);
  const { used, tokens } = props.monthlyUsage;

  const previous = props.generations.find(
    (g) => g.note_id === selected?.id && g.status === "succeeded",
  );
  const currentAnswer =
    answer?.noteId === selected?.id
      ? answer
      : previous
        ? {
            text: previous.summary,
            result: previous.result,
            provider: previous.provider,
            inputTokens: previous.input_tokens,
            outputTokens: previous.output_tokens,
            estimatedMicroUsd: previous.estimated_micro_usd,
            latencyMs: previous.latency_ms,
            traceId: previous.trace_id,
            promptVersion: previous.config?.promptVersion ?? "legacy-v1",
          }
        : null;

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
      let result;
      try {
        result = await call("/api/summarize", {
          noteId: selected.id,
          requestId: request.current.key,
        });
      } catch (error) {
        if (
          error instanceof ApiError &&
          !["pending", "temporarily_unavailable"].includes(error.code)
        )
          request.current = null;
        throw error;
      }
      setAnswer({
        noteId: selected.id,
        text: result.summary,
        provider: result.provider,
        result: result.result,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedMicroUsd: result.estimatedMicroUsd,
        latencyMs: result.latencyMs,
        traceId: result.traceId,
        promptVersion: result.promptVersion,
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
                  <NoteComposer
                    onSave={save}
                    busy={busy}
                    selected={!!selected}
                    onCancel={() => setComposer(false)}
                  />
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
                    <SummaryPanel
                      answer={currentAnswer}
                      fixture={props.fixture}
                      busy={busy}
                      limited={used >= PLANS[plan].limit}
                      generate={generate}
                    />
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
            <UsagePanel
              generations={props.generations}
              notes={notes}
              tokens={tokens}
              exposureMicroUsd={props.monthlyUsage.exposureMicroUsd}
              plan={plan}
              onNotes={() => setView("notes")}
            />
          )}
          {view === "billing" && (
            <BillingPanel
              account={props.account}
              billingEnabled={props.billingEnabled}
              busy={busy}
              plan={plan}
              billing={billing}
            />
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
