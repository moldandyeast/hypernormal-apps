import { describe, it, expect } from "vitest";
import { mint, counterCharter } from "./helpers";

const owner = { "X-Owner": "1" };
const guest = { "X-Owner": "0" };

describe("amend", () => {
  it("patches, records history, broadcasts nothing yet, guest 404", async () => {
    const { stub } = await mint(counterCharter);
    expect((await stub.fetch("https://do/charter", { method: "PUT", headers: guest, body: "{}" })).status).toBe(404);
    const res = await stub.fetch("https://do/charter", { method: "PUT", headers: owner, body: JSON.stringify({ intent: "Counter, second edition. State is {count}." }) });
    expect(res.status).toBe(200);
    const h = (await (await stub.fetch("https://do/history", { headers: guest })).json()) as any;
    expect(h.history).toHaveLength(1);
    expect(h.history[0].version).toBe(1);
    expect(h.history[0].charter.intent).toMatch(/A counter/);
  });
  it("rejects a patch that fails validation, state and charter untouched", async () => {
    const { stub } = await mint(counterCharter);
    const res = await stub.fetch("https://do/charter", { method: "PUT", headers: owner, body: JSON.stringify({ intent: "" }) });
    expect(res.status).toBe(400);
    const c = (await (await stub.fetch("https://do/charter", { headers: guest })).json()) as any;
    expect(c.charter.intent).toMatch(/A counter/);
  });
  it("caps history at the budget without renumbering", async () => {
    const { stub } = await mint(counterCharter);
    for (let i = 0; i < 12; i++) {
      await stub.fetch("https://do/charter", { method: "PUT", headers: owner, body: JSON.stringify({ intent: `Edition ${i}. State is {count}.` }) });
    }
    const h = (await (await stub.fetch("https://do/history", { headers: guest })).json()) as any;
    expect(h.history).toHaveLength(10);
    expect(h.history[0].version).toBe(3);
    expect(h.history[9].version).toBe(12);
  });
});

describe("rollback", () => {
  it("restores a version and records the replaced charter", async () => {
    const { stub } = await mint(counterCharter);
    await stub.fetch("https://do/charter", { method: "PUT", headers: owner, body: JSON.stringify({ intent: "Edition 2. State is {count}." }) });
    const res = await stub.fetch("https://do/rollback", { method: "POST", headers: owner, body: JSON.stringify({ version: 1 }) });
    expect(res.status).toBe(200);
    const c = (await (await stub.fetch("https://do/charter", { headers: guest })).json()) as any;
    expect(c.charter.intent).toMatch(/A counter/);
    const h = (await (await stub.fetch("https://do/history", { headers: guest })).json()) as any;
    expect(h.history.at(-1).charter.intent).toMatch(/Edition 2/);
  });
  it("404s an unknown version listing versions", async () => {
    const { stub } = await mint(counterCharter);
    const res = await stub.fetch("https://do/rollback", { method: "POST", headers: owner, body: JSON.stringify({ version: 99 }) });
    expect(res.status).toBe(404);
  });
});

describe("export and retire", () => {
  it("exports {charter, state}; mint accepts exactly that shape", async () => {
    const { stub } = await mint(counterCharter, { count: 7 });
    const ex = (await (await stub.fetch("https://do/export", { headers: guest })).json()) as any;
    expect(ex.ok).toBe(true);
    const again = await mint(ex.export.charter, ex.export.state);
    expect(again.res.status).toBe(201);
    const s = (await (await again.stub.fetch("https://do/state", { headers: guest })).json()) as any;
    expect(s.state.count).toBe(7);
  });
  it("retire deletes everything; the URL stops resolving", async () => {
    const { stub } = await mint(counterCharter);
    expect((await stub.fetch("https://do/retire", { method: "POST", headers: owner })).status).toBe(200);
    expect((await stub.fetch("https://do/charter", { headers: guest })).status).toBe(404);
  });
});
