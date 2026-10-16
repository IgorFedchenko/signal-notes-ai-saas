export const ERROR_CODES = [
  "request_rejected",
  "invalid_input",
  "invalid_content_type",
  "temporarily_unavailable",
  "authentication_required",
  "origin_rejected",
  "body_required",
  "request_too_large",
  "invalid_json",
  "limit",
  "budget",
  "pending",
  "conflict",
  "failed",
  "not_found",
  "attempt_denied",
  "deleted",
  "expired",
  "finish_denied",
  "provider_unavailable",
  "provider_refused",
  "provider_truncated",
  "provider_invalid",
  "invalid_evidence",
  "ai_unconfigured",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export function errorCode(value: unknown): ErrorCode {
  return typeof value === "string" &&
    (ERROR_CODES as readonly string[]).includes(value)
    ? (value as ErrorCode)
    : "temporarily_unavailable";
}
