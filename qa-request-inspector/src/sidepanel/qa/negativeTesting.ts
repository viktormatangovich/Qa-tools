import type { ApiRequest, MockRule } from "../types";
import { matchEndpoint } from "./contract/contractChecker.ts";
import type { OpenApiDocument, OpenApiSchema } from "./contract/types";

export type NegativeScenario = "401" | "403" | "404" | "409" | "429" | "500" | "502" | "503" | "empty" | "malformed-json" | "missing-field" | "null-field" | "delay-1s" | "delay-3s" | "delay-5s" | "timeout";

export interface NegativeTestCase { id: string; title: string; description: string; target: string; kind: "input" | "response"; url?: string; body?: string; headerName?: string; headerValue?: string; removeHeader?: boolean; scenario?: NegativeScenario; }
interface Target { id: string; label: string; kind: "body" | "query" | "path" | "header"; name: string; schema?: OpenApiSchema; required?: boolean; }

function resolveSchema(schema: OpenApiSchema | undefined, document?: OpenApiDocument): OpenApiSchema | undefined {
  if (!schema?.$ref || !document) return schema;
  const prefix = "#/components/schemas/";
  return schema.$ref.startsWith(prefix) ? document.components?.schemas?.[schema.$ref.slice(prefix.length)] ?? schema : schema;
}
function parseBody(request: ApiRequest): Record<string, unknown> | undefined {
  if (!request.requestBody) return undefined;
  try { const value: unknown = JSON.parse(request.requestBody); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; } catch { return undefined; }
}

export function negativeTestTargets(request: ApiRequest, document?: OpenApiDocument): Target[] {
  const matched = document ? matchEndpoint(document, request) : undefined;
  const body = parseBody(request);
  const bodySchema = resolveSchema(Object.values(matched?.operation.requestBody?.content || {}).find((entry) => entry.schema)?.schema, document);
  const bodyNames = new Set([...(body ? Object.keys(body) : []), ...Object.keys(bodySchema?.properties || {})]);
  const targets: Target[] = [...bodyNames].map((name) => ({ id: `body:${name}`, label: `Тело запроса · ${name}`, kind: "body", name, schema: resolveSchema(bodySchema?.properties?.[name], document), required: bodySchema?.required?.includes(name) }));
  const url = new URL(request.url);
  for (const parameter of matched?.operation.parameters || []) {
    const present = parameter.in === "query" ? url.searchParams.has(parameter.name) : parameter.in === "header" ? Object.keys(request.requestHeaders).some((key) => key.toLowerCase() === parameter.name.toLowerCase()) : true;
    if (present || parameter.required) targets.push({ id: `${parameter.in}:${parameter.name}`, label: `${parameter.in === "query" ? "Query" : parameter.in === "path" ? "Path" : "Заголовок"} · ${parameter.name}`, kind: parameter.in, name: parameter.name, schema: resolveSchema(parameter.schema, document), required: parameter.required });
  }
  if (!targets.length) targets.push({ id: "request", label: "Запрос целиком", kind: "body", name: "" });
  return targets;
}

function wrongType(schema?: OpenApiSchema): unknown {
  if (schema?.type === "string") return 123;
  if (schema?.type === "integer" || schema?.type === "number") return "not-a-number";
  if (schema?.type === "boolean") return "not-a-boolean";
  return schema?.type === "array" ? {} : [];
}
function setTarget(request: ApiRequest, target: Target, value: unknown, remove = false): Pick<NegativeTestCase, "url" | "body" | "headerName" | "headerValue" | "removeHeader"> {
  if (target.kind === "body") {
    const body = parseBody(request) || {};
    if (target.name) remove ? delete body[target.name] : body[target.name] = value;
    return { body: target.name ? JSON.stringify(body, null, 2) : remove ? "" : JSON.stringify(value, null, 2) };
  }
  const url = new URL(request.url);
  if (target.kind === "header") return { body: request.requestBody || undefined, headerName: target.name, headerValue: String(value), removeHeader: remove };
  if (target.kind === "query") remove ? url.searchParams.delete(target.name) : url.searchParams.set(target.name, String(value));
  if (target.kind === "path") { const parts = url.pathname.split("/"); parts[parts.length - 1] = encodeURIComponent(String(value)); url.pathname = parts.join("/"); }
  return { url: url.toString(), body: request.requestBody || undefined };
}
function testCase(request: ApiRequest, target: Target, id: string, title: string, description: string, value: unknown, remove = false): NegativeTestCase { return { id: `${target.id}:${id}`, title, description, target: target.label, kind: "input", ...setTarget(request, target, value, remove) }; }

/** Creates deterministic negative input ideas only; it never sends a request. */
export function generateNegativeTests(request: ApiRequest, targetId?: string, document?: OpenApiDocument): NegativeTestCase[] {
  const targets = negativeTestTargets(request, document);
  const target = targets.find((item) => item.id === targetId) || targets[0];
  const schema = target.schema;
  const tests: NegativeTestCase[] = [
    testCase(request, target, "null", "null", "Передать null вместо корректного значения.", null), testCase(request, target, "empty", "Пустая строка", "Передать пустую строку.", ""), testCase(request, target, "minus-one", "-1", "Проверить отрицательное значение.", -1), testCase(request, target, "zero", "0", "Проверить нулевое значение.", 0), testCase(request, target, "long", "Слишком длинная строка", "Передать строку длиной 10 001 символ.", "x".repeat(10_001)), testCase(request, target, "wrong-type", "Неправильный тип", "Передать значение другого типа.", wrongType(schema)),
  ];
  if (target.required || target.kind === "body" || target.kind === "query") tests.push(testCase(request, target, "missing", "Обязательное поле отсутствует", "Удалить поле или параметр из запроса.", undefined, true));
  if (schema?.minimum !== undefined) tests.push(testCase(request, target, "below-min", `Ниже min (${schema.minimum - 1})`, "Значение за нижней границей из OpenAPI.", schema.minimum - 1));
  if (schema?.maximum !== undefined) tests.push(testCase(request, target, "above-max", `Выше max (${schema.maximum + 1})`, "Значение за верхней границей из OpenAPI.", schema.maximum + 1));
  if (schema?.minLength !== undefined) tests.push(testCase(request, target, "below-min-length", `Короче minLength (${Math.max(0, schema.minLength - 1)})`, "Строка короче ограничения OpenAPI.", "x".repeat(Math.max(0, schema.minLength - 1))));
  if (schema?.maxLength !== undefined) tests.push(testCase(request, target, "above-max-length", `Длиннее maxLength (${schema.maxLength + 1})`, "Строка длиннее ограничения OpenAPI.", "x".repeat(schema.maxLength + 1)));
  return tests;
}

export const responseNegativeScenarios: NegativeScenario[] = ["401", "403", "404", "409", "429", "500", "503", "delay-1s", "delay-3s", "delay-5s", "timeout"];
export function createNegativeMock(request: ApiRequest, scenario: NegativeScenario): MockRule {
  const status = Number(scenario); const delay = scenario.startsWith("delay-") ? Number(scenario.match(/\d+/)?.[0]) * 1000 : 0;
  const responseBody = scenario === "empty" ? "" : scenario === "malformed-json" ? "{invalid" : scenario === "missing-field" ? "{}" : scenario === "null-field" ? '{"value":null}' : JSON.stringify({ error: scenario === "500" ? "Simulated server error" : `Simulated ${scenario}` });
  return { id: crypto.randomUUID(), urlPattern: request.url, method: request.method as MockRule["method"], status: Number.isFinite(status) ? status : 200, statusText: `QA simulation: ${scenario}`, responseBody, responseHeaders: { "content-type": "application/json" }, enabled: true, delay, abort: scenario === "timeout", description: `Temporary negative test: ${scenario}`, createdAt: Date.now(), updatedAt: Date.now() };
}
