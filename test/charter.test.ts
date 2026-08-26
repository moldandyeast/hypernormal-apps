import { describe, it, expect } from "vitest";
import { checkCharter, applyAmendment } from "../src/charter";

const good = {
  intent: "A counter. State is {count: number}. bump adds one and returns the new count.",
  verbs: { bump: { description: "Add one to the count.", inputSchema: { type: "object", properties: {} }, code: "ctx.state.count=(ctx.state.count??0)+1; return ctx.state.count;", access: "public" } },
  law: { visibility: "unlisted", allowedHosts: [] },
};

describe("checkCharter", () => {
  it("accepts a complete charter", () => expect(checkCharter(good)).toBeNull());
  it("rejects empty intent, bad verb names, bad access, bad visibility, bad schema, oversize", () => {
    expect(checkCharter({ ...good, intent: "" })).toMatch(/intent/);
    expect(checkCharter({ ...good, verbs: { "has.dot": good.verbs.bump } })).toMatch(/name/);
    expect(checkCharter({ ...good, verbs: { bump: { ...good.verbs.bump, access: "root" } } })).toMatch(/access/);
    expect(checkCharter({ ...good, law: { visibility: "secret", allowedHosts: [] } })).toMatch(/visibility/);
    expect(checkCharter({ ...good, verbs: { bump: { ...good.verbs.bump, inputSchema: { oneOf: [] } } } })).toMatch(/type/);
    expect(checkCharter({ ...good, intent: "x".repeat(300 * 1024) })).toMatch(/charter budget/);
  });
  it("rejects a schedule naming a missing verb", () => {
    expect(checkCharter({ ...good, schedule: { cron: "0 * * * *", verb: "nope" } })).toMatch(/schedule/);
  });
  it("rejects a schedule with a malformed cron expression", () => {
    expect(checkCharter({ ...good, schedule: { cron: "not a cron", verb: "bump" } })).toMatch(/cron/);
  });
  it("rejects verbs as array (must be object)", () => {
    expect(checkCharter({ ...good, verbs: [{ description: "d", inputSchema: { type: "object", properties: {} }, code: "return 1;", access: "public" }] })).toMatch(/verbs/);
  });
});

describe("applyAmendment", () => {
  it("merges verbs by name and null deletes", () => {
    const out = applyAmendment(good as any, { verbs: { bump: null, tick: good.verbs.bump } });
    expect("charter" in out && Object.keys(out.charter.verbs)).toEqual(["tick"]);
  });
  it("replaces intent and law when present, validates the result", () => {
    const out = applyAmendment(good as any, { law: { visibility: "public", allowedHosts: [] } });
    expect("charter" in out && out.charter.law.visibility).toBe("public");
    expect("error" in applyAmendment(good as any, { intent: "" })).toBe(true);
  });
});
