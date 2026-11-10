export interface OpenApiSchema {
  /** A single type, or a list of types in OpenAPI 3.1 (`["string", "null"]`). */
  type?: string | string[];
  format?: string;
  nullable?: boolean;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  /** A boolean in OpenAPI 3.0 (modifies minimum / maximum), a number in 3.1. */
  exclusiveMinimum?: boolean | number;
  exclusiveMaximum?: boolean | number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  additionalProperties?: boolean | OpenApiSchema;
  allOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  not?: OpenApiSchema;
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  $ref?: string;
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  schema?: OpenApiSchema;
  $ref?: string;
}

export interface OpenApiMediaTypes { content?: Record<string, { schema?: OpenApiSchema }>; $ref?: string }
export interface OpenApiRequestBody extends OpenApiMediaTypes { required?: boolean }

export interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiMediaTypes>;
}

export interface OpenApiDocument {
  openapi?: string;
  servers?: Array<{ url?: string }>;
  /** Operations by HTTP method; a path item may also carry `parameters` shared by its operations. */
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
    parameters?: Record<string, OpenApiParameter>;
    responses?: Record<string, OpenApiMediaTypes>;
    requestBodies?: Record<string, OpenApiRequestBody>;
  };
  /** External documents inlined by bundleExternalRefs(); `$ref`s point here after bundling. */
  "x-external"?: Record<string, unknown>;
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
