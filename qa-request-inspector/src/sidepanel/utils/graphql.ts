import type { ApiRequest, GraphQLInfo } from '../types';

type OperationType = GraphQLInfo['operationType'];

const OPERATION = /^\s*(?:#[^\n]*\n\s*)*(query|mutation|subscription)\b\s*([A-Za-z_]\w*)?/;

function fromOperation(query: unknown, operationName: unknown): GraphQLInfo | null {
  if (typeof query !== 'string' || !query.trim()) return null;
  const match = OPERATION.exec(query);
  // "{ user { id } }" is the shorthand for an anonymous query.
  if (!match && !query.trim().startsWith('{')) return null;
  const type = (match?.[1] as OperationType | undefined) ?? 'query';
  const name = (typeof operationName === 'string' && operationName) || match?.[2] || '';
  return { operationType: type, operationName: name || '(anonymous)' };
}

/**
 * GraphQL operation of a request, or undefined for anything else. All GraphQL calls go to one URL,
 * so the operation name is what tells them apart in the list.
 */
export function graphqlInfo(request: Pick<ApiRequest, 'method' | 'url' | 'requestBody'>): GraphQLInfo | undefined {
  if (request.method === 'GET') {
    if (!request.url.includes('query=')) return undefined;
    try {
      const params = new URL(request.url).searchParams;
      return fromOperation(params.get('query'), params.get('operationName')) ?? undefined;
    } catch {
      return undefined;
    }
  }

  const body = request.requestBody;
  if (typeof body !== 'string' || !body.includes('"query"')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  // A batch is an array of operations: show them all in one label.
  const operations = (Array.isArray(parsed) ? parsed : [parsed])
    .map((item) => (item && typeof item === 'object' ? fromOperation((item as Record<string, unknown>).query, (item as Record<string, unknown>).operationName) : null))
    .filter((item): item is GraphQLInfo => item !== null);
  if (operations.length === 0) return undefined;
  if (operations.length === 1) return operations[0];
  return {
    operationType: operations.some((operation) => operation.operationType === 'mutation') ? 'mutation' : operations[0].operationType,
    operationName: operations.map((operation) => operation.operationName).join(', '),
  };
}

/** Adds `graphql` to a captured request when it is a GraphQL call (the same object otherwise). */
export function withGraphql<T extends ApiRequest>(request: T): T {
  if (request.graphql) return request;
  const graphql = graphqlInfo(request);
  return graphql ? { ...request, graphql } : request;
}
