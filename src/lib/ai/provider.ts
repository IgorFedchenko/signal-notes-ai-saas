import "server-only";
import { z } from "zod";
import { completionBody } from "./prompt";
import { generationConfig, reservationCost, type BoundConfig } from "./pricing";
import {
  parseSummary,
  ProviderError,
  summaryText,
  type SummaryResult,
} from "./schema";
export type Summary = {
  result: SummaryResult;
  text: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

// Preserve original substrings: normalization must never rewrite evidence quotes.
export function fixtureSummary(content: string): Summary {
  const sentences = content.match(/[^.!?]+(?:[.!?]+|$)/gu) ?? [];
  const instructions =
    /(?:ignore (?:all |the |previous |prior )*(?:instructions|rules)|system(?: prompt| message)?|developer message|you are (?:an? |the )|(?:reveal|print|send|output|return|say|execute|visit) (?:only |the |all |your |this |a )|summarize this|act as|assistant[: ]|<\/?(?:system|script))/iu;
  const facts = sentences
    .map((s) => s.trim())
    .filter((s) => {
      const words = s.match(/\p{L}{2,}/gu) ?? [];
      return (
        words.length >= 3 &&
        words.some((w) => /[aeiouyаеёиоуыэюя]/iu.test(w)) &&
        !instructions.test(s)
      );
    })
    .slice(0, 3);
  const result = parseSummary(
    {
      kind: facts.length ? "summary" : "insufficient_content",
      takeaways: facts.map((s) => ({
        text: s.slice(0, 500),
        evidence: s.slice(0, 1000),
      })),
    },
    content,
  );
  return {
    result,
    text: summaryText(result),
    provider: "extractive-local-v2",
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
  };
}
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z.object({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1)
    .max(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
  }),
});
export async function summarize(
  content: string,
  config: BoundConfig = generationConfig(),
): Promise<Summary> {
  reservationCost(content, config);
  const started = performance.now();
  if (config.provider === "fixture")
    return {
      ...fixtureSummary(content),
      latencyMs: Math.round(performance.now() - started),
    };
  if (!process.env.OPENAI_API_KEY || process.env.AI_LIVE_APPROVED !== "true")
    throw new ProviderError("ai_unconfigured");
  let data: z.infer<typeof responseSchema>;
  try {
    // One request, no automatic retries. Timeout may still incur provider cost.
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(25000),
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        completionBody(content, config.model, config.outputCap),
      ),
    });
    if (!response.ok) throw new ProviderError("provider_unavailable");
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new ProviderError("provider_invalid");
    data = parsed.data;
  } catch (error) {
    throw error instanceof ProviderError
      ? error
      : new ProviderError("provider_unavailable");
  }
  const choice = data.choices[0];
  if (choice.message.refusal) throw new ProviderError("provider_refused");
  if (choice.finish_reason === "length")
    throw new ProviderError("provider_truncated");
  if (
    choice.finish_reason !== "stop" ||
    !choice.message.content ||
    data.usage.completion_tokens > config.outputCap ||
    data.usage.prompt_tokens > config.inputCap + 256
  )
    throw new ProviderError("provider_invalid");
  let value: unknown;
  try {
    value = JSON.parse(choice.message.content);
  } catch {
    throw new ProviderError("provider_invalid");
  }
  const result = parseSummary(value, content);
  return {
    result,
    text: summaryText(result),
    provider: config.model,
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
    latencyMs: Math.round(performance.now() - started),
  };
}
