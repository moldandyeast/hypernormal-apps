import { describe, it, expect } from "vitest";
import { toolsFromCharter, mayRegisterTools } from "../face/runtime.js";

const charter = {
  intent: "x",
  verbs: {
    add: { description: "Add an item.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, code: "...", access: "public" },
    wipe: { description: "Owner only.", inputSchema: { type: "object", properties: {} }, code: "...", access: "owner" },
  },
  law: { visibility: "public", allowedHosts: [] },
};

describe("toolsFromCharter", () => {
  it("maps public verbs only, mechanically, with untrusted output annotation", () => {
    const calls: any[] = [];
    const tools = toolsFromCharter(charter, (name, input) => { calls.push([name, input]); return Promise.resolve("done"); });
    expect(tools).toHaveLength(1);
    const t = tools[0];
    expect(t.name).toBe("add");
    expect(t.description).toBe("Add an item.");
    expect(t.inputSchema).toEqual(charter.verbs.add.inputSchema);
    expect(t.annotations).toEqual({ untrustedContentHint: true });
    return t.execute({ text: "hi" }).then(() => expect(calls).toEqual([["add", { text: "hi" }]]));
  });
});

describe("mayRegisterTools", () => {
  it("allows a same-origin app by default", () => {
    expect(mayRegisterTools("https://install.com/a/1", "https://install.com")).toBe(true);
    expect(mayRegisterTools("/a/1", "https://install.com")).toBe(true);
  });

  it("blocks a cross-origin app by default", () => {
    expect(mayRegisterTools("https://evil.com/a/1", "https://install.com")).toBe(false);
  });

  it("allows a cross-origin app when explicitly opted in", () => {
    expect(mayRegisterTools("https://evil.com/a/1", "https://install.com", { tools: "cross-origin" })).toBe(true);
  });

  it("allows a same-origin app when explicitly opted in to cross-origin", () => {
    expect(mayRegisterTools("https://install.com/a/1", "https://install.com", { tools: "cross-origin" })).toBe(true);
  });

  it("blocks any app when tools: false, even same-origin", () => {
    expect(mayRegisterTools("https://install.com/a/1", "https://install.com", { tools: false })).toBe(false);
    expect(mayRegisterTools("https://evil.com/a/1", "https://install.com", { tools: false })).toBe(false);
  });

  it("fails closed when there is no trusted document origin", () => {
    expect(mayRegisterTools("https://install.com/a/1", null)).toBe(false);
    expect(mayRegisterTools("https://install.com/a/1", undefined)).toBe(false);
  });

  it("fails closed on an unparseable app URL", () => {
    expect(mayRegisterTools("http://", "https://install.com")).toBe(false);
  });
});
