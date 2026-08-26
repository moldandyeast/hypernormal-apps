import type { SchemaNode } from "./types";

const TYPES = ["object", "string", "number", "integer", "boolean", "array"];
const KEYS: Record<string, string[]> = {
  object: ["type", "description", "properties", "required"],
  array: ["type", "description", "items"],
  string: ["type", "description", "enum", "minLength", "maxLength"],
  number: ["type", "description", "enum", "minimum", "maximum"],
  integer: ["type", "description", "enum", "minimum", "maximum"],
  boolean: ["type", "description"],
};

export function checkSchema(node: unknown, depth = 0): string | null {
  if (depth > 8) return "schema nesting depth exceeds 8";
  if (typeof node !== "object" || node === null || Array.isArray(node)) return "schema node must be an object";
  const n = node as Record<string, unknown>;
  if (typeof n.type !== "string" || !TYPES.includes(n.type)) return `schema type must be one of ${TYPES.join(", ")}`;
  for (const k of Object.keys(n)) {
    if (!KEYS[n.type as string].includes(k)) return `schema key "${k}" is outside the subset for type ${n.type}`;
  }
  if (n.type === "object") {
    if (n.properties !== undefined) {
      if (typeof n.properties !== "object" || n.properties === null || Array.isArray(n.properties)) return "properties must be an object";
      for (const [k, v] of Object.entries(n.properties)) {
        const err = checkSchema(v, depth + 1);
        if (err) return `properties.${k}: ${err}`;
      }
    }
    if (n.required !== undefined) {
      if (!Array.isArray(n.required) || n.required.some((r) => typeof r !== "string")) return "required must be a list of strings";
      const props = (n.properties as Record<string, unknown>) ?? {};
      for (const r of n.required) if (!(r in props)) return `required "${r}" is not a declared property`;
    }
  }
  if (n.type === "array") {
    if (n.items === undefined) return "array schema needs items";
    const err = checkSchema(n.items, depth + 1);
    if (err) return `items: ${err}`;
  }
  return null;
}

export function checkInput(schema: SchemaNode, input: unknown): string | null {
  return check(schema, input, "input");
}

function check(s: SchemaNode, v: unknown, path: string): string | null {
  switch (s.type) {
    case "object": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return `${path} must be an object`;
      const obj = v as Record<string, unknown>;
      const props = s.properties ?? {};
      for (const k of Object.keys(obj)) if (!(k in props)) return `${path}.${k} is not declared; undeclared properties are rejected`;
      for (const r of s.required ?? []) if (!(r in obj)) return `${path}.${r} is required`;
      for (const [k, sub] of Object.entries(props)) {
        if (k in obj) { const err = check(sub, obj[k], `${path}.${k}`); if (err) return err; }
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(v)) return `${path} must be an array`;
      for (let i = 0; i < v.length; i++) { const err = check(s.items as SchemaNode, v[i], `${path}[${i}]`); if (err) return err; }
      return null;
    }
    case "string": {
      if (typeof v !== "string") return `${path} must be a string`;
      if (s.minLength !== undefined && v.length < s.minLength) return `${path} is shorter than minLength ${s.minLength}`;
      if (s.maxLength !== undefined && v.length > s.maxLength) return `${path} is longer than maxLength ${s.maxLength}`;
      if (s.enum && !s.enum.includes(v)) return `${path} must be one of the enum values`;
      return null;
    }
    case "number":
    case "integer": {
      if (typeof v !== "number" || Number.isNaN(v)) return `${path} must be a number`;
      if (s.type === "integer" && !Number.isInteger(v)) return `${path} must be an integer`;
      if (s.minimum !== undefined && v < s.minimum) return `${path} is below minimum ${s.minimum}`;
      if (s.maximum !== undefined && v > s.maximum) return `${path} is above maximum ${s.maximum}`;
      if (s.enum && !s.enum.includes(v)) return `${path} must be one of the enum values`;
      return null;
    }
    case "boolean":
      return typeof v === "boolean" ? null : `${path} must be a boolean`;
  }
}
