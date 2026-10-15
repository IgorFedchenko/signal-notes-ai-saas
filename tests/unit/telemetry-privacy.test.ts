import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
const collected = vi.hoisted(() => ({ spans: [] as unknown[], fail: false }));
vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: class {
    export(
      spans: ReadableSpan[],
      done: (r: { code: number; error?: Error }) => void,
    ) {
      collected.spans.push(
        ...spans.map((s) => ({
          name: s.name,
          attributes: s.attributes,
          status: s.status,
          events: s.events,
          links: s.links,
          resource: s.resource.attributes,
        })),
      );
      done(
        collected.fail
          ? {
              code: 1,
              error: new Error("PRIVATE_SDK_ERROR_CANARY", {
                cause: { secret: "PRIVATE_SDK_ERROR_CANARY" },
              }),
            }
          : { code: 0 },
      );
    }
    async shutdown() {}
  },
}));
import { traced, flushTelemetry } from "@/lib/observability/tracing";
import { failure, HttpError } from "@/lib/http";
import { ProviderError } from "@/lib/ai/schema";
import { safeLog, type SafeFields } from "@/lib/observability/log";
const canaries = [
  "PRIVATE_NOTE_CANARY",
  "PRIVATE_EVIDENCE_CANARY",
  "PRIVATE_PROMPT_CANARY",
  "PRIVATE_RESPONSE_CANARY",
  "private-email@signal.local",
  "PRIVATE_COOKIE_CANARY",
  "PRIVATE_AUTH_CANARY",
  "PRIVATE_API_KEY_CANARY",
  "PRIVATE_SERVICE_KEY_CANARY",
  "PRIVATE_DSN_PASSWORD_CANARY",
  "PRIVATE_SDK_ERROR_CANARY",
];
const logs: unknown[] = [];
beforeAll(() => {
  vi.stubEnv(
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "http://127.0.0.1:59999/v1/traces",
  );
  for (const method of ["log", "error", "warn", "debug"] as const)
    vi.spyOn(console, method).mockImplementation((...args) => {
      logs.push(args);
    });
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("T21 captures real SDK spans and stdout/diagnostics across poisoned failure classes without private payloads", async () => {
  for (const kind of [
    "success",
    "input",
    "auth",
    "refusal",
    "timeout",
    "malformed",
    "ack-loss",
    "database",
    "exporter",
  ]) {
    collected.fail = kind === "exporter";
    const poison = Object.assign(
      new Error(canaries.join("|"), {
        cause: {
          headers: { authorization: canaries[6], cookie: canaries[5] },
          url: `http://localhost/?secret=${canaries[7]}`,
          body: canaries,
        },
      }),
      { request: { note: canaries[0] } },
    );
    let reply: Response | undefined;
    try {
      await traced(
        "generation",
        undefined,
        {
          "request.id": "synthetic-request-id",
          model: "extractive-local-v2",
          "prompt.version": "notes-v2",
        },
        async (root) => {
          await traced("reserve", root, {}, async () => {
            if (kind === "ack-loss" || kind === "database") throw poison;
          });
          await traced("provider", root, {}, async () => {
            if (["refusal", "timeout", "malformed"].includes(kind))
              throw Object.assign(
                new ProviderError(
                  kind === "refusal"
                    ? "provider_refused"
                    : kind === "timeout"
                      ? "provider_unavailable"
                      : "provider_invalid",
                ),
                { cause: poison },
              );
            if (kind === "auth")
              throw new HttpError(
                401,
                "Please sign in.",
                "authentication_required",
              );
            if (kind === "input") throw poison;
          });
          await traced("persist", root, {}, async () => {});
          safeLog("generation_completed", {
            requestId: "synthetic-request-id",
            model: "extractive-local-v2",
            inputTokens: 0,
            outputTokens: 0,
          });
        },
      );
    } catch (error) {
      reply = failure(error);
    }
    if (reply) expect(await reply.text()).not.toMatch(/PRIVATE_|private-email/);
    safeLog("request_failed", {
      code: "safe_code",
      error: poison,
      request: { headers: { cookie: canaries[5] }, body: canaries },
      note: canaries[0],
    } as unknown as SafeFields);
    await flushTelemetry();
  }
  expect(collected.spans.length).toBeGreaterThan(20);
  const serialized = JSON.stringify({ spans: collected.spans, logs });
  for (const canary of canaries) expect(serialized).not.toContain(canary);
  for (const args of logs) {
    const record = JSON.parse((args as string[])[0]);
    expect([
      "generation_completed",
      "request_failed",
      "telemetry_unavailable",
    ]).toContain(record.event);
    expect(
      Object.keys(record).every((key) =>
        [
          "event",
          "requestId",
          "model",
          "inputTokens",
          "outputTokens",
          "code",
          "status",
        ].includes(key),
      ),
    ).toBe(true);
  }
  expect(serialized).toContain("export_failed");
  expect(serialized).toContain('"code":2');
});
