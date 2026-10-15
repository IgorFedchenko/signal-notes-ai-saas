import { ArrowDownLeft, ArrowRight, Sparkles } from "lucide-react";
import { dollars, type Generation, type Note } from "./types";
export function UsagePanel({
  generations,
  notes,
  tokens,
  exposureMicroUsd,
  plan,
  onNotes,
}: {
  generations: Generation[];
  notes: Note[];
  tokens: number;
  exposureMicroUsd: number;
  plan: "free" | "pro";
  onNotes: () => void;
}) {
  const completed = generations;
  return (
    <section className="activity-panel">
      <div className="panel-heading">
        <h2>Summary activity</h2>
        <span className="tag">
          {tokens.toLocaleString()} MODEL TOKENS THIS MONTH
        </span>
      </div>
      <p className="panel-footnote">
        Estimated monthly exposure: {dollars(exposureMicroUsd)} /{" "}
        {plan === "pro" ? "$2.00" : "$0.10"}. Legacy costs remain unknown.
      </p>
      {completed.length === 0 ? (
        <div className="empty-state">
          <Sparkles size={28} />
          <h3>A fresh start.</h3>
          <p>Your first summary will appear here.</p>
          <button className="button secondary" onClick={() => onNotes()}>
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
                {notes.find((n) => n.id === g.note_id)?.title ?? "Deleted note"}
              </span>
              <span>
                {g.provider}
                <small>
                  {g.cost_status === "legacy_unknown"
                    ? "Historical cost unknown"
                    : g.cost_status === "unknown"
                      ? "Attempt cost unknown"
                      : g.status}
                </small>
              </span>
              <span>
                {g.input_tokens + g.output_tokens}
                <small>
                  Exposure{" "}
                  {g.exposure_micro_usd === null
                    ? "unknown"
                    : dollars(g.exposure_micro_usd)}
                </small>
              </span>
              <span>{new Date(g.created_at).toLocaleDateString("en-US")}</span>
            </div>
          ))}
        </div>
      )}
      <p className="panel-footnote">
        Usage includes completed summaries and active reservations. Failed
        attempts release their count slot; attempted or ambiguous calls retain
        conservative cost exposure until settled. Local extraction records zero
        model tokens and cost.
      </p>
    </section>
  );
}
