import type { ApiRequest, MockRule } from "../types";
import { matchEndpoint } from "./contract/contractChecker.ts";
import type { OpenApiDocument, OpenApiSchema } from "./contract/types";
import { qt } from "./messages.ts";

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
  const targets: Target[] = [...bodyNames].map((name) => ({ id: `body:${name}`, label: qt().negBodyTarget(name), kind: "body", name, schema: resolveSchema(bodySchema?.properties?.[name], document), required: bodySchema?.required?.includes(name) }));
  const url = new URL(request.url);
  for (const parameter of matched?.operation.parameters || []) {
    const present = parameter.in === "query" ? url.searchParams.has(parameter.name) : parameter.in === "header" ? Object.keys(request.requestHeaders).some((key) => key.toLowerCase() === parameter.name.toLowerCase()) : true;
    if (present || parameter.required) targets.push({ id: `${parameter.in}:${parameter.name}`, label: `${parameter.in === "query" ? "Query" : parameter.in === "path" ? "Path" : qt().negHeader} · ${parameter.name}`, kind: parameter.in, name: parameter.name, schema: resolveSchema(parameter.schema, document), required: parameter.required });
  }
  if (!targets.length) targets.push({ id: "request", label: qt().negWholeRequest, kind: "body", name: "" });
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
  const m = qt();
  const tests: NegativeTestCase[] = [
    testCase(request, target, "null", "null", m.negNullDescription, null), testCase(request, target, "empty", m.negEmptyTitle, m.negEmptyDescription, ""), testCase(request, target, "minus-one", "-1", m.negMinusOneDescription, -1), testCase(request, target, "zero", "0", m.negZeroDescription, 0), testCase(request, target, "long", m.negLongTitle, m.negLongDescription, "x".repeat(10_001)), testCase(request, target, "wrong-type", m.negWrongTypeTitle, m.negWrongTypeDescription, wrongType(schema)),
  ];
  if (target.required || target.kind === "body" || target.kind === "query") tests.push(testCase(request, target, "missing", m.negMissingTitle, m.negMissingDescription, undefined, true));
  if (schema?.minimum !== undefined) tests.push(testCase(request, target, "below-min", m.negBelowMin(schema.minimum - 1), m.negBelowMinDescription, schema.minimum - 1));
  if (schema?.maximum !== undefined) tests.push(testCase(request, target, "above-max", m.negAboveMax(schema.maximum + 1), m.negAboveMaxDescription, schema.maximum + 1));
  if (schema?.minLength !== undefined) tests.push(testCase(request, target, "below-min-length", m.negBelowMinLength(Math.max(0, schema.minLength - 1)), m.negBelowMinLengthDescription, "x".repeat(Math.max(0, schema.minLength - 1))));
  if (schema?.maxLength !== undefined) tests.push(testCase(request, target, "above-max-length", m.negAboveMaxLength(schema.maxLength + 1), m.negAboveMaxLengthDescription, "x".repeat(schema.maxLength + 1)));
  return tests;
}

export const responseNegativeScenarios: NegativeScenario[] = ["401", "403", "404", "409", "429", "500", "503", "delay-1s", "delay-3s", "delay-5s", "timeout"];
export function createNegativeMock(request: ApiRequest, scenario: NegativeScenario): MockRule {
  const status = Number(scenario); const delay = scenario.startsWith("delay-") ? Number(scenario.match(/\d+/)?.[0]) * 1000 : 0;
  const responseBody = scenario === "empty" ? "" : scenario === "malformed-json" ? "{invalid" : scenario === "missing-field" ? "{}" : scenario === "null-field" ? '{"value":null}' : JSON.stringify({ error: scenario === "500" ? qt().negServerErrorBody : qt().negScenarioBody(scenario) });
  return { id: crypto.randomUUID(), urlPattern: request.url, method: request.method as MockRule["method"], status: Number.isFinite(status) ? status : 200, statusText: qt().negStatusText(scenario), responseBody, responseHeaders: { "content-type": "application/json" }, enabled: true, delay, abort: scenario === "timeout", description: qt().negMockDescription(scenario), createdAt: Date.now(), updatedAt: Date.now() };
}
