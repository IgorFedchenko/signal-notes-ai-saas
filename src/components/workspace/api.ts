import { errorCode, type ErrorCode } from "@/lib/error-codes";
export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export async function call(path: string, body: unknown, method = "POST") {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(errorCode(data.code), data.error ?? "Please try again.");
  return data;
}
