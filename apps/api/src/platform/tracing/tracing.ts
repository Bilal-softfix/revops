import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | undefined;

/** Probe and scrape endpoints aren't worth a span each. */
const UNTRACED = /^\/(health|ready|metrics)(\?|$)/;

/**
 * Starts OpenTelemetry tracing when OTEL_EXPORTER_OTLP_ENDPOINT is set (OTLP over HTTP, e.g. a
 * local collector or a vendor endpoint). Unset — the local default — means no SDK at all: no
 * exporter, no overhead, and log lines simply carry no trace ids. Must run before `http` and
 * `express` are first required, hence the instrument-*.ts entry modules.
 */
export function startTracing(serviceName: string, endpoint: string | undefined): boolean {
  if (!endpoint || sdk) return Boolean(sdk);
  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/+$/, '')}/v1/traces` }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => UNTRACED.test(req.url ?? ''),
      }),
      new ExpressInstrumentation(),
    ],
  });
  sdk.start();
  return true;
}

/** Flushes pending spans; called from the app's shutdown hook. */
export async function shutdownTracing(): Promise<void> {
  const current = sdk;
  sdk = undefined;
  await current?.shutdown();
}
