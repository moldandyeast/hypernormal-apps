import { BUDGET, type Charter, type Verb } from "./types";
import { checkSchema } from "./schema";
import { nextCronTime } from "./schedule";

export const VERB_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
// Names that match VERB_NAME but resolve to Object.prototype members, so a
// verb carrying one would be reachable through the prototype chain by callers
// who never authored it and would let a JSON `__proto__` key pollute the verb
// map. Rejected uniformly at mint and amend.
const RESERVED_VERB_NAMES = ["__proto__", "constructor", "prototype"];
export const VISIBILITIES = ["private", "unlisted", "public"];
const ACCESSES = ["owner", "public"];

export function checkCharter(c: unknown): string | null {
  if (typeof c !== "object" || c === null) return "charter must be a JSON object";
  const ch = c as Record<string, unknown>;
  if (typeof ch.intent !== "string" || ch.intent.trim() === "") return "intent (non-empty prose) is required";
  if (typeof ch.verbs !== "object" || ch.verbs === null || Array.isArray(ch.verbs)) return "verbs (object mapping name to verb) is required";
  for (const [name, v] of Object.entries(ch.verbs as Record<string, unknown>)) {
    if (!VERB_NAME.test(name)) return `verb name "${name}" must match ${VERB_NAME}`;
    if (RESERVED_VERB_NAMES.includes(name)) return `verb name "${name}" is reserved and cannot be used`;
    const err = checkVerb(v);
    if (err) return `verbs.${name}: ${err}`;
  }
  const law = ch.law as Record<string, unknown> | undefined;
  if (!law || typeof law !== "object") return "law {visibility, allowedHosts} is required";
  if (!VISIBILITIES.includes(law.visibility as string)) return `law.visibility must be one of ${VISIBILITIES.join(", ")}`;
  if (!Array.isArray(law.allowedHosts) || law.allowedHosts.some((h) => typeof h !== "string")) return "law.allowedHosts must be a list of hostnames";
  if (ch.schedule !== undefined) {
    const s = ch.schedule as Record<string, unknown>;
    if (typeof s.cron !== "string" || typeof s.verb !== "string" || !Object.prototype.hasOwnProperty.call(ch.verbs, s.verb))
      return "schedule must be {cron, verb} naming an existing verb";
    try {
      nextCronTime(s.cron, Date.now());
    } catch {
      return "schedule.cron is not a valid cron expression";
    }
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
    if (typeof p.verbs !== "object" || p.verbs === null || Array.isArray(p.verbs)) return { error: "verbs must be an object; null value deletes a verb" };
    for (const [name, v] of Object.entries(p.verbs as Record<string, unknown>)) {
      // Own-property-safe merge: a literal `next.verbs["__proto__"] = v` would
      // invoke Object.prototype's __proto__ setter and silently pollute the map
      // instead of adding a verb. defineProperty sets a real own property, so a
      // reserved name survives as data and is rejected by checkCharter below
      // rather than vanishing into the prototype; the delete path only touches
      // own properties for the same reason.
      if (v === null) {
        if (Object.prototype.hasOwnProperty.call(next.verbs, name)) delete next.verbs[name];
      } else {
        Object.defineProperty(next.verbs, name, { value: v as Verb, writable: true, enumerable: true, configurable: true });
      }
    }
  }
  const err = checkCharter(next);
  if (err) return { error: err };
  return { charter: next };
}

export function byteLength(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}
