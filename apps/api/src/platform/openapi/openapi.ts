import type { INestApplication } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { DiscoveryService } from '@nestjs/core';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodBodyPipe } from '../validation/zod-body.pipe';

// OpenAPI from the SAME Zod schemas that validate requests (packages/shared). Nest's scan gives the
// paths; we fill request bodies/query/path params from each route's ZodBodyPipe and responses
// from @ZodResponse. No hand-written DTO classes, so the spec can't drift from validation.

type JsonSchema = Record<string, unknown>;
type Operation = {
  operationId?: string;
  parameters?: { name: string; in: string; required?: boolean; schema?: unknown }[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
};

const ZOD_RESPONSES = Symbol('revops:zod-responses');
/** Nest stores route args under `${RouteParamtypes}:${index}`. */
const BODY: number = RouteParamtypes.BODY;
const QUERY: number = RouteParamtypes.QUERY;
const PARAM: number = RouteParamtypes.PARAM;

interface ZodResponseMeta {
  status: number;
  schema: z.ZodType;
  description: string;
}

/** Documents a JSON response body of this route with a Zod schema from packages/shared. */
export function ZodResponse(
  status: number,
  schema: z.ZodType,
  description = 'OK',
): MethodDecorator {
  return (target, key) => {
    const list = (Reflect.getMetadata(ZOD_RESPONSES, target, key) as ZodResponseMeta[]) ?? [];
    Reflect.defineMetadata(ZOD_RESPONSES, [...list, { status, schema, description }], target, key);
  };
}

export function toOpenApiSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const json: JsonSchema = z.toJSONSchema(schema, {
    io,
    target: 'openapi-3.0',
    unrepresentable: 'any',
  });
  delete json.$schema;
  return json;
}

const PROBLEM_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'RFC 7807 problem details; `code` is stable and machine-readable.',
  required: ['type', 'title', 'status', 'code'],
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    code: { type: 'string' },
    detail: { type: 'string' },
  },
  additionalProperties: true,
};

function operations(doc: OpenAPIObject): Operation[] {
  return Object.values(doc.paths).flatMap((item) =>
    Object.values(item as Record<string, unknown>).filter(
      (op): op is Operation => typeof op === 'object' && op !== null && 'responses' in op,
    ),
  );
}

function enrichFromRoutes(doc: OpenAPIObject, discovery: DiscoveryService): void {
  const byId = new Map(operations(doc).map((op) => [op.operationId, op]));
  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null;
    if (!controller) continue;
    const proto = controller.prototype as object;
    for (const method of Object.getOwnPropertyNames(proto)) {
      const op = byId.get(`${controller.name}_${method}`);
      if (!op || method === 'constructor') continue;
      const args =
        (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as
          Record<string, { data?: unknown; pipes?: unknown[] }> | undefined) ?? {};
      for (const [key, arg] of Object.entries(args)) {
        const type = Number(key.split(':')[0]);
        const pipe = arg.pipes?.find((p): p is ZodBodyPipe<z.ZodType> => p instanceof ZodBodyPipe);
        if (!pipe) continue;
        if (type === BODY) {
          op.requestBody = {
            required: true,
            content: { 'application/json': { schema: toOpenApiSchema(pipe.schema, 'input') } },
          };
        } else if (type === QUERY && pipe.schema instanceof z.ZodObject) {
          const json = toOpenApiSchema(pipe.schema, 'input');
          const props = (json.properties ?? {}) as Record<string, unknown>;
          const required = new Set((json.required as string[] | undefined) ?? []);
          op.parameters = [
            ...(op.parameters ?? []).filter((p) => p.in !== 'query'),
            ...Object.entries(props).map(([name, schema]) => ({
              name,
              in: 'query',
              required: required.has(name),
              schema,
            })),
          ];
        } else if (type === PARAM && typeof arg.data === 'string') {
          const param = op.parameters?.find((p) => p.in === 'path' && p.name === arg.data);
          if (param) param.schema = toOpenApiSchema(pipe.schema, 'input');
        }
      }
      const responses =
        (Reflect.getMetadata(ZOD_RESPONSES, proto, method) as ZodResponseMeta[] | undefined) ?? [];
      for (const r of responses) {
        op.responses[String(r.status)] = {
          description: r.description,
          content: { 'application/json': { schema: toOpenApiSchema(r.schema, 'output') } },
        };
      }
      op.responses.default = {
        description: 'Error (application/problem+json)',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
        },
      };
    }
  }
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('RevOps API')
    .setDescription('REST API v1. Errors are application/problem+json (RFC 7807).')
    .setVersion('v1')
    .addCookieAuth('__Host-sid', { type: 'apiKey', in: 'cookie' }, 'session')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-csrf-token' }, 'csrf')
    .build();
  const doc = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controller, method) => `${controller}_${method}`,
  });
  doc.components = {
    ...doc.components,
    schemas: { ...doc.components?.schemas, Problem: PROBLEM_SCHEMA },
  };
  enrichFromRoutes(doc, app.get(DiscoveryService));
  return doc;
}

/** Swagger UI at /docs and the JSON at /docs/openapi.json — never in production. */
export function setupOpenApi(app: INestApplication, nodeEnv: string): void {
  if (nodeEnv === 'production') return;
  SwaggerModule.setup('docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs/openapi.json',
    yamlDocumentUrl: 'docs/openapi.yaml',
  });
}
