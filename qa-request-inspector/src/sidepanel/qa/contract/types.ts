export interface OpenApiSchema {
  type?: string;
  format?: string;
  nullable?: boolean;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  additionalProperties?: boolean | OpenApiSchema;
  $ref?: string;
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  schema?: OpenApiSchema;
}

export interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: OpenApiSchema }> };
  responses?: Record<string, { content?: Record<string, { schema?: OpenApiSchema }> }>;
}

export interface OpenApiDocument {
  openapi?: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

export interface ContractViolation {
  location: "request" | "response";
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface MatchedEndpoint {
  pathTemplate: string;
  operation: OpenApiOperation;
}
