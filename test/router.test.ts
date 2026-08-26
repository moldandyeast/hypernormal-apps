import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { counterCharter } from "./helpers";

const owner = { Authorization: "Bearer test-owner-key" };

async function mintPublic(charter = counterCharter) {
  const res = await SELF.fetch("https://x/apps", { method: "POST", headers: owner, body: JSON.stringify({ charter }) });
  expect(res.status).toBe(201);
  return ((await res.json()) as any).id as string;
}

describe("router", () => {
  it("mints as owner, 404 as guest when minting closed", async () => {
    expect((await SELF.fetch("https://x/apps", { method: "POST", body: JSON.stringify({ charter: counterCharter }) })).status).toBe(404);
    const id = await mintPublic();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
  it("serves charter JSON to agents and HTML to browsers", async () => {
    const id = await mintPublic();
    const asAgent = await SELF.fetch(`https://x/a/${id}`);
    expect((await asAgent.json() as any).charter.intent).toMatch(/counter/i);
    const asBrowser = await SELF.fetch(`https://x/a/${id}`, { headers: { Accept: "text/html" } });
    expect(asBrowser.headers.get("Content-Type")).toMatch(/text\/html/);
  });
  it("invokes through the router and ignores a spoofed X-Owner", async () => {
    const id = await mintPublic();
    const r = (await (await SELF.fetch(`https://x/a/${id}/rpc/bump`, { method: "POST", body: "{}" })).json()) as any;
    expect(r).toMatchObject({ ok: true, result: 1 });
    const spoof = await SELF.fetch(`https://x/a/${id}/rpc/reset`, { method: "POST", headers: { "X-Owner": "1" }, body: "{}" });
    expect(spoof.status).toBe(404);
  });
  it("visibility: private app 404s for guests, works for owner", async () => {
    const priv = structuredClone(counterCharter) as any; priv.law.visibility = "private";
    const res = await SELF.fetch("https://x/apps", { method: "POST", headers: owner, body: JSON.stringify({ charter: priv }) });
    const id = ((await res.json()) as any).id;
    expect((await SELF.fetch(`https://x/a/${id}`)).status).toBe(404);
    expect((await SELF.fetch(`https://x/a/${id}`, { headers: owner })).status).toBe(200);
  });
  it("client cannot reach /init through the router", async () => {
    const id = await mintPublic();
    expect((await SELF.fetch(`https://x/a/${id}/init`, { method: "POST", body: "{}" })).status).toBe(404);
  });
  it("fork copies within the installation", async () => {
    const id = await mintPublic();
    await SELF.fetch(`https://x/a/${id}/rpc/bump`, { method: "POST", body: "{}" });
    const f = (await (await SELF.fetch(`https://x/a/${id}/fork`, { method: "POST", headers: owner, body: JSON.stringify({ withState: true }) })).json()) as any;
    expect(f.ok).toBe(true);
    const s = (await (await SELF.fetch(`https://x/a/${f.id}/state`)).json()) as any;
    expect(s.state.count).toBe(1);
  });
  it("forks without state by default, leaving the copy empty", async () => {
    const id = await mintPublic();
    await SELF.fetch(`https://x/a/${id}/rpc/bump`, { method: "POST", body: "{}" });
    const f = (await (await SELF.fetch(`https://x/a/${id}/fork`, { method: "POST", headers: owner, body: "{}" })).json()) as any;
    const s = (await (await SELF.fetch(`https://x/a/${f.id}/state`)).json()) as any;
    expect(s.state).toEqual({});
    expect((await (await SELF.fetch(`https://x/a/${f.id}`)).json() as any).charter.intent).toMatch(/counter/i);
  });
  it("amending through the router refreshes the registry's copy of the law", async () => {
    const id = await mintPublic();
    const guestBefore = (await (await SELF.fetch("https://x/apps")).json()) as any;
    expect(guestBefore.apps.some((a: any) => a.id === id)).toBe(false);
    const put = await SELF.fetch(`https://x/a/${id}`, { method: "PUT", headers: owner, body: JSON.stringify({ law: { visibility: "public", allowedHosts: [] } }) });
    expect(put.status).toBe(200);
    const guestAfter = (await (await SELF.fetch("https://x/apps")).json()) as any;
    expect(guestAfter.apps.some((a: any) => a.id === id)).toBe(true);
  });
  it("retiring unregisters the app and stops the URL resolving", async () => {
    const id = await mintPublic();
    expect((await SELF.fetch(`https://x/a/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await SELF.fetch(`https://x/a/${id}`, { method: "DELETE", headers: owner })).status).toBe(200);
    expect((await SELF.fetch(`https://x/a/${id}`)).status).toBe(404);
    const list = (await (await SELF.fetch("https://x/apps", { headers: owner })).json()) as any;
    expect(list.apps.some((a: any) => a.id === id)).toBe(false);
  });
  it("lists public apps for guests, everything for the owner", async () => {
    const pub = structuredClone(counterCharter) as any; pub.law.visibility = "public";
    await SELF.fetch("https://x/apps", { method: "POST", headers: owner, body: JSON.stringify({ charter: pub }) });
    const guestList = (await (await SELF.fetch("https://x/apps")).json()) as any;
    expect(guestList.apps.every((a: any) => a.visibility === "public")).toBe(true);
  });
  it("serves the manual at / and runtime.js", async () => {
    const root = await SELF.fetch("https://x/", { headers: { Accept: "text/markdown" } });
    expect(await root.text()).toMatch(/charter/);
    const rt = await SELF.fetch("https://x/runtime.js");
    expect(rt.headers.get("Content-Type")).toMatch(/javascript/);
  });
  it("serves the real face runtime source, not a stub", async () => {
    const source = await (await SELF.fetch("https://x/runtime.js")).text();
    expect(source).toContain("export function toolsFromCharter");
    expect(source).toContain("export async function connect");
  });
  it("faces: owner registers, guests see public ones, X-Robots and referrer headers set", async () => {
    const id = await mintPublic();
    const put = await SELF.fetch("https://x/f/counter", { method: "PUT", headers: owner, body: JSON.stringify({ title: "Counter", html: "<!doctype html><p>c</p>", targets: [id], visibility: "public" }) });
    expect(put.status).toBe(200);
    const got = await SELF.fetch("https://x/f/counter");
    expect(await got.text()).toMatch(/c/);
    expect(got.headers.get("Referrer-Policy")).toBe("no-referrer");
    const priv = await SELF.fetch("https://x/f/none");
    expect(priv.status).toBe(404);
    expect(priv.headers.get("X-Robots-Tag")).toBe("noindex");
  });
  it("login mints a session cookie for the right key", async () => {
    const res = await SELF.fetch("https://x/login", { method: "POST", body: new URLSearchParams({ key: "test-owner-key" }), redirect: "manual" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Set-Cookie")).toMatch(/__Host-sid=/);
  });
  it("answers OPTIONS with CORS and marks JSON responses", async () => {
    const pre = await SELF.fetch("https://x/apps", { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const res = await SELF.fetch("https://x/health");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
  it("serves an SVG QR of the app's own URL", async () => {
    const id = await mintPublic();
    const qr = await SELF.fetch(`https://x/a/${id}/qr`);
    expect(qr.status).toBe(200);
    expect(qr.headers.get("Content-Type")).toMatch(/image\/svg\+xml/);
    expect(await qr.text()).toMatch(/^<svg/);
  });
  it("gates every route of a private app, not just the landing", async () => {
    const priv = structuredClone(counterCharter) as any; priv.law.visibility = "private";
    const res = await SELF.fetch("https://x/apps", { method: "POST", headers: owner, body: JSON.stringify({ charter: priv }) });
    const id = ((await res.json()) as any).id;
    for (const [path, init] of [
      ["", {}],
      ["/state", {}],
      ["/history", {}],
      ["/export", {}],
      ["/qr", {}],
      ["/rpc/bump", { method: "POST", body: "{}" }],
      ["/ws", { headers: { Upgrade: "websocket" } }],
    ] as [string, RequestInit][]) {
      const r = await SELF.fetch(`https://x/a/${id}${path}`, init);
      expect(r.status, `guest reached /a/:id${path} on a private app`).toBe(404);
    }
    expect((await SELF.fetch(`https://x/a/${id}/state`, { headers: owner })).status).toBe(200);
  });
  it("proxies the WebSocket upgrade and hydrates the watcher from the socket", async () => {
    const id = await mintPublic();
    await SELF.fetch(`https://x/a/${id}/rpc/bump`, { method: "POST", body: "{}" });
    const res = await SELF.fetch(`https://x/a/${id}/ws`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    const messages: any[] = [];
    ws.addEventListener("message", (e: MessageEvent) => { messages.push(JSON.parse(e.data as string)); });
    await new Promise((r) => setTimeout(r, 50));
    expect(messages[0]).toEqual({ type: "state", state: { count: 1 } });
    ws.close();
  });
});
