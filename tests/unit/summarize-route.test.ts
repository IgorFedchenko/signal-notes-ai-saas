import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { POST } from "@/app/api/summarize/route";
import { identity } from "@/lib/http";
import { adminClient } from "@/lib/supabase/admin";
import { summarize } from "@/lib/ai";
import { generationConfig } from "@/lib/ai/pricing";
vi.mock("@/lib/http", async (original) => ({
  ...(await original<typeof import("@/lib/http")>()),
  identity: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/ai", () => ({ summarize: vi.fn() }));
const user = randomUUID(),
  note = randomUUID(),
  requestId = randomUUID();
const rpc = vi.fn(),
  from = vi.fn();
const result = {
  kind: "summary" as const,
  takeaways: [
    {
      text: "Synthetic local test note.",
      evidence: "Synthetic local test note.",
    },
  ],
};
let traceId: string;
function row() {
  return {
    summary: "• Synthetic local test note.",
    result,
    provider: "extractive-local-v2",
    input_tokens: 31,
    output_tokens: 9,
    estimated_micro_usd: 0,
    latency_ms: 4,
    trace_id: traceId,
    config: generationConfig(),
    contract_version: "v2",
  };
}
function request(origin = "http://127.0.0.1:3210") {
  return new Request(`${origin}/api/summarize`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ noteId: note, requestId }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "http://127.0.0.1:3210");
  vi.stubEnv("AI_PROVIDER", "fixture");
  from.mockReturnValue({
    select: () => ({
      eq: () => ({
        single: async () => ({
          data: { content: "Synthetic local test note." },
          error: null,
        }),
      }),
    }),
  });
  vi.mocked(identity).mockResolvedValue({
    user: { id: user },
    db: { from },
  } as unknown as Awaited<ReturnType<typeof identity>>);
  vi.mocked(adminClient).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof adminClient
  >);
  rpc.mockImplementation(async (name, args) => {
    if (name === "reserve_generation_v2") {
      traceId = args.p_trace;
      return { data: { kind: "reserved" }, error: null };
    }
    if (name === "begin_generation_attempt_v2")
      return {
        data: {
          kind: "attempt",
          config: generationConfig(),
          period: "2026-10-01",
          reservedMicroUsd: 0,
          traceId,
          databaseNow: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 119000).toISOString(),
        },
        error: null,
      };
    if (name === "finish_generation_v2")
      return { data: { kind: "succeeded", generation: row() }, error: null };
    return { data: null, error: null };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("summarization HTTP boundary", () => {
  it("returns persisted duplicate output without another provider call", async () => {
    traceId = "a".repeat(32);
    rpc.mockResolvedValue({ data: { kind: "cached", generation: row() } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cached: true });
    expect(summarize).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("replays a persisted result when current live generation is disabled or the prompt changes", async () => {
    traceId = "a".repeat(32);
    const saved = { ...row(), config: { promptVersion: "notes-previous" } };
    vi.stubEnv("AI_PROVIDER", "unconfigured");
    rpc.mockResolvedValue({ data: { kind: "cached", generation: saved } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cached: true,
      promptVersion: "notes-previous",
    });
    expect(summarize).not.toHaveBeenCalled();
  });
  it("rejects exhausted quota and foreign ownership before the provider", async () => {
    rpc.mockResolvedValue({ data: { kind: "limit" } });
    expect((await POST(request())).status).toBe(429);
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: new Error("RLS hidden") }),
        }),
      }),
    });
    expect((await POST(request())).status).toBe(404);
    expect(summarize).not.toHaveBeenCalled();
  });
  it("releases count on upstream failure and sanitizes the error body", async () => {
    vi.mocked(summarize).mockRejectedValue(
      new Error("Synthetic provider payload must stay private"),
    );
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("provider payload");
    expect(rpc).toHaveBeenCalledWith("fail_generation_v2", {
      p_user: user,
      p_request: requestId,
    });
  });
  it("requires positive begin acknowledgement and makes zero calls on lost acknowledgement", async () => {
    const normal = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "begin_generation_attempt_v2"
        ? { data: null, error: new Error("ack lost") }
        : normal(name, args),
    );
    expect((await POST(request())).status).toBe(503);
    expect(summarize).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("fail_generation_v2", {
      p_user: user,
      p_request: requestId,
    });
  });
  it("makes zero calls when the database attempt fence denies an expired/replayed permit", async () => {
    const normal = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "begin_generation_attempt_v2"
        ? { data: { kind: "attempt_denied" }, error: null }
        : normal(name, args),
    );
    expect((await POST(request())).status).toBe(409);
    expect(summarize).not.toHaveBeenCalled();
  });
  it("makes zero calls if the positive acknowledgement arrives after its remaining DB TTL", async () => {
    let monotonic = 100;
    vi.spyOn(performance, "now").mockImplementation(() => monotonic);
    const normal = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) => {
      if (name !== "begin_generation_attempt_v2") return normal(name, args);
      monotonic = 5000;
      return {
        data: {
          kind: "attempt",
          config: generationConfig(),
          period: "2026-10-01",
          reservedMicroUsd: 0,
          traceId,
          databaseNow: "2026-10-16T00:00:00Z",
          expiresAt: "2026-10-16T00:00:01Z",
        },
        error: null,
      };
    });
    expect((await POST(request())).status).toBe(409);
    expect(summarize).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("fail_generation_v2", {
      p_user: user,
      p_request: requestId,
    });
  });
  it("passes the bound snapshot to the provider and persists usage before returning", async () => {
    vi.mocked(summarize).mockResolvedValue({
      text: "• Synthetic local test note.",
      result,
      provider: "extractive-local-v2",
      inputTokens: 31,
      outputTokens: 9,
      latencyMs: 4,
    });
    expect((await POST(request())).status).toBe(200);
    expect(summarize).toHaveBeenCalledWith(
      "Synthetic local test note.",
      generationConfig(),
      expect.any(Number),
    );
    expect(rpc).toHaveBeenCalledWith(
      "finish_generation_v2",
      expect.objectContaining({
        p_input: 31,
        p_output: 9,
        p_user: user,
        p_result: result,
      }),
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "fail_generation_v2",
      expect.anything(),
    );
  });
  it("rejects cross-origin calls before credentials", async () => {
    expect((await POST(request("https://untrusted.example"))).status).toBe(403);
    expect(identity).not.toHaveBeenCalled();
    expect(adminClient).not.toHaveBeenCalled();
  });
});
