import { dollars, type SummaryAnswer } from "./types";
export function GenerationMetrics(
  metrics: Pick<
    SummaryAnswer,
    | "inputTokens"
    | "outputTokens"
    | "estimatedMicroUsd"
    | "latencyMs"
    | "traceId"
    | "promptVersion"
  >,
) {
  return (
    <dl className="generation-metrics">
      <div>
        <dt>Model tokens</dt>
        <dd>{metrics.inputTokens + metrics.outputTokens}</dd>
      </div>
      <div>
        <dt>Estimated token cost</dt>
        <dd>
          {metrics.estimatedMicroUsd === null
            ? "Unknown (legacy)"
            : dollars(metrics.estimatedMicroUsd)}
        </dd>
      </div>
      <div>
        <dt>Latency</dt>
        <dd>
          {metrics.latencyMs === null ? "Unknown" : `${metrics.latencyMs} ms`}
        </dd>
      </div>
      <div>
        <dt>Prompt</dt>
        <dd>{metrics.promptVersion}</dd>
      </div>
      <div className="trace">
        <dt>Trace ID</dt>
        <dd>{metrics.traceId ?? "Unavailable (legacy)"}</dd>
      </div>
    </dl>
  );
}
