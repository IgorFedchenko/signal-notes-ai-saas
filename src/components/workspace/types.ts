import type { SummaryResult } from "@/lib/ai/schema";
export type Note = {
  id: string;
  title: string;
  content: string;
  created_at: string;
};
export type Generation = {
  request_id: string;
  note_id: string | null;
  summary: string | null;
  provider: string | null;
  status: string;
  period: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  expires_at: string;
  result: SummaryResult | null;
  estimated_micro_usd: number | null;
  exposure_micro_usd: number | null;
  cost_status: string;
  latency_ms: number | null;
  trace_id: string | null;
  config: { promptVersion: string } | null;
  contract_version: string;
};
export type SummaryAnswer = {
  noteId?: string;
  text: string | null;
  result: SummaryResult | null;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedMicroUsd: number | null;
  latencyMs: number | null;
  traceId: string | null;
  promptVersion: string;
};
export function dollars(microUsd: number) {
  return `$${(microUsd / 1_000_000).toFixed(6)}`;
}
