import "server-only";
import { z } from "zod";
import { completionBody, PROMPT_HASH, PROMPT_VERSION } from "./prompt";
import { ProviderError, SCHEMA_VERSION } from "./schema";

// USD per million tokens equals micro-USD per token. Round each side up.
// Reference only: reverify support/rates and obtain owner approval before live use.
// Source: https://developers.openai.com/api/docs/models/gpt-5.4-mini (2026-10-16).
export const MODEL_PRICES = {
  "extractive-local-v2": {
    provider: "fixture",
    inputRate: 0,
    outputRate: 0,
    pricingVersion: "local-zero-v1",
  },
  "gpt-5.4-mini-2026-03-17": {
    provider: "openai",
    inputRate: 0.75,
    outputRate: 4.5,
    pricingVersion: "openai-2026-10-16",
  },
} as const;
export const boundConfigSchema = z
  .object({
    provider: z.enum(["fixture", "openai"]),
    model: z.string().min(1).max(100),
    inputRate: z.number().nonnegative().max(1000),
    outputRate: z.number().nonnegative().max(1000),
    pricingVersion: z.string().min(1).max(100),
    inputCap: z.number().int().min(1).max(65536),
    outputCap: z.number().int().min(1).max(2000),
    promptVersion: z.literal(PROMPT_VERSION),
    promptHash: z.literal(PROMPT_HASH),
    schemaVersion: z.literal(SCHEMA_VERSION),
  })
  .strict()
  .superRefine((value, context) => {
    const price = MODEL_PRICES[value.model as keyof typeof MODEL_PRICES];
    if (
      !price ||
      price.provider !== value.provider ||
      price.inputRate !== value.inputRate ||
      price.outputRate !== value.outputRate ||
      price.pricingVersion !== value.pricingVersion
    )
      context.addIssue({
        code: "custom",
        message: "Unknown model or pricing contract",
      });
  });
export type BoundConfig = z.infer<typeof boundConfigSchema>;
export function estimatedCost(
  input: number,
  output: number,
  config: Pick<BoundConfig, "inputRate" | "outputRate">,
) {
  return (
    Math.ceil(input * config.inputRate) + Math.ceil(output * config.outputRate)
  );
}
export function generationConfig(): BoundConfig {
  const provider = process.env.AI_PROVIDER;
  const model =
    provider === "fixture" ? "extractive-local-v2" : process.env.OPENAI_MODEL;
  const price = MODEL_PRICES[model as keyof typeof MODEL_PRICES];
  if (
    !price ||
    price.provider !== provider ||
    (provider === "openai" &&
      (!process.env.OPENAI_API_KEY || process.env.AI_LIVE_APPROVED !== "true"))
  )
    throw new ProviderError("ai_unconfigured");
  const parsed = boundConfigSchema.safeParse({
    ...price,
    model,
    inputCap: Number(process.env.AI_INPUT_BYTE_CAP ?? 65536),
    outputCap: Number(process.env.AI_OUTPUT_TOKEN_CAP ?? 800),
    promptVersion: PROMPT_VERSION,
    promptHash: PROMPT_HASH,
    schemaVersion: SCHEMA_VERSION,
  });
  if (!parsed.success) throw new ProviderError("ai_unconfigured");
  return parsed.data;
}
export function reservationCost(content: string, config: BoundConfig) {
  const bytes = Buffer.byteLength(
    JSON.stringify(completionBody(content, config.model, config.outputCap)),
    "utf8",
  );
  if (bytes > config.inputCap) throw new ProviderError("provider_invalid");
  // UTF-8 bytes of the entire serialized request plus conservative message framing.
  const upperInputTokens = bytes + 256;
  return estimatedCost(upperInputTokens, config.outputCap, config);
}
