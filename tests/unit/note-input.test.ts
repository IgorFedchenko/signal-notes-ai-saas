import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/notes/route";
import { identity, HttpError } from "@/lib/http";
vi.mock("@/lib/http", async (original) => ({
  ...(await original<typeof import("@/lib/http")>()),
  identity: vi.fn(),
}));
const insert = vi.fn();
const make = (body: unknown) =>
  new Request("http://127.0.0.1:3210/api/notes", {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:3210",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "http://127.0.0.1:3210");
  insert.mockImplementation((value) => ({
    select: () => ({
      single: async () => ({
        data: { id: "synthetic-note", ...value },
        error: null,
      }),
    }),
  }));
  vi.mocked(identity).mockResolvedValue({
    user: { id: "synthetic-owner" },
    db: { from: () => ({ insert }) },
  } as unknown as Awaited<ReturnType<typeof identity>>);
});
afterEach(() => vi.unstubAllEnvs());
it.each([19, 12001])(
  "T01 denies content boundary %i with zero writes",
  async (length) => {
    const response = await POST(
      make({ title: "Title", content: "x".repeat(length) }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_input" });
    expect(insert).not.toHaveBeenCalled();
  },
);
it.each([20, 12000])("T01 accepts exact content boundary %i", async (length) =>
  expect(
    (await POST(make({ title: "T", content: "x".repeat(length) }))).status,
  ).toBe(201),
);
it.each([0, 121])("T01 rejects title boundary %i", async (length) => {
  expect(
    (await POST(make({ title: "x".repeat(length), content: "x".repeat(20) })))
      .status,
  ).toBe(400);
  expect(insert).not.toHaveBeenCalled();
});
it.each([
  "model",
  "inputRate",
  "plan",
  "estimatedMicroUsd",
  "outputCap",
  "user_id",
])("T01 rejects client-owned %s override before write", async (key) => {
  expect(
    (await POST(make({ title: "T", content: "x".repeat(20), [key]: "forged" })))
      .status,
  ).toBe(400);
  expect(insert).not.toHaveBeenCalled();
});
it("T01 rejects expired session before note mutation", async () => {
  vi.mocked(identity).mockRejectedValue(
    new HttpError(401, "Please sign in.", "authentication_required"),
  );
  expect(
    (await POST(make({ title: "T", content: "x".repeat(20) }))).status,
  ).toBe(401);
  expect(insert).not.toHaveBeenCalled();
});
