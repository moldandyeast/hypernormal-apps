import { BUDGET, type Charter, type Verb } from "./types";
import { checkSchema } from "./schema";

export const VERB_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const VISIBILITIES = ["private", "unlisted", "public"];
const ACCESSES = ["owner", "public"];

export function checkCharter(c: unknown): string | null {
  if (typeof c !== "object" || c === null) return "charter must be a JSON object";
  const ch = c as Record<string, unknown>;
  if (typeof ch.intent !== "string" || ch.intent.trim() === "") return "intent (non-empty prose) is required";
  if (typeof ch.verbs !== "object" || ch.verbs === null) return "verbs (object of name to verb) is required";
  for (const [name, v] of Object.entries(ch.verbs as Record<string, unknown>)) {
    if (!VERB_NAME.test(name)) return `verb name "${name}" must match ${VERB_NAME}`;
    const err = checkVerb(v);
    if (err) return `verbs.${name}: ${err}`;
  }
  const law = ch.law as Record<string, unknown> | undefined;
  if (!law || typeof law !== "object") return "law {visibility, allowedHosts} is required";
  if (!VISIBILITIES.includes(law.visibility as string)) return `law.visibility must be one of ${VISIBILITIES.join(", ")}`;
  if (!Array.isArray(law.allowedHosts) || law.allowedHosts.some((h) => typeof h !== "string")) return "law.allowedHosts must be a list of hostnames";
  if (ch.schedule !== undefined) {
    const s = ch.schedule as Record<string, unknown>;
    if (typeof s.cron !== "string" || typeof s.verb !== "string" || !(s.verb in (ch.verbs as object)))
      return "schedule must be {cron, verb} naming an existing verb";
  }
  if (byteLength(c) > BUDGET.CHARTER) return `charter budget exceeded: ${byteLength(c)} > ${BUDGET.CHARTER} bytes`;
  return null;
}

function checkVerb(v: unknown): string | null {
  if (typeof v !== "object" || v === null) return "must be an object";
  const verb = v as Record<string, unknown>;
  if (typeof verb.description !== "string" || verb.description.trim() === "") return "description is required";
  if (typeof verb.code !== "string" || verb.code.trim() === "") return "code is required";
  if (!ACCESSES.includes(verb.access as string)) return `access must be one of ${ACCESSES.join(", ")}`;
  const err = checkSchema(verb.inputSchema);
  if (err) return `inputSchema: ${err}`;
  return null;
}

export function applyAmendment(current: Charter, patch: unknown): { charter: Charter } | { error: string } {
  if (typeof patch !== "object" || patch === null) return { error: "amendment must be a JSON object" };
  const p = patch as Record<string, unknown>;
  const next: Charter = structuredClone(current);
  if (p.intent !== undefined) next.intent = p.intent as string;
  if (p.law !== undefined) next.law = p.law as Charter["law"];
  if (p.schedule !== undefined) next.schedule = (p.schedule ?? undefined) as Charter["schedule"];
  if (p.verbs !== undefined) {
    if (typeof p.verbs !== "object" || p.verbs === null) return { error: "verbs must be an object; null value deletes a verb" };
    for (const [name, v] of Object.entries(p.verbs as Record<string, unknown>)) {
      if (v === null) delete next.verbs[name];
      else next.verbs[name] = v as Verb;
    }
  }
  const err = checkCharter(next);
  if (err) return { error: err };
  return { charter: next };
}

export function byteLength(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}
