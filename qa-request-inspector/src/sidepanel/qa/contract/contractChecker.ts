import { parse as parseYaml } from "yaml";
import type { ApiRequest } from "../../types";
import type { QAIssue } from "../core/types";
import { qt } from "../messages.ts";
import type { ContractCoverage, ContractViolation, MatchedEndpoint, OpenApiDocument, OpenApiMediaTypes, OpenApiOperation, OpenApiParameter, OpenApiSchema } from "./types";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];
const MAX_VIOLATIONS = 100;
const MAX_EXTERNAL_DOCUMENTS = 30;

function parseDocumentText(text: string): unknown {
  return /^\s*[\[{]/.test(text) ? JSON.parse(text) : parseYaml(text, { maxAliasCount: 50 });
}

export function parseOpenApiSpec(text: string): OpenApiDocument {
  const value: unknown = parseDocumentText(text);
  if (!value || typeof value !== "object" || !("paths" in value)) throw new Error(qt().specNotOpenApi);
  const document = value as OpenApiDocument;
  if (typeof document.openapi !== "string" || !document.openapi.startsWith("3.")) throw new Error(qt().specOnlyV3);
  if (!document.paths || typeof document.paths !== "object" || Array.isArray(document.paths)) throw new Error(qt().specPathsNotObject);
  return document;
}

/** Loads and validates an OpenAPI document without persisting it. */
export async function loadOpenApiSpecFromUrl(urlText: string, request: typeof fetch = fetch): Promise<string> {
  let url: URL;
  try {
    url = new URL(urlText.trim());
  } catch {
    throw new Error(qt().specInvalidUrl);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(qt().specOnlyHttp);

  let response: Response;
  try {
    response = await request(url.toString(), { headers: { Accept: "application/json, application/vnd.oai.openapi+json" } });
  } catch {
    throw new Error(qt().specFetchFailed);
  }
  if (!response.ok) throw new Error(qt().specHttpError(response.status));

  const text = await response.text();
  try {
    parseOpenApiSpec(text);
  } catch (error) {
    throw new Error(qt().specUnsupported((error as Error).message));
  }
  return text;
}

// ---------------------------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------------------------

/** Value at a local JSON pointer such as `#/components/schemas/User`. */
function pointerValue(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith("#")) return undefined;
  let current = root;
  for (const rawPart of pointer.slice(1).split("/").filter(Boolean)) {
    if (!current || typeof current !== "object") return undefined;
    let part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    try {
      part = decodeURIComponent(part);
    } catch {
      // Keep the raw segment.
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Follows `$ref` chains inside the document; undefined when a reference cannot be resolved. */
function dereference<T extends { $ref?: string }>(value: T | undefined, document: OpenApiDocument): T | undefined {
  let current = value;
  for (let hops = 0; current?.$ref && hops < 20; hops++) {
    const target = pointerValue(document, current.$ref) as T | undefined;
    if (!target || typeof target !== "object") return undefined;
    current = target;
  }
  return current?.$ref ? undefined : current;
}

/**
 * Downloads documents referenced by external `$ref`s (`./schemas.yaml#/User`, `https://…/common.json#/Error`)
 * and inlines them under `x-external`, rewriting the references to local ones. The result is a
 * self-contained specification, so validation itself never touches the network.
 *
 * `baseUrl` resolves relative references; without it only absolute http(s) references can be loaded.
 */
export async function bundleExternalRefs(
  text: string,
  baseUrl?: string,
  request: typeof fetch = fetch,
): Promise<{ text: string; loaded: number; warnings: string[] }> {
  const document = parseDocumentText(text) as Record<string, unknown>;
  const external = (document["x-external"] && typeof document["x-external"] === "object" ? document["x-external"] : {}) as Record<string, unknown>;
  const keys = new Map<string, string | null>(); // absolute URL -> key under x-external (null: failed)
  const warnings: string[] = [];
  let loaded = 0;

  const load = async (url: string): Promise<string | null> => {
    if (keys.has(url)) return keys.get(url) ?? null;
    if (keys.size >= MAX_EXTERNAL_DOCUMENTS) {
      warnings.push(qt().externalLimit(url, MAX_EXTERNAL_DOCUMENTS));
      return null;
    }
    const key = `doc${Object.keys(external).length + 1}`;
    keys.set(url, key);
    try {
      const response = await request(url, { headers: { Accept: "application/json, application/yaml, text/yaml, */*" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parseDocumentText(await response.text());
      if (!parsed || typeof parsed !== "object") throw new Error(qt().documentEmpty);
      external[key] = parsed;
      loaded += 1;
      await visit(parsed, url, key);
      return key;
    } catch (error) {
      keys.set(url, null);
      warnings.push(qt().externalFailed(url, (error as Error).message));
      return null;
    }
  };

  const visit = async (node: unknown, base: string | undefined, selfKey: string | null): Promise<void> => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) await visit(item, base, selfKey);
      return;
    }
    const object = node as Record<string, unknown>;
    const ref = object.$ref;
    if (typeof ref === "string") {
      if (ref.startsWith("#")) {
        // A local reference inside an external document now lives under x-external.
        if (selfKey) object.$ref = `#/x-external/${selfKey}${ref.slice(1)}`;
      } else {
        const hash = ref.indexOf("#");
        const file = hash === -1 ? ref : ref.slice(0, hash);
        const pointer = hash === -1 ? "" : ref.slice(hash + 1);
        let absolute: string | null = null;
        try {
          absolute = new URL(file, base).toString();
        } catch {
          warnings.push(qt().relativeRefUnknownBase(ref));
        }
        if (absolute && !/^https?:/i.test(absolute)) {
          warnings.push(qt().refOnlyHttp(ref));
          absolute = null;
        }
        if (absolute) {
          const key = await load(absolute);
          if (key) object.$ref = `#/x-external/${key}${pointer}`;
        }
      }
    }
    for (const [name, value] of Object.entries(object)) {
      if (selfKey === null && name === "x-external") continue; // already bundled
      await visit(value, base, selfKey);
    }
  };

  await visit(document, baseUrl, null);
  if (Object.keys(external).length) document["x-external"] = external;
  return { text: loaded ? JSON.stringify(document, null, 2) : text, loaded, warnings: [...new Set(warnings)] };
}

// ---------------------------------------------------------------------------------------------
// Endpoint matching
// ---------------------------------------------------------------------------------------------

interface CompiledPath { pathTemplate: string; expression: RegExp; parameterCount: number }
const compiledPaths = new WeakMap<OpenApiDocument, CompiledPath[]>();

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Path prefixes from `servers` ("https://api.test/v1" -> "/v1"); the empty prefix is always allowed. */
function serverPrefixes(document: OpenApiDocument): string[] {
  const prefixes = new Set<string>([""]);
  for (const server of document.servers || []) {
    if (typeof server?.url !== "string") continue;
    try {
      const path = new URL(server.url.replace(/\{[^}]+\}/g, "x"), "http://placeholder.test").pathname.replace(/\/+$/, "");
      if (path) prefixes.add(path);
    } catch {
      // Unusable server URL.
    }
  }
  return [...prefixes];
}

function compilePaths(document: OpenApiDocument): CompiledPath[] {
  let compiled = compiledPaths.get(document);
  if (!compiled) {
    const prefix = serverPrefixes(document).map(escapeRegExp).join("|");
    compiled = Object.keys(document.paths)
      .map((pathTemplate) => ({
        pathTemplate,
        // A trailing slash is optional on both sides: "/items/{id}/" matches "/items/5" and the other way round.
        expression: new RegExp(`^(?:${prefix})${escapeRegExp(pathTemplate.replace(/\/+$/, "")).replace(/\\\{[^}]+\\\}/g, "[^/]+")}/?$`),
        parameterCount: (pathTemplate.match(/\{[^}]+\}/g) || []).length,
      }))
      // "/users/me" must win over "/users/{id}".
      .sort((a, b) => a.parameterCount - b.parameterCount);
    compiledPaths.set(document, compiled);
  }
  return compiled;
}

export function matchEndpoint(document: OpenApiDocument, request: ApiRequest): MatchedEndpoint | undefined {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return undefined;
  }
  const method = request.method.toLowerCase();
  for (const { pathTemplate, expression } of compilePaths(document)) {
    const pathItem = document.paths[pathTemplate];
    if (!pathItem || typeof pathItem !== "object") continue;
    const operation = pathItem[method];
    if (operation && expression.test(pathname)) return { pathTemplate, operation };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------------------------

type Location = ContractViolation["location"];
interface Context { document: OpenApiDocument; violations: ContractViolation[] }

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

const matchesType = (value: unknown, type: string): boolean =>
  valueType(value) === type || (type === "number" && typeof value === "number");

/** `allOf` as one schema: properties and required lists are joined, other keywords are taken from the first part that has them. */
function mergeAllOf(schema: OpenApiSchema, document: OpenApiDocument, depth = 0): OpenApiSchema {
  if (!schema.allOf || depth > 10) return schema;
  const { allOf, ...rest } = schema;
  const merged: Record<string, unknown> = { ...rest };
  const properties: Record<string, OpenApiSchema> = { ...rest.properties };
  const required = new Set(rest.required || []);
  for (const part of allOf) {
    const resolved = dereference(part, document);
    if (!resolved) continue;
    const sub = mergeAllOf(resolved, document, depth + 1);
    Object.assign(properties, sub.properties);
    for (const key of sub.required || []) required.add(key);
    for (const [key, value] of Object.entries(sub)) {
      if (key !== "properties" && key !== "required" && merged[key] === undefined) merged[key] = value;
    }
  }
  if (Object.keys(properties).length) merged.properties = properties;
  if (required.size) merged.required = [...required];
  return merged as OpenApiSchema;
}

const FORMATS: Record<string, (value: string) => boolean> = {
  "date-time": (value) => /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value)),
  date: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)),
  email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  uuid: (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  uri: (value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },
  ipv4: (value) => /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(value),
};

/** The variant named by the discriminator property of the value, if the schema has one. */
function discriminated(schema: OpenApiSchema, variants: OpenApiSchema[], value: unknown): OpenApiSchema | undefined {
  const property = schema.discriminator?.propertyName;
  if (!property || !value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const tag = (value as Record<string, unknown>)[property];
  if (typeof tag !== "string") return undefined;
  const mapped = schema.discriminator?.mapping?.[tag];
  if (mapped) return { $ref: mapped.startsWith("#") ? mapped : `#/components/schemas/${mapped}` };
  return variants.find((variant) => variant.$ref?.endsWith(`/${tag}`));
}

function validateSchema(value: unknown, schemaInput: OpenApiSchema | undefined, context: Context, path: string, location: Location = "response", depth = 0): void {
  const { document, violations } = context;
  if (!schemaInput || depth > 30 || violations.length >= MAX_VIOLATIONS) return;
  const resolved = dereference(schemaInput, document);
  if (!resolved) return;
  const schema = mergeAllOf(resolved, document);
  const add = (message: string, expected?: string, actual?: string) => {
    if (violations.length < MAX_VIOLATIONS) violations.push({ location, path, message, ...(expected !== undefined ? { expected } : {}), ...(actual !== undefined ? { actual } : {}) });
  };

  const types = schema.type === undefined ? undefined : Array.isArray(schema.type) ? schema.type : [schema.type];
  const composed = Boolean(schema.oneOf?.length || schema.anyOf?.length);

  if (value === null) {
    if (schema.nullable || types?.includes("null") || schema.enum?.includes(null)) return;
    // Without its own type the variants decide whether null is allowed.
    if (!(composed && !types)) {
      add(qt().vNull, types?.join(" | "), "null");
      return;
    }
  } else if (types && !types.some((type) => matchesType(value, type))) {
    add(qt().vType, types.join(" | "), valueType(value));
    return;
  }

  if (schema.enum && !schema.enum.some((allowed) => JSON.stringify(allowed) === JSON.stringify(value))) add(qt().vEnum);
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) add(qt().vConst, JSON.stringify(schema.const), JSON.stringify(value)?.slice(0, 80));

  if (typeof value === "number") {
    const { minimum, maximum, exclusiveMinimum, exclusiveMaximum } = schema;
    if (typeof exclusiveMinimum === "number" && value <= exclusiveMinimum) add(qt().vExclusiveMinimum, String(exclusiveMinimum), String(value));
    if (typeof exclusiveMaximum === "number" && value >= exclusiveMaximum) add(qt().vExclusiveMaximum, String(exclusiveMaximum), String(value));
    if (minimum !== undefined && (exclusiveMinimum === true ? value <= minimum : value < minimum)) add(qt().vMinimum, String(minimum), String(value));
    if (maximum !== undefined && (exclusiveMaximum === true ? value >= maximum : value > maximum)) add(qt().vMaximum, String(maximum), String(value));
    if (schema.multipleOf && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9) add(qt().vMultipleOf, String(schema.multipleOf), String(value));
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) add(qt().vMinLength, String(schema.minLength), String(value.length));
    if (schema.maxLength !== undefined && value.length > schema.maxLength) add(qt().vMaxLength, String(schema.maxLength), String(value.length));
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern, "u").test(value)) add(qt().vPattern, schema.pattern, value.slice(0, 80));
      } catch {
        // A pattern JavaScript cannot compile is not checked.
      }
    }
    const format = schema.format ? FORMATS[schema.format] : undefined;
    if (format && !format(value)) add(qt().vFormat, schema.format, value.slice(0, 80));
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add(qt().vMinItems, String(schema.minItems), String(value.length));
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add(qt().vMaxItems, String(schema.maxItems), String(value.length));
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) add(qt().vUniqueItems);
    value.forEach((item, index) => validateSchema(item, schema.items, context, `${path}[${index}]`, location, depth + 1));
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) add(qt().vMinProperties, String(schema.minProperties), String(keys.length));
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) add(qt().vMaxProperties, String(schema.maxProperties), String(keys.length));
    for (const key of schema.required || []) if (!(key in object)) violations.push({ location, path: `${path}.${key}`, message: qt().vRequiredProperty });
    for (const [key, childSchema] of Object.entries(schema.properties || {})) if (key in object) validateSchema(object[key], childSchema, context, `${path}.${key}`, location, depth + 1);
    const extra = schema.additionalProperties;
    if (extra === false) {
      for (const key of keys) if (!schema.properties?.[key]) violations.push({ location, path: `${path}.${key}`, message: qt().vAdditionalProperty });
    } else if (extra && typeof extra === "object") {
      for (const key of keys) if (!schema.properties?.[key]) validateSchema(object[key], extra, context, `${path}.${key}`, location, depth + 1);
    }
  }

  for (const keyword of ["oneOf", "anyOf"] as const) {
    const variants = schema[keyword];
    if (!variants?.length) continue;
    const chosen = discriminated(schema, variants, value);
    if (chosen) {
      validateSchema(value, chosen, context, path, location, depth + 1);
      continue;
    }
    const results = variants.map((variant) => {
      const local: ContractViolation[] = [];
      validateSchema(value, variant, { document, violations: local }, path, location, depth + 1);
      return local;
    });
    const passed = results.filter((result) => result.length === 0).length;
    if (passed === 0) {
      const closest = [...results].sort((a, b) => a.length - b.length)[0]?.[0];
      add(qt().vNoVariant(keyword), closest ? `${closest.path}: ${closest.message}` : undefined);
    } else if (keyword === "oneOf" && passed > 1) {
      add(qt().vManyOneOf, "1", String(passed));
    }
  }

  if (schema.not) {
    const local: ContractViolation[] = [];
    validateSchema(value, schema.not, { document, violations: local }, path, location, depth + 1);
    if (local.length === 0) add(qt().vNot);
  }
}

// ---------------------------------------------------------------------------------------------
// Requests and responses
// ---------------------------------------------------------------------------------------------

const header = (headers: Record<string, string>, name: string): string | undefined =>
  Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];

const mediaType = (headers: Record<string, string>): string | undefined => header(headers, "content-type")?.split(";")[0].trim().toLowerCase();

/** The documented response for a status: exact code, then a range such as `4XX`, then `default`. */
function documentedResponse(operation: OpenApiOperation, status: number, document: OpenApiDocument): OpenApiMediaTypes | undefined {
  const responses = operation.responses;
  if (!responses) return undefined;
  const range = `${Math.floor(status / 100)}XX`;
  const key = [String(status), range, range.toLowerCase(), "default"].find((candidate) => candidate in responses);
  return key ? dereference(responses[key], document) : undefined;
}

/** Schema for the actual content type; falls back to wildcards and then to the first documented one. */
function contentSchema(content: OpenApiMediaTypes["content"], actualType: string | undefined): OpenApiSchema | undefined {
  if (!content) return undefined;
  const entries = Object.entries(content);
  const exact = actualType ? entries.find(([type]) => type.toLowerCase().split(";")[0].trim() === actualType) : undefined;
  const wildcard = actualType ? entries.find(([type]) => type === "*/*" || (type.endsWith("/*") && actualType.startsWith(type.slice(0, -1)))) : undefined;
  return (exact || wildcard || entries.find(([, value]) => value?.schema))?.[1]?.schema;
}

function hasContentType(content: NonNullable<OpenApiMediaTypes["content"]>, actualType: string): boolean {
  return Object.keys(content).some((type) => {
    const documented = type.toLowerCase().split(";")[0].trim();
    return documented === actualType || documented === "*/*" || (documented.endsWith("/*") && actualType.startsWith(documented.slice(0, -1)));
  });
}

export function validateResponse(document: OpenApiDocument, request: ApiRequest): ContractViolation[] {
  const matched = matchEndpoint(document, request);
  if (!matched) return [];
  const violations: ContractViolation[] = [];
  const documented = documentedResponse(matched.operation, request.status, document);
  if (!documented) violations.push({ location: "response", path: "$", message: qt().vStatusUndocumented, actual: String(request.status) });
  const actualType = mediaType(request.responseHeaders);
  if (documented?.content && Object.keys(documented.content).length && actualType && !hasContentType(documented.content, actualType)) {
    violations.push({ location: "response", path: "$headers.content-type", message: qt().vContentTypeUndocumented, actual: actualType });
  }
  validateSchema(request.responseBody, contentSchema(documented?.content, actualType), { document, violations }, "$");
  return violations;
}

/** Parameters of the path item and of the operation; the operation wins for the same name and place. */
function operationParameters(document: OpenApiDocument, pathTemplate: string, operation: OpenApiOperation): OpenApiParameter[] {
  const shared = (document.paths[pathTemplate] as unknown as { parameters?: OpenApiParameter[] })?.parameters;
  const byKey = new Map<string, OpenApiParameter>();
  for (const raw of [...(Array.isArray(shared) ? shared : []), ...(operation.parameters || [])]) {
    const parameter = dereference(raw, document);
    if (parameter?.name) byKey.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...byKey.values()];
}

const schemaTypes = (schema: OpenApiSchema | undefined): string[] =>
  schema?.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];

/** A raw string as the documented scalar type; values that cannot be converted stay strings and fail the type check. */
function scalarValue(text: string, schema: OpenApiSchema | undefined, document: OpenApiDocument): unknown {
  const types = schemaTypes(dereference(schema, document));
  if ((types.includes("integer") || types.includes("number")) && text.trim() !== "" && !Number.isNaN(Number(text))) return Number(text);
  if (types.includes("boolean") && (text === "true" || text === "false")) return text === "true";
  return text;
}

/**
 * The parameter value as the schema sees it. Arrays follow the serialization rules of OpenAPI:
 * query `form` with explode (default) repeats the name (`?id=1&id=2`), without explode it is comma-separated;
 * `spaceDelimited` / `pipeDelimited` use their separators; path and header values (`simple`) are comma-separated.
 */
function parameterValue(parameter: OpenApiParameter, raw: string[], document: OpenApiDocument): unknown {
  const schema = dereference(parameter.schema, document);
  if (!schemaTypes(schema).includes("array")) return scalarValue(raw[0], parameter.schema, document);
  const style = parameter.style || (parameter.in === "query" ? "form" : "simple");
  const explode = parameter.explode ?? style === "form";
  const separator = style === "spaceDelimited" ? /s+|%20/ : style === "pipeDelimited" ? "|" : ",";
  const items = style === "form" && explode ? raw : raw.flatMap((value) => value.split(separator));
  return items.map((item) => scalarValue(item, schema?.items, document));
}

export function validateRequest(document: OpenApiDocument, request: ApiRequest): ContractViolation[] {
  const matched = matchEndpoint(document, request);
  if (!matched) return [];
  const url = new URL(request.url);
  const violations: ContractViolation[] = [];
  // Path values are counted from the end, so a server prefix ("/v1") does not shift them.
  const pathValues = url.pathname.replace(/\/+$/, "").split("/").reverse();
  const templateValues = matched.pathTemplate.replace(/\/+$/, "").split("/").reverse();
  for (const parameter of operationParameters(document, matched.pathTemplate, matched.operation)) {
    const raw: string[] | undefined = parameter.in === "query" ? url.searchParams.getAll(parameter.name)
      : parameter.in === "header" ? [header(request.requestHeaders, parameter.name.toLowerCase())].filter((value): value is string => value !== undefined)
      : parameter.in === "path" ? [pathValues[templateValues.findIndex((part) => part === `{${parameter.name}}`)]].filter(Boolean)
      : undefined;
    if (raw === undefined) continue; // cookies and other places are not checked
    const path = `$.${parameter.in}.${parameter.name}`;
    if (!raw.some(Boolean)) {
      if (parameter.required) violations.push({ location: "request", path, message: qt().vRequiredParameter });
      continue;
    }
    validateSchema(parameterValue(parameter, raw, document), parameter.schema, { document, violations }, path, "request");
  }
  const requestBody = dereference(matched.operation.requestBody, document);
  if (requestBody?.required && !request.requestBody) violations.push({ location: "request", path: "$", message: qt().vRequiredBody });
  if (request.requestBody && requestBody?.content) {
    const actualType = mediaType(request.requestHeaders);
    const looksLikeJson = /^\s*[[{"]/.test(request.requestBody);
    // Form and multipart bodies are not JSON: only JSON bodies are checked against the schema.
    if (actualType ? actualType.includes("json") : looksLikeJson) {
      try {
        validateSchema(JSON.parse(request.requestBody), contentSchema(requestBody.content, actualType), { document, violations }, "$", "request");
      } catch {
        violations.push({ location: "request", path: "$", message: qt().vInvalidJsonBody });
      }
    }
  }
  return violations;
}

export function contractIssues(document: OpenApiDocument, requests: ApiRequest[]): QAIssue[] {
  return requests.flatMap((request) => {
    const matched = matchEndpoint(document, request);
    if (!matched) return [];
    return [...validateRequest(document, request), ...validateResponse(document, request)].map((violation, index) => ({
      id: `contract:${request.id}:${index}`, ruleId: "contract.openapi", category: "contract", severity: "error", title: qt().contractViolation,
      description: `${violation.path}: ${violation.message}`, timestamp: request.timestamp, url: request.url, requestId: request.id,
      evidence: { location: violation.location, path: violation.path, ...(violation.expected ? { expected: violation.expected } : {}), ...(violation.actual ? { actual: violation.actual } : {}) },
    }));
  });
}

export function contractCoverage(document: OpenApiDocument, requests: ApiRequest[]): ContractCoverage {
  const endpointKeys = Object.entries(document.paths).flatMap(([path, operations]) => Object.keys(operations || {}).filter(method => HTTP_METHODS.includes(method)).map((method) => `${method.toUpperCase()} ${path}`));
  const matched = requests.map((request) => ({ request, endpoint: matchEndpoint(document, request) })).filter((item) => item.endpoint);
  const exercised = new Set(matched.map(({ request, endpoint }) => `${request.method} ${endpoint!.pathTemplate}`)).size;
  const failures = matched.filter(({ request }) => validateResponse(document, request).length + validateRequest(document, request).length > 0).length;
  const unmatched = new Set<string>();
  for (let index = requests.length - 1; index >= 0 && unmatched.size < 3; index--) {
    const request = requests[index];
    if (matchEndpoint(document, request)) continue;
    try {
      unmatched.add(`${request.method} ${new URL(request.url).pathname}`);
    } catch {
      // Not a URL: nothing to show.
    }
  }
  return { total: endpointKeys.length, exercised, validated: matched.length, passed: matched.length - failures, failed: failures, captured: requests.length, unmatched: [...unmatched] };
}

const UNSUPPORTED_KEYWORDS = ["if", "then", "else", "contains", "dependentRequired", "dependentSchemas", "patternProperties", "propertyNames", "prefixItems", "unevaluatedProperties"];

/** Parts of the specification that are not checked: unsupported keywords and references that cannot be resolved. */
export function unsupportedContractFeatures(document: OpenApiDocument): string[] {
  const warnings = new Set<string>();
  const visit = (value: unknown, path: string, isNameMap: boolean) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      // Inside `properties` the keys are field names, not schema keywords.
      if (!isNameMap) {
        if (UNSUPPORTED_KEYWORDS.includes(key)) warnings.add(qt().keywordUnsupported(path + '.' + key));
        if (key === '$ref' && typeof item === 'string') {
          if (!item.startsWith('#')) warnings.add(qt().externalRefNotLoaded(path, item));
          else if (pointerValue(document, item) === undefined) warnings.add(qt().refNotFound(path, item));
        }
      }
      visit(item, path + '.' + key, !isNameMap && (key === 'properties' || key === 'schemas' || key === 'paths' || key === 'x-external'));
    }
  };
  visit(document, '$', false);
  return [...warnings];
}

/** True when the specification has references to other files or URLs that are not bundled yet. */
export function hasExternalRefs(document: OpenApiDocument): boolean {
  let found = false;
  const visit = (value: unknown) => {
    if (found || !value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string' && !item.startsWith('#')) found = true;
      else visit(item);
    }
  };
  visit(document);
  return found;
}
