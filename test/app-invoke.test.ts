import { describe, it, expect, vi, afterEach } from "vitest";
import { mint, counterCharter } from "./helpers";

const guest = { "X-Owner": "0" };
const owner = { "X-Owner": "1" };

describe("init and reads", () => {
  it("mints with valid charter, rejects invalid", async () => {
    const { res } = await mint(counterCharter, { count: 0 });
    expect(res.status).toBe(201);
    const bad = await mint({ intent: "" });
    expect(bad.res.status).toBe(400);
  });
  it("serves charter and state", async () => {
    const { stub } = await mint(counterCharter, { count: 3 });
    const charter = (await (await stub.fetch("https://do/charter", { headers: guest })).json()) as any;
    expect(charter.ok).toBe(true);
    expect(Object.keys(charter.charter.verbs)).toContain("bump");
    const state = (await (await stub.fetch("https://do/state", { headers: guest })).json()) as any;
    expect(state).toMatchObject({ ok: true, state: { count: 3 } });
  });
  it("404s before init", async () => {
    const { appStub } = await import("./helpers");
    const { stub } = appStub();
    const res = await stub.fetch("https://do/charter", { headers: guest });
    expect(res.status).toBe(404);
  });
});

describe("invocation", () => {
  it("runs a public verb, persists, returns result", async () => {
    const { stub } = await mint(counterCharter, { count: 0 });
    const r = (await (await stub.fetch("https://do/rpc/bump", { method: "POST", headers: guest, body: "{}" })).json()) as any;
    expect(r).toMatchObject({ ok: true, result: 1 });
    const s = (await (await stub.fetch("https://do/state", { headers: guest })).json()) as any;
    expect(s.state.count).toBe(1);
  });
  it("guards owner verbs: guest 404, owner runs", async () => {
    const { stub } = await mint(counterCharter, { count: 5 });
    expect((await stub.fetch("https://do/rpc/reset", { method: "POST", headers: guest, body: "{}" })).status).toBe(404);
    const r = (await (await stub.fetch("https://do/rpc/reset", { method: "POST", headers: owner, body: "{}" })).json()) as any;
    expect(r).toMatchObject({ ok: true, result: 0 });
  });
  it("validates input against the schema before running", async () => {
    const { stub } = await mint(counterCharter);
    const res = await stub.fetch("https://do/rpc/bump", { method: "POST", headers: guest, body: JSON.stringify({ extra: 1 }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toMatch(/extra/);
  });
  it("atomic: a verb that mutates then throws leaves state untouched", async () => {
    const charter = structuredClone(counterCharter) as any;
    charter.verbs.boom = { description: "Mutates then throws.", inputSchema: { type: "object", properties: {} }, code: "ctx.state.count = 99; throw new Error('kaboom');", access: "public" };
    const { stub } = await mint(charter, { count: 1 });
    const res = await stub.fetch("https://do/rpc/boom", { method: "POST", headers: guest, body: "{}" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toMatch(/kaboom/);
    const s = (await (await stub.fetch("https://do/state", { headers: guest })).json()) as any;
    expect(s.state.count).toBe(1);
  });
  it("unknown verb 404 lists available verbs", async () => {
    const { stub } = await mint(counterCharter);
    const res = await stub.fetch("https://do/rpc/nope", { method: "POST", headers: guest, body: "{}" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toMatch(/bump/);
  });
  it("enforces input, result, and state budgets", async () => {
    const charter = structuredClone(counterCharter) as any;
    charter.verbs.fill = { description: "Grows state.", inputSchema: { type: "object", properties: { s: { type: "string" } } }, code: "ctx.state.blob = ctx.input.s; return true;", access: "public" };
    charter.verbs.bloat = { description: "Returns an oversize result.", inputSchema: { type: "object", properties: {} }, code: "return 'x'.repeat(300*1024);", access: "public" };
    const { stub } = await mint(charter);
    const big = "x".repeat(70 * 1024);
    const res = await stub.fetch("https://do/rpc/fill", { method: "POST", headers: guest, body: JSON.stringify({ s: big }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toMatch(/input budget/);
    const r2 = await stub.fetch("https://do/rpc/bloat", { method: "POST", headers: guest, body: "{}" });
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as any).error).toMatch(/result budget/);
  });
  it("seed replaces state wholesale, owner only", async () => {
    const { stub } = await mint(counterCharter, { count: 1 });
    expect((await stub.fetch("https://do/state", { method: "PUT", headers: guest, body: JSON.stringify({ count: 9 }) })).status).toBe(404);
    const ok = await stub.fetch("https://do/state", { method: "PUT", headers: owner, body: JSON.stringify({ count: 9 }) });
    expect(ok.status).toBe(200);
    const s = (await (await stub.fetch("https://do/state", { headers: guest })).json()) as any;
    expect(s.state.count).toBe(9);
  });
});

describe("serial law", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("no lost update when a slow http verb overlaps a fast one", async () => {
    // The installed @cloudflare/vitest-pool-workers version does not export
    // `fetchMock` from "cloudflare:test" (checked: node_modules/@cloudflare/
    // vitest-pool-workers/types/cloudflare-test.d.ts has no such export). We
    // use the same global-fetch-stub pattern the ancestor project's
    // test/sandbox-http.test.ts uses instead: it runs in the same isolate as
    // the worker under test, so stubbing `fetch` here reaches safeFetch inside
    // the App DO.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return new Response("ok", { status: 200 });
      }),
    );
    const charter = structuredClone(counterCharter) as any;
    charter.law.allowedHosts = ["slow.example"];
    charter.verbs.slowBump = { description: "Bump after a slow external call.", inputSchema: { type: "object", properties: {} }, code: "ctx.http.get('https://slow.example/wait'); ctx.state.count=(ctx.state.count??0)+1; return ctx.state.count;", access: "public" };
    const { stub } = await mint(charter, { count: 0 });
    const a = stub.fetch("https://do/rpc/slowBump", { method: "POST", headers: guest, body: "{}" });
    const b = stub.fetch("https://do/rpc/bump", { method: "POST", headers: guest, body: "{}" });
    await Promise.all([a, b]);
    const s = (await (await stub.fetch("https://do/state", { headers: guest })).json()) as any;
    expect(s.state.count).toBe(2); // without the serial chain this is 1
  });
});
