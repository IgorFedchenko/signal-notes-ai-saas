import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { POST } from "@/app/api/summarize/route";
import { identity } from "@/lib/http";
import { adminClient } from "@/lib/supabase/admin";
import { summarize } from "@/lib/ai";
vi.mock("@/lib/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http")>()),
  identity: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/ai", () => ({ summarize: vi.fn() }));
const user = randomUUID();
const note = randomUUID();
const requestId = randomUUID();
const rpc = vi.fn();
const from = vi.fn();
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
});
afterEach(() => vi.unstubAllEnvs());
describe("summarization HTTP boundary", () => {
  it("returns persisted output for duplicate requests without another model call", async () => {
    rpc.mockResolvedValue({
      data: { kind: "cached", summary: "Saved summary", provider: "fixture" },
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cached: true });
    expect(summarize).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("fails before contacting the model when quota is exhausted or ownership fails", async () => {
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
  it("releases quota on upstream failure and sanitizes the error body", async () => {
    rpc.mockResolvedValue({ data: { kind: "reserved" } });
    vi.mocked(summarize).mockRejectedValue(
      new Error("Synthetic provider payload must stay private"),
    );
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("provider payload");
    expect(rpc).toHaveBeenCalledWith("fail_generation", {
      p_user: user,
      p_request: requestId,
    });
  });
  it("persists actual tokens before returning a successful summary", async () => {
    rpc.mockImplementation(async (name) => ({
      data: name === "reserve_generation" ? { kind: "reserved" } : true,
      error: null,
    }));
    vi.mocked(summarize).mockResolvedValue({
      text: "• Synthetic result",
      provider: "test-model",
      inputTokens: 31,
      outputTokens: 9,
    });
    expect((await POST(request())).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "finish_generation",
      expect.objectContaining({ p_input: 31, p_output: 9, p_user: user }),
    );
    expect(rpc).not.toHaveBeenCalledWith("fail_generation", expect.anything());
  });
  it("rejects cross-origin requests before reading credentials or data", async () => {
    expect((await POST(request("https://untrusted.example"))).status).toBe(403);
    expect(identity).not.toHaveBeenCalled();
    expect(adminClient).not.toHaveBeenCalled();
  });
});
