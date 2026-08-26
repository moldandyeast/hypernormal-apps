import { describe, it, expect } from "vitest";
import { toolsFromCharter } from "../face/runtime.js";

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
