import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";
import { counterCharter } from "./helpers";

const owner = { Authorization: "Bearer test-owner-key" };

// Per-test binding overrides. `env` from cloudflare:test is the same object the
// Worker under test receives, so setting a var here is what this installation's
// operator setting it would be; the original is always put back.
async function withEnv<T>(patch: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const before: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    before[k] = (env as Record<string, unknown>)[k];
    (env as Record<string, unknown>)[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(patch)) {
      if (before[k] === undefined) delete (env as Record<string, unknown>)[k];
      else (env as Record<string, unknown>)[k] = before[k];
    }
  }
}

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
  it("resolves a prototype-chain verb name to an ordinary 404, not a 500", async () => {
    const id = await mintPublic();
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      const res = await SELF.fetch(`https://x/a/${id}/rpc/${name}`, { method: "POST", body: "{}" });
      expect(res.status, name).toBe(404);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/No verb/);
    }
  });
  it("404s raw DO routes that skip registry upkeep: /retire and raw /charter", async () => {
    const id = await mintPublic();
    // The raw retire would reach App.retire without unregistering; forbidden.
    const rawRetire = await SELF.fetch(`https://x/a/${id}/retire`, { method: "POST", headers: owner, body: "{}" });
    expect(rawRetire.status).toBe(404);
    // The raw amend would reach App.amend without refreshing the registry cache.
    const rawCharter = await SELF.fetch(`https://x/a/${id}/charter`, { method: "PUT", headers: owner, body: JSON.stringify({ intent: "x. State is {count}." }) });
    expect(rawCharter.status).toBe(404);
    // /manifest is not a route at all, and unrecognized suffixes 404 too.
    expect((await SELF.fetch(`https://x/a/${id}/manifest`)).status).toBe(404);
    // The app is untouched by any of the above: it still resolves and is unretired.
    expect((await SELF.fetch(`https://x/a/${id}`, { headers: owner })).status).toBe(200);
  });
  it("amending public->private through the proper route drops the app from the public listing", async () => {
    const pub = structuredClone(counterCharter) as any; pub.law.visibility = "public";
    const id = ((await (await SELF.fetch("https://x/apps", { method: "POST", headers: owner, body: JSON.stringify({ charter: pub }) })).json()) as any).id;
    const before = (await (await SELF.fetch("https://x/apps")).json()) as any;
    expect(before.apps.some((a: any) => a.id === id)).toBe(true);
    const put = await SELF.fetch(`https://x/a/${id}`, { method: "PUT", headers: owner, body: JSON.stringify({ law: { visibility: "private", allowedHosts: [] } }) });
    expect(put.status).toBe(200);
    const after = (await (await SELF.fetch("https://x/apps")).json()) as any;
    expect(after.apps.some((a: any) => a.id === id)).toBe(false);
  });
  it("rollback through the router refreshes the registry when it restores visibility", async () => {
    const pub = structuredClone(counterCharter) as any; pub.law.visibility = "public";
    const id = ((await (await SELF.fetch("https://x/apps", { method: "POST", headers: owner, body: JSON.stringify({ charter: pub }) })).json()) as any).id;
    // Amend public -> private: drops it from the public listing, and records the
    // public charter as history version 1.
    await SELF.fetch(`https://x/a/${id}`, { method: "PUT", headers: owner, body: JSON.stringify({ law: { visibility: "private", allowedHosts: [] } }) });
    expect(((await (await SELF.fetch("https://x/apps")).json()) as any).apps.some((a: any) => a.id === id)).toBe(false);
    // Roll back to the public version: the router refreshes the registry, so it lists again.
    const rb = await SELF.fetch(`https://x/a/${id}/rollback`, { method: "POST", headers: owner, body: JSON.stringify({ version: 1 }) });
    expect(rb.status).toBe(200);
    expect(((await (await SELF.fetch("https://x/apps")).json()) as any).apps.some((a: any) => a.id === id)).toBe(true);
  });
  it("forces allowedHosts empty on a guest mint, leaves an owner mint's intact", async () => {
    const withHosts = structuredClone(counterCharter) as any;
    withHosts.law = { visibility: "public", allowedHosts: ["example.com"] };
    // Guest mint under OPEN_MINT: the stored charter must carry no allowedHosts.
    const guestId = await withEnv({ OPEN_MINT: "true" }, async () => {
      const res = await SELF.fetch("https://x/apps", { method: "POST", body: JSON.stringify({ charter: withHosts }) });
      expect(res.status).toBe(201);
      return ((await res.json()) as any).id as string;
    });
    const guestCharter = (await (await SELF.fetch(`https://x/a/${guestId}`)).json()) as any;
    expect(guestCharter.charter.law.allowedHosts).toEqual([]);
    // Owner mint keeps whatever it specified.
    const ownerRes = await SELF.fetch("https://x/apps", { method: "POST", headers: owner, body: JSON.stringify({ charter: withHosts }) });
    const ownerId = ((await ownerRes.json()) as any).id;
    const ownerCharter = (await (await SELF.fetch(`https://x/a/${ownerId}`)).json()) as any;
    expect(ownerCharter.charter.law.allowedHosts).toEqual(["example.com"]);
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
  it("opens minting to guests when this installation says so", async () => {
    const guestMint = () => SELF.fetch("https://x/apps", { method: "POST", body: JSON.stringify({ charter: counterCharter }) });
    const open = await withEnv({ OPEN_MINT: "true" }, guestMint);
    expect(open.status).toBe(201);
    expect(((await open.json()) as any).id).toMatch(/^[0-9a-f]{64}$/);
    // A value that is not exactly "true" leaves minting closed.
    expect((await withEnv({ OPEN_MINT: "1" }, guestMint)).status).toBe(404);
    expect((await guestMint()).status).toBe(404);
  });
  it("injects the origin-trial token into every shape of face document", async () => {
    const token = 'A"B';
    const meta = `<meta http-equiv="origin-trial" content="A&quot;B">`;
    const put = (name: string, body: string) =>
      SELF.fetch(`https://x/f/${name}`, { method: "PUT", headers: owner, body: JSON.stringify({ title: name, html: body, targets: [], visibility: "unlisted" }) });
    await put("withhead", `<!doctype html><html><head><title>t</title></head><body>b</body></html>`);
    await put("doctypeonly", `<!doctype html><p>b</p>`);
    await put("bare", `<p>b</p>`);
    const serve = async (name: string) => (await SELF.fetch(`https://x/f/${name}`)).text();

    await withEnv({ WEBMCP_OT_TOKEN: token }, async () => {
      expect(await serve("withhead")).toContain(`<head>${meta}<title>t</title>`);
      expect(await serve("doctypeonly")).toBe(`<!doctype html>${meta}<p>b</p>`);
      expect(await serve("bare")).toBe(`${meta}<p>b</p>`);
    });
    // No token configured: the face is served exactly as it was written.
    expect(await serve("doctypeonly")).toBe(`<!doctype html><p>b</p>`);
  });
  it("turns a thrown error into the generic error form, with the usual headers", async () => {
    // A key carrying a newline throws inside the Headers constructor on the way
    // to the bearer comparison: an unauthenticated caller reaching the boundary.
    const res = await SELF.fetch("https://x/login", { method: "POST", body: new URLSearchParams({ key: "a\nb" }) });
    expect(res.status).toBe(500);
    // The boundary is reachable without credentials, so it must not echo the
    // internal error string: it returns a fixed generic message (and logs the
    // real one). The security headers still ride, through the same finalize path.
    expect((await res.json()) as any).toEqual({ ok: false, error: "internal error" });
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
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

describe("home face at /", () => {
  it("serves the manual when no home face exists, and the stored home face once registered", async () => {
    const asBrowser = { Accept: "text/html" };
    const before = await SELF.fetch("https://x/", { headers: asBrowser });
    expect(await before.text()).toMatch(/manual|Hypernormal/);
    const put = await SELF.fetch("https://x/f/home", {
      method: "PUT",
      headers: owner,
      body: JSON.stringify({ title: "Home", html: "<!doctype html><h1>site-face-marker</h1>", targets: [], visibility: "public" }),
    });
    expect(put.status).toBe(200);
    const after = await SELF.fetch("https://x/", { headers: asBrowser });
    expect(await after.text()).toMatch(/site-face-marker/);
    // Agents (no text/html in Accept) still get the markdown manual.
    const agent = await SELF.fetch("https://x/");
    expect(agent.headers.get("Content-Type")).toMatch(/text\/markdown/);
    expect(await agent.text()).not.toMatch(/site-face-marker/);
    // Clean up so other tests' GET / expectations are unaffected.
    await SELF.fetch("https://x/f/home", { method: "DELETE", headers: owner });
  });
});
