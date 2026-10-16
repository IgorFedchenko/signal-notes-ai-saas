import "server-only";
// Never accept Error, request, provider payload, note, email or arbitrary objects.
export type SafeFields = {
  requestId?: string;
  traceId?: string;
  operation?: string;
  status?: string;
  code?: string;
  model?: string;
  promptVersion?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedMicroUsd?: number;
};
const allowed = new Set([
  "requestId",
  "traceId",
  "operation",
  "status",
  "code",
  "model",
  "promptVersion",
  "latencyMs",
  "inputTokens",
  "outputTokens",
  "estimatedMicroUsd",
]);
export function safeLog(
  event: "generation_completed" | "request_failed" | "telemetry_unavailable",
  fields: SafeFields = {},
) {
  const clean: Record<string, string | number> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (
      allowed.has(key) &&
      ((typeof value === "string" && value.length <= 128) ||
        (typeof value === "number" && Number.isFinite(value)))
    )
      clean[key] = value;
  }
  console.log(JSON.stringify(clean));
}
