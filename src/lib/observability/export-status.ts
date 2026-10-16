// Never serialize SDK messages, response bodies, URLs, causes, or stacks.
export function exportFailureStatus(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const code = "code" in error ? error.code : undefined;
  if (
    typeof code === "number" &&
    Number.isInteger(code) &&
    code >= 100 &&
    code <= 599
  )
    return `http_${code}`;
  if (
    typeof code === "string" &&
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EPIPE",
      "EAI_AGAIN",
    ].includes(code)
  )
    return code;
  const name = "name" in error ? error.name : undefined;
  return name === "TypeError"
    ? "type_error"
    : name === "OTLPExporterError"
      ? "otlp_error"
      : "unknown";
}
