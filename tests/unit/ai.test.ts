import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureSummary, summarize } from "@/lib/ai";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("summary providers", () => {
  it("runs the extractive demo without a network call or invented token usage", async () => {
    vi.stubEnv("AI_PROVIDER", "fixture");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const content =
      "Launch is Friday. Maya owns onboarding. Theo owns QA. Another detail.";
    const result = await summarize(content);
    expect(result.text).toBe(
      "• Launch is Friday.\n• Maya owns onboarding.\n• Theo owns QA.",
    );
    expect(result.inputTokens + result.outputTokens).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(fixtureSummary(content)).toEqual(result);
  });
  it("records provider-reported tokens and bounds output", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "owner-approved-test-double");
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: "• Launch Friday." } }],
        usage: { prompt_tokens: 42, completion_tokens: 8 },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await summarize("Public synthetic note")).toMatchObject({
      inputTokens: 42,
      outputTokens: 8,
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      max_completion_tokens: 400,
    });
  });
  it("rejects unconfigured providers before contacting the network", async () => {
    vi.stubEnv("AI_PROVIDER", "unexpected");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(summarize("Synthetic note")).rejects.toThrow("not configured");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not retry a failed provider and rejects malformed usage", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-double");
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("unavailable", { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    await expect(summarize("Synthetic note")).rejects.toThrow("unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(
      Response.json({ choices: [{ message: { content: "Text" } }] }),
    );
    await expect(summarize("Synthetic note")).rejects.toThrow();
  });
});
