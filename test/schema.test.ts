import { describe, it, expect } from "vitest";
import { checkSchema, checkInput } from "../src/schema";

describe("checkSchema", () => {
  it("accepts the subset", () => {
    expect(checkSchema({ type: "object", properties: { n: { type: "number", minimum: 0 } }, required: ["n"] })).toBeNull();
    expect(checkSchema({ type: "array", items: { type: "string", maxLength: 10 } })).toBeNull();
    expect(checkSchema({ type: "string", enum: ["a", "b"] })).toBeNull();
  });
  it("rejects outside the subset at declaration time", () => {
    expect(checkSchema({ type: "object", patternProperties: {} })).toMatch(/patternProperties/);
    expect(checkSchema({ oneOf: [] })).toMatch(/type/);
    expect(checkSchema({ type: "null" })).toMatch(/type/);
  });
  it("rejects nesting deeper than 8", () => {
    let node: any = { type: "string" };
    for (let i = 0; i < 9; i++) node = { type: "object", properties: { x: node } };
    expect(checkSchema(node)).toMatch(/depth/);
  });
});

describe("checkInput", () => {
  const s = { type: "object", properties: { n: { type: "integer", minimum: 1, maximum: 5 }, tag: { type: "string", enum: ["a", "b"] } }, required: ["n"] } as const;
  it("accepts valid input", () => expect(checkInput(s as any, { n: 3 })).toBeNull());
  it("rejects missing required", () => expect(checkInput(s as any, {})).toMatch(/n/));
  it("rejects undeclared properties strictly", () => expect(checkInput(s as any, { n: 2, extra: 1 })).toMatch(/extra/));
  it("rejects wrong types, non-integers, bounds, enum misses", () => {
    expect(checkInput(s as any, { n: "3" })).toMatch(/n/);
    expect(checkInput(s as any, { n: 2.5 })).toMatch(/integer/);
    expect(checkInput(s as any, { n: 9 })).toMatch(/maximum/);
    expect(checkInput(s as any, { n: 2, tag: "c" })).toMatch(/enum|tag/);
  });
});
