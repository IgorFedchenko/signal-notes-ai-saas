import { afterEach, expect, it, vi } from "vitest";
import {
  createNote,
  generateSummary,
  openBilling,
  signOut,
  deleteNote,
} from "@/components/workspace/api";
afterEach(() => vi.unstubAllGlobals());
function reply(data: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json(data, { status })),
  );
}
it("validates consumed fields for each workspace endpoint", async () => {
  reply({ note: { id: "invalid" } });
  await expect(
    createNote({ title: "Synthetic", content: "Synthetic note content." }),
  ).rejects.toThrow("Unexpected server response");
  reply({
    summary: null,
    result: { kind: "insufficient_content", takeaways: [] },
    provider: "fixture",
    inputTokens: 0,
    outputTokens: 0,
    estimatedMicroUsd: 0,
    latencyMs: 1,
    traceId: null,
    promptVersion: "notes-v2",
    cached: false,
  });
  expect(
    (await generateSummary({ noteId: "synthetic", requestId: "synthetic" }))
      .result?.kind,
  ).toBe("insufficient_content");
  reply({ url: "javascript:alert(1)" });
  await expect(openBilling("checkout")).rejects.toThrow(
    "Unexpected server response",
  );
  reply({ url: "https://checkout.stripe.com/synthetic" });
  expect((await openBilling("portal")).url).toMatch(/^https:/);
  reply({ ok: true });
  await expect(signOut()).resolves.toEqual({ ok: true });
  reply({ deleted: true });
  await expect(deleteNote("synthetic")).resolves.toEqual({ deleted: true });
});
it("retains stable failure codes and handles malformed error replies", async () => {
  reply({ code: "pending", error: "Still processing" }, 409);
  await expect(
    generateSummary({ noteId: "synthetic", requestId: "synthetic" }),
  ).rejects.toMatchObject({ code: "pending", message: "Still processing" });
  reply(null, 503);
  await expect(signOut()).rejects.toMatchObject({
    code: "temporarily_unavailable",
  });
});
