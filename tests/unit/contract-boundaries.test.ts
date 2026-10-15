import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSummary, summarySchema } from "@/lib/ai/schema";
import { summarize } from "@/lib/ai/provider";
import {
  boundConfigSchema,
  estimatedCost,
  generationConfig,
  reservationCost,
} from "@/lib/ai/pricing";
import { completionBody } from "@/lib/ai/prompt";
import { failure, readJson, readText } from "@/lib/http";

const source =
  "Mira owns café onboarding. Launch  is Friday. <b>Literal text</b>.";
const item = { text: "Launch is Friday.", evidence: "Launch  is Friday." };
const valid = { kind: "summary", takeaways: [item] };
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function contract() {
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("AI_LIVE_APPROVED", "true");
  vi.stubEnv("OPENAI_MODEL", "gpt-5.4-mini-2026-03-17");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-transport-double-only");
  return generationConfig();
}
function envelope(content: unknown = valid) {
  return {
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(content) } },
    ],
    usage: { prompt_tokens: 42, completion_tokens: 8 },
  };
}
describe("T04 strict original-source contract", () => {
  it("accepts exactly one/three pairs, maximum fields and empty insufficient result", () => {
    for (const takeaways of [[item], [item, item, item]])
      expect(
        parseSummary({ kind: "summary", takeaways }, source).takeaways,
      ).toHaveLength(takeaways.length);
    expect(
      parseSummary({ kind: "insufficient_content", takeaways: [] }, source)
        .kind,
    ).toBe("insufficient_content");
    expect(
      parseSummary(
        {
          kind: "summary",
          takeaways: [{ text: "a".repeat(500), evidence: "e".repeat(1000) }],
        },
        "e".repeat(1000),
      ),
    ).toBeTruthy();
    expect(
      parseSummary(
        {
          kind: "summary",
          takeaways: [
            {
              text: "<script>literal</script>",
              evidence: "<b>Literal text</b>",
            },
          ],
        },
        source,
      ),
    ).toBeTruthy();
  });
  it.each([
    [],
    "text",
    null,
    {},
    { ...valid, extra: true },
    { kind: "unknown", takeaways: [] },
    { kind: "summary", takeaways: [] },
    { kind: "summary", takeaways: [item, item, item, item] },
    { kind: "insufficient_content", takeaways: [item] },
    { kind: "summary", takeaways: [{ ...item, tool: "execute" }] },
    { kind: "summary", takeaways: [{ text: "", evidence: item.evidence }] },
    {
      kind: "summary",
      takeaways: [{ text: "x".repeat(501), evidence: item.evidence }],
    },
    { kind: "summary", takeaways: [{ text: "a", evidence: "" }] },
    { kind: "summary", takeaways: [{ text: "a", evidence: "x".repeat(1001) }] },
    { kind: "summary", takeaways: [{ text: 1, evidence: item.evidence }] },
    { kind: "summary", takeaways: [{ text: "missing evidence" }] },
  ])("rejects malformed strict object %#", (value) =>
    expect(() => parseSummary(value, source)).toThrow("provider_invalid"),
  );
  it.each([
    "Launch is Friday.",
    "launch  is Friday.",
    "Mira owns cafe\u0301 onboarding.",
    "Another note.",
    "Launch  is Friday!",
    "<system>invented</system>",
  ])("rejects non-original evidence %s", (evidence) =>
    expect(() =>
      parseSummary({ ...valid, takeaways: [{ ...item, evidence }] }, source),
    ).toThrow("invalid_evidence"),
  );
  it("does not normalize the original Unicode for validation", () =>
    expect(summarySchema.safeParse(valid).success).toBe(true));
});
describe("T05 nonzero conservative monetary contract", () => {
  it("reserves full serialized UTF-8 request plus framing and output maximum", () => {
    const config = contract(),
      note = 'Mira owns café 🚀. "Escaping"\\\n'.repeat(30);
    const bytes = Buffer.byteLength(
      JSON.stringify(completionBody(note, config.model, config.outputCap)),
      "utf8",
    );
    expect(bytes).toBeGreaterThan(note.length);
    expect(reservationCost(note, config)).toBe(
      estimatedCost(bytes + 256, config.outputCap, config),
    );
    expect(estimatedCost(1, 1, config)).toBe(6);
    expect(
      Array.from({ length: 1000 }, () => estimatedCost(1, 1, config)).reduce(
        (a, b) => a + b,
        0,
      ),
    ).toBe(6000);
    expect(() =>
      reservationCost(note, { ...config, inputCap: bytes - 1 }),
    ).toThrow("provider_invalid");
    expect(
      reservationCost(note, { ...config, inputCap: bytes }),
    ).toBeGreaterThan(0);
  });
  it.each([
    { inputCap: 0 },
    { inputCap: 65537 },
    { outputCap: 0 },
    { outputCap: 2001 },
    { inputRate: -1 },
    { inputRate: 0 },
    { outputRate: NaN },
    { model: "unknown" },
    { pricingVersion: "undated" },
    { provider: "fixture" },
  ])("rejects unknown or mismatched snapshot %#", (delta) =>
    expect(
      boundConfigSchema.safeParse({ ...contract(), ...delta }).success,
    ).toBe(false),
  );
});
describe("T06 provider CONTRACT transport doubles; zero actual network", () => {
  it("separates trusted and untrusted messages, strict schema, output limit, no tools and one request", async () => {
    const config = contract(),
      fetch = vi.fn().mockResolvedValue(Response.json(envelope()));
    vi.stubGlobal("fetch", fetch);
    await expect(summarize(source, config)).resolves.toMatchObject({
      inputTokens: 42,
      outputTokens: 8,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages.at(-1)).toMatchObject({ role: "user" });
    expect(body.messages.at(-1).content).toContain(source);
    expect(body.messages[0].content).not.toContain(source);
    expect(body.tools).toBeUndefined();
    expect(body.response_format.json_schema.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["kind", "takeaways"],
    });
    expect(JSON.stringify(body.response_format)).not.toContain('"if"');
    expect(body.max_completion_tokens).toBe(config.outputCap);
  });
  it.each([
    [
      "refusal",
      {
        choices: [
          {
            finish_reason: "stop",
            message: { refusal: "synthetic-private-canary" },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      "provider_refused",
    ],
    [
      "filter",
      {
        choices: [
          { finish_reason: "content_filter", message: { content: null } },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      "provider_refused",
    ],
    [
      "truncated",
      {
        choices: [{ finish_reason: "length", message: { content: "{}" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      "provider_truncated",
    ],
    ["missing usage", { choices: envelope().choices }, "provider_invalid"],
    [
      "negative usage",
      { ...envelope(), usage: { prompt_tokens: -1, completion_tokens: 1 } },
      "provider_invalid",
    ],
    [
      "fraction usage",
      { ...envelope(), usage: { prompt_tokens: 1.5, completion_tokens: 1 } },
      "provider_invalid",
    ],
    [
      "output cap",
      { ...envelope(), usage: { prompt_tokens: 1, completion_tokens: 801 } },
      "provider_invalid",
    ],
    [
      "input cap",
      { ...envelope(), usage: { prompt_tokens: 65793, completion_tokens: 1 } },
      "provider_invalid",
    ],
    [
      "two choices",
      {
        ...envelope(),
        choices: [...envelope().choices, ...envelope().choices],
      },
      "provider_invalid",
    ],
    [
      "bad finish",
      {
        ...envelope(),
        choices: [{ finish_reason: "tool_calls", message: { content: "{}" } }],
      },
      "provider_invalid",
    ],
    ["schema", envelope({ ...valid, extra: true }), "provider_invalid"],
    [
      "evidence",
      envelope({ ...valid, takeaways: [{ text: "x", evidence: "invented" }] }),
      "invalid_evidence",
    ],
  ])("rejects %s without retry", async (_name, value, code) => {
    const config = contract(),
      fetch = vi.fn().mockResolvedValue(Response.json(value));
    vi.stubGlobal("fetch", fetch);
    await expect(summarize(source, config)).rejects.toThrow(code as string);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([400, 429, 500, 503])("does not retry HTTP %i", async (status) => {
    const config = contract(),
      fetch = vi
        .fn()
        .mockResolvedValue(
          new Response("poisoned response private", { status }),
        );
    vi.stubGlobal("fetch", fetch);
    await expect(summarize(source, config)).rejects.toThrow(
      "provider_unavailable",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["disconnect", "timeout"])(
    "sanitizes %s and obeys 25-second cap",
    async () => {
      const config = contract();
      const timeout = vi.spyOn(AbortSignal, "timeout");
      const fetch = vi
        .fn()
        .mockRejectedValue(
          new Error("PRIVATE_CANARY", { cause: { secret: "PRIVATE_CANARY" } }),
        );
      vi.stubGlobal("fetch", fetch);
      await expect(summarize(source, config)).rejects.toThrow(
        "provider_unavailable",
      );
      expect(timeout).toHaveBeenCalledWith(25000);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects malformed and over-limit response allocation", async () => {
    const config = contract(),
      fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const text of ["{", "x".repeat(65537)]) {
      fetch.mockResolvedValue(new Response(text));
      await expect(summarize(source, config)).rejects.toThrow(
        "provider_invalid",
      );
    }
  });
  it("cannot use an expired permit or dummy key without approved configuration", async () => {
    const config = contract(),
      fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      summarize(source, config, performance.now() - 1),
    ).rejects.toThrow("provider_unavailable");
    vi.stubEnv("AI_LIVE_APPROVED", "false");
    await expect(summarize(source, config)).rejects.toThrow("ai_unconfigured");
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe("T01 bounded JSON and safe internal errors", () => {
  it.each([
    ["text/plain", "{}", 415],
    ["application/json", "{", 400],
    ["application/json", "x".repeat(65537), 413],
  ])("rejects %s malformed or oversized body", async (type, body, status) => {
    try {
      await readJson(
        new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": type as string },
          body: body as string,
        }),
      );
      throw Error("expected rejection");
    } catch (error) {
      expect(failure(error).status).toBe(status);
    }
  });
  it("enforces exact streamed byte boundary", async () => {
    expect(
      (
        await readText(
          new Request("http://localhost", {
            method: "POST",
            body: "x".repeat(65536),
          }),
        )
      ).length,
    ).toBe(65536);
  });
  it("never exposes poisoned Error message, stack or cause", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {}),
      canary = "POISON_ERROR_PRIVATE_CANARY";
    const body = await failure(
      new Error(canary, {
        cause: { request: { body: canary, authorization: canary } },
      }),
    ).text();
    expect(JSON.stringify([body, log.mock.calls])).not.toContain(canary);
  });
});
