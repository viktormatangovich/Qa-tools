import type { OpenApiSchema } from "./types";

/** Deterministic boundary-value ideas; this function never sends a request. */
export function contractTestSuggestions(schema: OpenApiSchema): unknown[] {
  const values: unknown[] = [];
  if (schema.enum) values.push(...schema.enum);
  if (schema.type === "integer" || schema.type === "number") {
    if (schema.minimum !== undefined) values.push(schema.minimum - 1, schema.minimum, schema.minimum + 1);
    if (schema.maximum !== undefined) values.push(schema.maximum - 1, schema.maximum, schema.maximum + 1);
    values.push(null, "0");
  }
  if (schema.type === "string") {
    for (const length of [schema.minLength, schema.maxLength]) if (length !== undefined) values.push("x".repeat(Math.max(0, length - 1)), "x".repeat(length), "x".repeat(length + 1));
    values.push(null, "");
  }
  if (schema.type === "array") values.push([], null);
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}
