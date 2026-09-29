import type { OpenApiDocument, OpenApiSchema } from "./types";

export interface ContractDiffEntry { severity: "breaking" | "non-breaking"; message: string; }
function schemaChanges(oldSchema: OpenApiSchema | undefined, nextSchema: OpenApiSchema | undefined, path: string): ContractDiffEntry[] {
  if (!oldSchema || !nextSchema) return [];
  const changes: ContractDiffEntry[] = [];
  if (oldSchema.type && nextSchema.type && oldSchema.type !== nextSchema.type) changes.push({ severity: "breaking", message: `${path} type changed: ${oldSchema.type} → ${nextSchema.type}` });
  for (const key of oldSchema.required || []) if (!nextSchema.required?.includes(key)) changes.push({ severity: "non-breaking", message: `${path}.${key} is no longer required` });
  for (const key of nextSchema.required || []) if (!oldSchema.required?.includes(key)) changes.push({ severity: "breaking", message: `${path}.${key} became required` });
  return changes;
}
export function diffOpenApi(oldSpec: OpenApiDocument, nextSpec: OpenApiDocument): ContractDiffEntry[] {
  const changes: ContractDiffEntry[] = [];
  for (const [path, oldPath] of Object.entries(oldSpec.paths)) {
    const nextPath = nextSpec.paths[path];
    if (!nextPath) { changes.push({ severity: "breaking", message: `Endpoint removed: ${path}` }); continue; }
    for (const [method, oldOperation] of Object.entries(oldPath)) {
      const nextOperation = nextPath[method];
      if (!nextOperation) { changes.push({ severity: "breaking", message: `Operation removed: ${method.toUpperCase()} ${path}` }); continue; }
      for (const status of Object.keys(oldOperation.responses || {})) if (!nextOperation.responses?.[status]) changes.push({ severity: "breaking", message: `Response status removed: ${method.toUpperCase()} ${path} ${status}` });
      changes.push(...schemaChanges(Object.values(oldOperation.responses || {})[0]?.content && Object.values(Object.values(oldOperation.responses || {})[0]!.content!)[0]?.schema, Object.values(nextOperation.responses || {})[0]?.content && Object.values(Object.values(nextOperation.responses || {})[0]!.content!)[0]?.schema, `${method.toUpperCase()} ${path}`));
    }
  }
  return changes;
}
