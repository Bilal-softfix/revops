// Imported FIRST by main.ts: OpenTelemetry must patch http/express before anything loads them.
import { join } from 'node:path';
import { loadAppEnv } from '@revops/shared/env';
import { startTracing } from './platform/tracing/tracing';

loadAppEnv(join(__dirname, '..'));
startTracing('revops-api', process.env.OTEL_EXPORTER_OTLP_ENDPOINT || undefined);
