export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { telemetry } = await import("./lib/observability/tracing");
    telemetry();
  }
}
