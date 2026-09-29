import type { ApiRequest } from "../../types";
import type { QAIssue } from "../core/types";
import type { ContractViolation, MatchedEndpoint, OpenApiDocument, OpenApiOperation, OpenApiSchema } from "./types";

export function parseOpenApiSpec(text: string): OpenApiDocument {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || !("paths" in value)) throw new Error("Ожидается OpenAPI JSON-документ с paths.");
  const document = value as OpenApiDocument;
  if (!document.openapi?.startsWith("3.")) throw new Error("Поддерживается только OpenAPI 3.x JSON.");
  return document;
}

/** Loads and validates an OpenAPI document without persisting it. */
export async function loadOpenApiSpecFromUrl(urlText: string, request: typeof fetch = fetch): Promise<string> {
  let url: URL;
  try {
    url = new URL(urlText.trim());
  } catch {
    throw new Error("Укажите корректный URL спецификации.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Поддерживаются только HTTP(S) URL.");

  let response: Response;
  try {
    response = await request(url.toString(), { headers: { Accept: "application/json, application/vnd.oai.openapi+json" } });
  } catch {
    throw new Error("Не удалось загрузить спецификацию по URL. Проверьте адрес и доступ к серверу.");
  }
  if (!response.ok) throw new Error(`Сервер вернул HTTP ${response.status} при загрузке спецификации.`);

  const text = await response.text();
  try {
    parseOpenApiSpec(text);
  } catch (error) {
    throw new Error(`Загруженный документ не является поддерживаемой OpenAPI 3.x JSON-спецификацией: ${(error as Error).message}`);
  }
  return text;
}

export function matchEndpoint(document: OpenApiDocument, request: ApiRequest): MatchedEndpoint | undefined {
  const url = new URL(request.url);
  for (const [pathTemplate, pathItem] of Object.entries(document.paths)) {
    const expression = new RegExp(`^${pathTemplate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{[^}]+\\\}/g, "[^/]+")}$`);
    const operation = pathItem[request.method.toLowerCase()];
    if (operation && expression.test(url.pathname)) return { pathTemplate, operation };
  }
  return undefined;
}

function dereference(schema: OpenApiSchema | undefined, document: OpenApiDocument): OpenApiSchema | undefined {
  if (!schema?.$ref) return schema;
  const prefix = "#/components/schemas/";
  if (!schema.$ref.startsWith(prefix)) return schema;
  return document.components?.schemas?.[schema.$ref.slice(prefix.length)];
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function validateSchema(value: unknown, schemaInput: OpenApiSchema | undefined, document: OpenApiDocument, path: string, violations: ContractViolation[], location: ContractViolation["location"] = "response", depth = 0): void {
  if (!schemaInput || depth > 30 || violations.length >= 100) return;
  const schema = dereference(schemaInput, document);
  if (!schema) return;
  if (value === null) {
    if (!schema.nullable) violations.push({ location, path, message: "Value must not be null.", expected: schema.type, actual: "null" });
    return;
  }
  if (schema.type && valueType(value) !== schema.type) {
    violations.push({ location, path, message: "Неожиданный тип значения.", expected: schema.type, actual: valueType(value) });
    return;
  }
  if (schema.enum && !schema.enum.some((allowed) => JSON.stringify(allowed) === JSON.stringify(value))) violations.push({ location, path, message: "Значение отсутствует в документированном enum." });
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) violations.push({ location, path, message: "Value is below minimum.", expected: String(schema.minimum), actual: String(value) });
    if (schema.maximum !== undefined && value > schema.maximum) violations.push({ location, path, message: "Value is above maximum.", expected: String(schema.maximum), actual: String(value) });
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) violations.push({ location, path, message: "String is shorter than minLength.", expected: String(schema.minLength), actual: String(value.length) });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) violations.push({ location, path, message: "String is longer than maxLength.", expected: String(schema.maxLength), actual: String(value.length) });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) violations.push({ location, path, message: "Array is shorter than minItems." });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) violations.push({ location, path, message: "Array is longer than maxItems." });
    value.forEach((item, index) => validateSchema(item, schema.items, document, `${path}[${index}]`, violations, location, depth + 1));
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const key of schema.required || []) if (!(key in object)) violations.push({ location, path: `${path}.${key}`, message: "Отсутствует обязательное свойство." });
    for (const [key, childSchema] of Object.entries(schema.properties || {})) if (key in object) validateSchema(object[key], childSchema, document, `${path}.${key}`, violations, location, depth + 1);
    if (schema.additionalProperties === false) for (const key of Object.keys(object)) if (!schema.properties?.[key]) violations.push({ location, path: `${path}.${key}`, message: "Additional property is not allowed." });
  }
}

function responseSchema(operation: OpenApiOperation, status: number): OpenApiSchema | undefined {
  const response = operation.responses?.[String(status)] || operation.responses?.default;
  if (!response) return undefined;
  return Object.values(response.content || {}).find((content) => content.schema)?.schema;
}

export function validateResponse(document: OpenApiDocument, request: ApiRequest): ContractViolation[] {
  const matched = matchEndpoint(document, request);
  if (!matched) return [];
  const violations: ContractViolation[] = [];
  if (!matched.operation.responses?.[String(request.status)] && !matched.operation.responses?.default) violations.push({ location: "response", path: "$", message: "HTTP-статус не описан в контракте.", actual: String(request.status) });
  const documented = matched.operation.responses?.[String(request.status)] || matched.operation.responses?.default;
  if (documented?.content && Object.keys(documented.content).length) {
    const actualContentType = Object.entries(request.responseHeaders).find(([key]) => key.toLowerCase() === "content-type")?.[1]?.split(";")[0];
    if (actualContentType && !documented.content[actualContentType]) violations.push({ location: "response", path: "$headers.content-type", message: "Content-Type не описан в контракте.", actual: actualContentType });
  }
  validateSchema(request.responseBody, responseSchema(matched.operation, request.status), document, "$", violations);
  return violations;
}

export function validateRequest(document: OpenApiDocument, request: ApiRequest): ContractViolation[] {
  const matched = matchEndpoint(document, request);
  if (!matched) return [];
  const url = new URL(request.url);
  const violations: ContractViolation[] = [];
  const pathValues = new URL(request.url).pathname.split("/");
  const templateValues = matched.pathTemplate.split("/");
  for (const parameter of matched.operation.parameters || []) {
    const actual = parameter.in === "query" ? url.searchParams.get(parameter.name) : parameter.in === "header" ? Object.entries(request.requestHeaders).find(([key]) => key.toLowerCase() === parameter.name.toLowerCase())?.[1] : pathValues[templateValues.findIndex((part) => part === `{${parameter.name}}`)] || null;
    if (parameter.required && !actual) violations.push({ location: "request", path: `$.${parameter.in}.${parameter.name}`, message: "Отсутствует обязательный параметр." });
    if (actual) {
      const typedActual: unknown = parameter.schema?.type === "integer" || parameter.schema?.type === "number" ? Number(actual) : parameter.schema?.type === "boolean" ? actual === "true" : actual;
      validateSchema(Number.isNaN(typedActual) ? actual : typedActual, parameter.schema, document, `$.${parameter.in}.${parameter.name}`, violations, "request");
    }
  }
  if (matched.operation.requestBody?.required && !request.requestBody) violations.push({ location: "request", path: "$", message: "Отсутствует обязательное тело запроса." });
  if (request.requestBody) {
    try {
      const body = JSON.parse(request.requestBody);
      const schema = Object.values(matched.operation.requestBody?.content || {}).find((content) => content.schema)?.schema;
      validateSchema(body, schema, document, "$", violations, "request");
    } catch { violations.push({ location: "request", path: "$", message: "Тело запроса содержит некорректный JSON." }); }
  }
  return violations;
}

export function contractIssues(document: OpenApiDocument, requests: ApiRequest[]): QAIssue[] {
  return requests.flatMap((request) => {
    const matched = matchEndpoint(document, request);
    if (!matched) return [];
    return [...validateRequest(document, request), ...validateResponse(document, request)].map((violation, index) => ({
      id: `contract:${request.id}:${index}`, ruleId: "contract.openapi", category: "contract", severity: "error", title: "Нарушение API-контракта",
      description: `${violation.path}: ${violation.message}`, timestamp: request.timestamp, url: request.url, requestId: request.id,
      evidence: { location: violation.location, path: violation.path, ...(violation.expected ? { expected: violation.expected } : {}), ...(violation.actual ? { actual: violation.actual } : {}) },
    }));
  });
}

export function contractCoverage(document: OpenApiDocument, requests: ApiRequest[]): { total: number; exercised: number; validated: number; passed: number; failed: number } {
  const endpointKeys = Object.entries(document.paths).flatMap(([path, operations]) => Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`));
  const matched = requests.map((request) => ({ request, endpoint: matchEndpoint(document, request) })).filter((item) => item.endpoint);
  const exercised = new Set(matched.map(({ request, endpoint }) => `${request.method} ${endpoint!.pathTemplate}`)).size;
  const failures = matched.filter(({ request }) => validateResponse(document, request).length + validateRequest(document, request).length > 0).length;
  return { total: endpointKeys.length, exercised, validated: matched.length, passed: matched.length - failures, failed: failures };
}
