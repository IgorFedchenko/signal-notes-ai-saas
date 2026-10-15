import { z } from "zod";

export const SCHEMA_VERSION = "summary-v2";
export const summarySchema = z
  .object({
    kind: z.enum(["summary", "insufficient_content"]),
    takeaways: z
      .array(
        z
          .object({
            text: z.string().min(1).max(500),
            evidence: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .max(3),
  })
  .strict()
  .refine(
    (value) =>
      value.kind === "summary"
        ? value.takeaways.length >= 1
        : value.takeaways.length === 0,
    { message: "Outcome and takeaway count disagree" },
  );
export type SummaryResult = z.infer<typeof summarySchema>;

// Keep the provider root an object; cross-field cardinality is checked at runtime.
export const summaryJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "takeaways"],
  properties: {
    kind: { type: "string", enum: ["summary", "insufficient_content"] },
    takeaways: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidence"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: 500 },
          evidence: { type: "string", minLength: 1, maxLength: 1000 },
        },
      },
    },
  },
} as const;
export class ProviderError extends Error {
  constructor(
    public code:
      | "provider_unavailable"
      | "provider_refused"
      | "provider_truncated"
      | "provider_invalid"
      | "invalid_evidence"
      | "ai_unconfigured",
  ) {
    super(code);
  }
}
export function parseSummary(value: unknown, source: string): SummaryResult {
  const parsed = summarySchema.safeParse(value);
  if (!parsed.success) throw new ProviderError("provider_invalid");
  if (parsed.data.takeaways.some((item) => !source.includes(item.evidence)))
    throw new ProviderError("invalid_evidence");
  return parsed.data;
}
export function summaryText(result: SummaryResult) {
  return result.kind === "insufficient_content"
    ? "Not enough substantive facts to summarize."
    : result.takeaways.map((item) => `• ${item.text}`).join("\n");
}
