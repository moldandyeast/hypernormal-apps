export const BUDGET = {
  OPS: 20_000,          // sandbox interrupt checks
  MEMORY: 64 * 1024 * 1024,
  STACK: 512 * 1024,
  INPUT: 64 * 1024,     // bytes of JSON
  RESULT: 256 * 1024,
  STATE: 1024 * 1024,
  CHARTER: 256 * 1024,
  FACE: 512 * 1024,
  SIGNAL: 4 * 1024,
  HISTORY: 10,          // charter versions kept
} as const;

export type Access = "owner" | "public";
export type Visibility = "private" | "unlisted" | "public";

export interface SchemaNode {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

export interface Verb {
  description: string;
  inputSchema: SchemaNode;
  code: string;
  access: Access;
}

export interface Law {
  visibility: Visibility;
  allowedHosts: string[];
}

export interface Charter {
  intent: string;
  verbs: Record<string, Verb>;
  law: Law;
  schedule?: { cron: string; verb: string };
}

export interface Env {
  APP: DurableObjectNamespace;
  REGISTRY: DurableObjectNamespace;
  OWNER_KEY?: string;
  OPEN_MINT?: string;
  WEBMCP_OT_TOKEN?: string;
  PUBLIC_RL?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  LOGIN_RL?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}
