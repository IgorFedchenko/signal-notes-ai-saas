import { GenerationMetrics } from "./generation-metrics";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import { type SummaryAnswer } from "./types";
export function SummaryPanel({
  answer,
  fixture,
  busy,
  limited,
  generate,
}: {
  answer: SummaryAnswer | null;
  fixture: boolean;
  busy: string;
  limited: boolean;
  generate: () => Promise<void>;
}) {
  return (
    <div className="summary-panel">
      <div className="summary-heading">
        <span>
          <Sparkles size={18} />
          <strong>The important parts</strong>
        </span>
        <span className="summary-label">
          {fixture ? "LOCAL DEMO" : "AI SUMMARY"}
        </span>
      </div>
      {answer ? (
        <>
          {answer.result?.kind === "insufficient_content" ? (
            <p className="summary-text">
              Not enough substantive facts to summarize.
            </p>
          ) : answer.result ? (
            <div className="summary-text">
              {answer.result.takeaways.map((item, index) => (
                <div className="takeaway" key={index}>
                  <p>• {item.text}</p>
                  <details>
                    <summary>Evidence</summary>
                    <blockquote>{item.evidence}</blockquote>
                  </details>
                </div>
              ))}
            </div>
          ) : (
            <p className="summary-text">{answer.text}</p>
          )}
          <div className="summary-meta">
            <Check size={13} />
            Saved to your workspace <span>{answer.provider}</span>
          </div>
          <GenerationMetrics {...answer} />
        </>
      ) : (
        <div className="summary-empty">
          <p>A long note. A few clear takeaways.</p>
          <small>Bring the important parts to the surface.</small>
        </div>
      )}
      <div className="summary-actions">
        <small>
          {limited
            ? "Monthly limit reached"
            : "Uses 1 summary from your monthly plan"}
        </small>
        <button
          className="button primary"
          disabled={!!busy || limited}
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
              {answer ? "Summarize again" : "Summarize note"}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
