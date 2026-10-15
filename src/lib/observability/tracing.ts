import "server-only";
import {
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type Span,
  type Attributes,
} from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { exportFailureStatus } from "./export-status";
import { safeLog } from "./log";

let provider: NodeTracerProvider | undefined;
export function telemetry() {
  if (provider) return provider;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const processors = [];
  if (endpoint) {
    const url = new URL(endpoint);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid owner-controlled telemetry endpoint");
    // Do not enable SDK diagnostics or auto-instrument HTTP: both can leak payloads.
    const exporter = new OTLPTraceExporter({
      url: url.toString(),
      headers: { "x-project-name": "signal-notes" },
      timeoutMillis: 1000,
    });
    processors.push(
      new SimpleSpanProcessor({
        export: (spans, done) =>
          exporter.export(spans, (result) => {
            if (result.code !== 0)
              safeLog("telemetry_unavailable", {
                code: "export_failed",
                status: exportFailureStatus(result.error),
              });
            done({ code: 0 });
          }),
        shutdown: () => exporter.shutdown(),
      }),
    );
  }
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "signal-notes",
      "openinference.project.name": "signal-notes",
      "service.version": "0.2.0",
    }),
    spanProcessors: processors,
  });
  return provider;
}
export async function traced<T>(
  name: "generation" | "reserve" | "provider" | "persist",
  parent: Span | undefined,
  attributes: Attributes,
  action: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = telemetry().getTracer("signal-notes", "0.2.0");
  const span = tracer.startSpan(
    name,
    { attributes },
    parent ? trace.setSpan(ROOT_CONTEXT, parent) : ROOT_CONTEXT,
  );
  try {
    const result = await action(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    // Error messages/stack/cause are deliberately never recorded as span events.
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}
export async function flushTelemetry() {
  await provider
    ?.forceFlush()
    .catch(() => safeLog("telemetry_unavailable", { code: "flush_failed" }));
}
