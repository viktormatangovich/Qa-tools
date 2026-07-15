import type { ApiRequest } from "../types";

/**
 * Генерация OpenAPI 3.0 спецификации из запросов
 */
export function generateOpenApiSpec(requests: ApiRequest[]): string {
  const paths: Record<string, Record<string, unknown>> = {};

  requests.forEach((req) => {
    try {
      const url = new URL(req.url);
      const pathname = url.pathname || "/";
      const method = req.method.toLowerCase();

      if (!paths[pathname]) paths[pathname] = {};

      const responseBody = req.responseBody
        ? inferSchema(req.responseBody)
        : { type: "object", properties: {} };

      const requestBody = req.requestBody
        ? {
            content: {
              "application/json": {
                schema: inferSchema(req.requestBody),
              },
            },
          }
        : undefined;

      (paths[pathname] as Record<string, unknown>)[method] = {
        summary: `${req.method} ${pathname}`,
        operationId: `${method}_${pathname.replace(/[^a-zA-Z0-9]/g, "_")}`,
        parameters: Array.from(url.searchParams.entries()).map(
          ([key, value]) => ({
            name: key,
            in: "query",
            schema: { type: typeof value },
            example: value,
          }),
        ),
        requestBody,
        responses: {
          [req.status || 200]: {
            description: `${req.status} ${req.statusText || ""}`,
            content: {
              "application/json": {
                schema: responseBody,
              },
            },
          },
        },
      };
    } catch {
      // skip invalid URLs
    }
  });

  const spec = {
    openapi: "3.0.3",
    info: {
      title: "QA Tools API Export",
      version: new Date().toISOString().slice(0, 10),
      description: `Exported ${requests.length} requests from QA Tools`,
    },
    paths,
  };

  return JSON.stringify(spec, null, 2);
}

/**
 * Генерация JSON Schema из ответа
 */
export function generateJsonSchema(data: unknown): string {
  const schema = inferSchema(data);
  const fullSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    ...(schema.type === "object" ? schema : { properties: { root: schema } }),
  };
  return JSON.stringify(fullSchema, null, 2);
}

function inferSchema(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { type: "null" };

  if (Array.isArray(value)) {
    if (value.length === 0) return { type: "array", items: {} };
    const itemSchemas = value.map((v) => inferSchema(v));
    // Merge item schemas
    const merged = mergeSchemas(itemSchemas);
    return { type: "array", items: merged };
  }

  const jsType = typeof value;
  if (jsType === "string") {
    // Try to detect format
    if (/^\d{4}-\d{2}-\d{2}T/.test(value as string))
      return { type: "string", format: "date-time" };
    if (/^\d{4}-\d{2}-\d{2}$/.test(value as string))
      return { type: "string", format: "date" };
    if (/^https?:\/\//.test(value as string))
      return { type: "string", format: "uri" };
    if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(value as string))
      return { type: "string", format: "email" };
    return { type: "string" };
  }
  if (jsType === "number") return { type: "number" };
  if (jsType === "boolean") return { type: "boolean" };

  if (jsType === "object") {
    const obj = value as Record<string, unknown>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    Object.entries(obj).forEach(([key, val]) => {
      properties[key] = inferSchema(val);
      if (val !== null && val !== undefined) required.push(key);
    });

    const result: Record<string, unknown> = {
      type: "object",
      properties,
    };
    if (required.length > 0) result.required = required;
    return result;
  }

  return { type: "string" };
}

function mergeSchemas(
  schemas: Record<string, unknown>[],
): Record<string, unknown> {
  if (schemas.length === 0) return {};
  if (schemas.length === 1) return schemas[0];

  // Simple merge: take the first non-null type
  const nonNull = schemas.filter((s) => s.type !== "null");
  if (nonNull.length === 0) return { type: "null" };

  const types = [...new Set(nonNull.map((s) => s.type as string))];
  if (types.length === 1) return nonNull[0];

  return { oneOf: nonNull };
}

/**
 * Генерация CSV из запросов
 */
export function generateCsv(requests: ApiRequest[]): string {
  const headers = [
    "Timestamp",
    "Method",
    "URL",
    "Status",
    "Duration (ms)",
    "Type",
    "Error",
    "Page URL",
    "Request Size (bytes)",
    "Response Size (bytes)",
  ];

  const rows = requests.map((req) => {
    const reqSize = req.requestBody
      ? new Blob([
          typeof req.requestBody === "string"
            ? req.requestBody
            : JSON.stringify(req.requestBody),
        ]).size
      : 0;
    const resSize = req.responseBody
      ? new Blob([
          typeof req.responseBody === "string"
            ? req.responseBody
            : JSON.stringify(req.responseBody),
        ]).size
      : 0;

    return [
      new Date(req.timestamp).toISOString(),
      req.method,
      escapeCsvField(req.url),
      req.status || "",
      req.duration,
      req.type,
      escapeCsvField(req.error || ""),
      escapeCsvField(req.pageUrl || ""),
      reqSize,
      resSize,
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Генерация коллекции cURL команд
 */
export function generateBulkCurl(requests: ApiRequest[]): string {
  return requests
    .map((req) => {
      const parts = ["curl"];
      if (req.method !== "GET") parts.push(`-X ${req.method}`);
      parts.push(`'${req.url}'`);
      Object.entries(req.requestHeaders || {}).forEach(([key, value]) => {
        parts.push(`-H '${key}: ${value}'`);
      });
      if (req.requestBody) {
        const body =
          typeof req.requestBody === "string"
            ? req.requestBody
            : JSON.stringify(req.requestBody);
        parts.push(`-d '${body.replace(/'/g, "\\'")}'`);
      }
      return parts.join(" \\\n  ");
    })
    .join("\n\n");
}
