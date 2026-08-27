import type { Charter, Env } from "./types";
import { isOwner, mintSession, clearSession } from "./auth";
import { checkCharter } from "./charter";
import { manualMarkdown, manualHtml, landingHtml, loginHtml, escapeHtml } from "./pages";
import { qrSvg } from "./qr";
import runtimeSource from "./runtime-source.txt";

export { App } from "./app";
export { Registry } from "./registry";

// The Worker is the only place that decides who the caller is. It computes
// `owner` once per request from the credentials, then hands that verdict to the
// Durable Objects on a header it always overwrites — a client-supplied X-Owner
// never survives this file. Visibility is decided here too: the App DO has no
// idea what law.visibility means, so the router reads the charter first and
// answers 404 before forwarding anything a caller may not see.

const APP_ID = /^[0-9a-f]{64}$/;
const FACE_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const INDEX_MARK = "X-HN-Index";

// Derived interfaces run from anywhere — a local file, a sandboxed preview,
// another host — so the JSON surface allows any origin. Authorization is the
// owner key and the app's law, never the origin.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const json = (body: unknown, status = 200) => Response.json(body, { status });
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
const svg = (body: string) =>
  new Response(body, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
const gone = (error = "Nothing lives at this URL.") => json({ ok: false, error }, 404);

// Mark a response as safe to index. Everything else gets X-Robots-Tag: noindex,
// so an unlisted link — which is the only credential a guest ever holds — stays
// out of search engines. The marker is internal and stripped in finalize().
function indexable(res: Response): Response {
  res.headers.set(INDEX_MARK, "1");
  return res;
}

// Applied to every response. Referrer-Policy so a click out of a face never
// leaks the app's (possibly secret) URL; noindex unless the response opted in;
// CORS on everything that is not a served HTML document. WebSocket upgrades
// pass through untouched — rebuilding a 101 would drop the socket.
function finalize(res: Response, indexed: boolean): Response {
  if (res.webSocket || res.status === 101) return res;
  const headers = new Headers(res.headers);
  headers.delete(INDEX_MARK);
  headers.set("Referrer-Policy", "no-referrer");
  if (!indexed) headers.set("X-Robots-Tag", "noindex");
  if (!(headers.get("Content-Type") ?? "").includes("text/html")) {
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const registry = (env: Env) => env.REGISTRY.get(env.REGISTRY.idFromName("registry"));

function wantsHtml(request: Request): boolean {
  return (request.headers.get("Accept") ?? "").includes("text/html");
}

async function limited(binding: Env["PUBLIC_RL"], key: string): Promise<boolean> {
  if (!binding) return false; // no limiter on this plan: the deployment still works
  const { success } = await binding.limit({ key });
  return !success;
}

// Forward to an App DO with the router's own verdict on the caller. Building a
// fresh Request from the incoming headers and then setting X-Owner is what makes
// a spoofed header harmless: whatever arrived is overwritten, every time.
async function toApp(stub: DurableObjectStub, path: string, request: Request, owner: boolean): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set("X-Owner", owner ? "1" : "0");
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.text() : undefined;
  return stub.fetch(new Request(`https://do${path}`, { method: request.method, headers, body }));
}

// An internal, fully-trusted read of a charter. Called as the owner whoever the
// caller is, because the router needs law.visibility to decide what the caller
// may see at all.
async function readCharter(stub: DurableObjectStub): Promise<Charter | null> {
  const res = await stub.fetch(new Request("https://do/charter", { headers: { "X-Owner": "1" } }));
  if (!res.ok) return null;
  return ((await res.json()) as { charter: Charter }).charter;
}

async function register(env: Env, id: string, charter: Charter): Promise<void> {
  await registry(env).fetch(new Request("https://do/apps/register", {
    method: "POST",
    body: JSON.stringify({ id, intent: charter.intent.slice(0, 140), visibility: charter.law.visibility }),
  }));
}

// Mint: the one act that creates an app. The charter is validated here so a bad
// charter never costs a Durable Object; the DO validates it again on init.
async function mintApp(env: Env, origin: string, charter: unknown, state: unknown, forceNoHosts = false): Promise<Response> {
  const invalid = checkCharter(charter);
  if (invalid) return json({ ok: false, error: invalid }, 400);
  // A guest mint (permitted only because OPEN_MINT is on) authors the whole
  // charter, law.allowedHosts included, and ctx.http would then give an
  // anonymous author GET/POST to any host they named — an open HTTPS proxy
  // attributable to this installation's Cloudflare account. Force it empty; the
  // owner can always amend it afterward. An owner's own mint is left untouched.
  if (forceNoHosts) (charter as Charter).law.allowedHosts = [];
  const objectId = env.APP.newUniqueId();
  const id = objectId.toString();
  const init = await env.APP.get(objectId).fetch(new Request("https://do/init", {
    method: "POST",
    headers: { "X-Owner": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ charter, state }),
  }));
  if (!init.ok) return init;
  await register(env, id, charter as Charter);
  return json({ ok: true, id, url: `${origin}/a/${id}` }, 201);
}

// Chrome's origin trial token has to reach the document as a meta tag, and a
// face is written by whoever wrote it — so the router injects the tag rather
// than asking every face to remember.
function withOriginTrial(document: string, token: string): string {
  const meta = `<meta http-equiv="origin-trial" content="${escapeHtml(token)}">`;
  const head = document.match(/<head[^>]*>/i);
  if (head) {
    const at = (head.index ?? 0) + head[0].length;
    return document.slice(0, at) + meta + document.slice(at);
  }
  const doctype = document.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) return document.slice(0, doctype[0].length) + meta + document.slice(doctype[0].length);
  return meta + document;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let res: Response;
    try {
      res = await handle(request, env);
    } catch (e) {
      // A throw that escapes handle() would otherwise leave workerd to answer
      // with a raw 500: no error form, no CORS, and none of the headers
      // finalize() exists to guarantee. Reachable without credentials — a
      // header value carrying a newline throws inside the Headers constructor,
      // and the sandbox can fail through its own WASM teardown rather than
      // resolving — so the boundary is a route like any other. Log the real
      // error so the operator can debug it in `wrangler tail` (this is the one
      // place an internal failure surfaces), and return a fixed generic message:
      // the boundary is unauthenticated, so it must never echo e.message.
      console.error(e);
      res = json({ ok: false, error: "internal error" }, 500);
    }
    return finalize(res, res.headers.get(INDEX_MARK) === "1");
  },
};

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Answered before anything else, and before any credential is read: a
  // preflight carries none.
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const owner = await isOwner(request, env);

  if (method === "GET" && path === "/health") return json({ ok: true });

  if (method === "GET" && path === "/runtime.js") {
    return new Response(runtimeSource, {
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  }

  if (path === "/login") {
    if (method === "GET") {
      if (owner) return new Response(null, { status: 303, headers: { Location: "/" } });
      return html(loginHtml(false));
    }
    if (method === "POST") {
      if (await limited(env.LOGIN_RL, `login:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`)) {
        return json({ ok: false, error: "Too many attempts; wait a minute." }, 429);
      }
      const form = await request.formData().catch(() => null);
      const key = String(form?.get("key") ?? "");
      // Reuse the one comparison in auth.ts rather than adding a second here: a
      // presented key is exactly a bearer credential.
      const right = key !== "" && (await isOwner(new Request("https://x/", { headers: { Authorization: `Bearer ${key}` } }), env));
      if (!right) return html(loginHtml(true), 401);
      return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": await mintSession(env) } });
    }
  }
  if (path === "/logout" && method === "POST") {
    return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": clearSession() } });
  }

  if (method === "GET" && path === "/") {
    const openMint = env.OPEN_MINT === "true";
    if (wantsHtml(request)) {
      // The site's front page is itself a face: when a face named "home" is
      // registered, browsers get it instead of the built-in manual page.
      // Agents (no text/html in Accept) always get the markdown manual below.
      const res = await registry(env).fetch(new Request("https://do/faces/home"));
      if (res.ok) {
        const { face: rec } = (await res.json()) as { face: { html: string; visibility: string } };
        if (rec.visibility !== "private" || owner) {
          const document = env.WEBMCP_OT_TOKEN ? withOriginTrial(rec.html, env.WEBMCP_OT_TOKEN) : rec.html;
          return indexable(html(document));
        }
      }
      return indexable(html(manualHtml(url.origin, openMint)));
    }
    return indexable(new Response(manualMarkdown(url.origin, openMint), {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    }));
  }

  if (path === "/apps") {
    if (method === "GET") {
      const res = await registry(env).fetch(new Request("https://do/apps"));
      const { apps } = (await res.json()) as { apps: { visibility: string }[] };
      return indexable(json({ ok: true, apps: owner ? apps : apps.filter((a) => a.visibility === "public") }));
    }
    if (method === "POST") {
      // Minting is the owner's act unless this installation opened it.
      if (!owner && env.OPEN_MINT !== "true") return gone("Minting is closed on this installation.");
      if (!owner && (await limited(env.PUBLIC_RL, `mint:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`))) {
        return json({ ok: false, error: "Too many mints; wait a minute." }, 429);
      }
      const body = (await request.json().catch(() => null)) as { charter?: unknown; state?: unknown } | null;
      if (!body) return json({ ok: false, error: "Body must be JSON: {charter, state?} — the shape GET /a/<id>/export returns." }, 400);
      // A guest mint (owner false, reachable only under OPEN_MINT) may not set
      // allowedHosts; an owner mint keeps whatever it specified.
      return mintApp(env, url.origin, body.charter, body.state, !owner);
    }
  }

  const app = path.match(/^\/a\/([^/]+)(\/.*)?$/);
  if (app) {
    const id = app[1];
    const rest = app[2] && app[2] !== "/" ? app[2] : "";
    if (!APP_ID.test(id)) return gone("No app lives at this URL.");
    // /init exists on the DO so the router can create an app. It is not part of
    // the public surface and a caller must never reach it.
    if (rest === "/init") return gone("No app lives at this URL.");

    let stub: DurableObjectStub;
    try {
      stub = env.APP.get(env.APP.idFromString(id));
    } catch {
      return gone("No app lives at this URL.");
    }

    // The visibility gate, ahead of every route below it: charter, state, rpc,
    // history, export, qr, ws, amend, fork, retire.
    const charter = await readCharter(stub);
    if (!charter) return gone("No app lives at this URL.");
    if (charter.law.visibility === "private" && !owner) return gone("No app lives at this URL.");
    const isPublic = charter.law.visibility === "public";

    if (method === "GET" && rest === "") {
      if (!wantsHtml(request)) {
        const res = json({ ok: true, charter });
        return isPublic ? indexable(res) : res;
      }
      const page = html(landingHtml(id, charter, await facesFor(env, id, owner)));
      return isPublic ? indexable(page) : page;
    }

    if (method === "GET" && rest === "/qr") return svg(qrSvg(`${url.origin}/a/${id}`));

    if (method === "POST" && rest === "/fork") {
      if (!owner) return gone("No app lives at this URL.");
      const res = await stub.fetch(new Request("https://do/export", { headers: { "X-Owner": "1" } }));
      if (!res.ok) return gone("No app lives at this URL.");
      const { export: bundle } = (await res.json()) as { export: { charter: Charter; state: unknown } };
      const body = (await request.json().catch(() => ({}))) as { withState?: boolean } | null;
      return mintApp(env, url.origin, bundle.charter, body?.withState ? bundle.state : undefined);
    }

    if (method === "DELETE" && rest === "") {
      if (!owner) return gone("No app lives at this URL.");
      const res = await stub.fetch(new Request("https://do/retire", { method: "POST", headers: { "X-Owner": "1" } }));
      if (!res.ok) return res;
      await registry(env).fetch(new Request("https://do/apps/unregister", { method: "POST", body: JSON.stringify({ id }) }));
      return json({ ok: true });
    }

    if (method === "PUT" && rest === "") {
      const res = await toApp(stub, "/charter", request, owner);
      // The registry's copy of intent and visibility is a cache of the charter;
      // an amendment that changed either must not leave it stale.
      if (res.ok) {
        const amended = await readCharter(stub);
        if (amended) await register(env, id, amended);
      }
      return res;
    }

    if (rest === "/ws") {
      if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
        return json({ ok: false, error: "Expected a WebSocket upgrade." }, 426);
      }
      // An upgrade cannot carry a rewritten header reliably from a browser
      // client, so the verdict rides as a query parameter the Worker sets. The
      // header is overwritten too, for the clients that can send one.
      const upgrade = new Request(`https://do/ws?owner=${owner ? "1" : "0"}`, request);
      upgrade.headers.set("X-Owner", owner ? "1" : "0");
      return stub.fetch(upgrade);
    }

    // Explicit allow-list of forwardable DO suffixes. The forward-by-default this
    // replaces exposed raw DO routes that skip the registry upkeep the router's
    // own wrappers do: POST /retire reached App.retire without unregistering (the
    // app stayed in GET /apps), and PUT /charter reached App.amend without
    // refreshing the registry's cached visibility (a public->private amend left
    // the app still listed as public). Retire and amend are the router's own
    // DELETE /a/<id> and PUT /a/<id> above; /init, /retire, raw /charter,
    // /manifest, and anything unrecognized are not reachable here. Seed and
    // rollback have no router wrapper and are forwarded, rollback with a registry
    // refresh below because it can restore a charter of different visibility.
    const forwardable =
      (method === "GET" && (rest === "/state" || rest === "/history" || rest === "/export")) ||
      (method === "PUT" && rest === "/state") ||
      (method === "POST" && rest.startsWith("/rpc/")) ||
      (method === "POST" && rest === "/rollback");
    if (!forwardable) return gone("No app lives at this URL.");

    // Per-caller-per-path: keyed on the pathname alone, one abuser of a popular
    // app shares (and exhausts) a single bucket for every legitimate user of it,
    // and evades their own cap by rotating app ids. Key on the caller's IP too,
    // as the login and mint limiters above already do.
    if (await limited(env.PUBLIC_RL, `${request.headers.get("CF-Connecting-IP") ?? "unknown"}:${path}`)) {
      return json({ ok: false, error: "Too many requests; slow down." }, 429);
    }
    const forwarded = await toApp(stub, rest, request, owner);
    // A rollback can restore a charter whose visibility or intent differs from the
    // current one; refresh the registry's cache the same way an amend does, so a
    // rollback to private is not left listed as public in GET /apps.
    if (rest === "/rollback" && forwarded.ok) {
      const restored = await readCharter(stub);
      if (restored) await register(env, id, restored);
    }
    return forwarded;
  }

  const face = path.match(/^\/f\/([^/]+)$/);
  if (face) {
    const name = face[1];
    if (!FACE_NAME.test(name)) return gone(`No face named "${name}".`);
    if (method === "PUT" || method === "DELETE") {
      if (!owner) return gone(`No face named "${name}".`);
      const body = method === "PUT" ? await request.text() : undefined;
      return registry(env).fetch(new Request(`https://do/faces/${name}`, { method, body }));
    }
    if (method === "GET") {
      // Per-caller-per-path, for the same reason as the app routes above: a
      // path-only bucket lets one caller lock a popular face out for everyone.
      if (await limited(env.PUBLIC_RL, `${request.headers.get("CF-Connecting-IP") ?? "unknown"}:${path}`)) {
        return json({ ok: false, error: "Too many requests; slow down." }, 429);
      }
      const res = await registry(env).fetch(new Request(`https://do/faces/${name}`));
      if (!res.ok) return gone(`No face named "${name}".`);
      const { face: rec } = (await res.json()) as { face: { html: string; visibility: string } };
      // An unlisted face is reachable by link, exactly like an unlisted app:
      // only `private` is gated to the owner.
      if (rec.visibility === "private" && !owner) return gone(`No face named "${name}".`);
      const document = env.WEBMCP_OT_TOKEN ? withOriginTrial(rec.html, env.WEBMCP_OT_TOKEN) : rec.html;
      const page = html(document);
      return rec.visibility === "public" ? indexable(page) : page;
    }
  }

  return json({ ok: false, error: `No route for ${method} ${path}. GET / for the manual.` }, 404);
}

// Faces the caller may actually open, targeting this app. Private faces are the
// owner's alone; unlisted ones are link-reachable and worth listing to someone
// who already holds the app's link.
async function facesFor(env: Env, id: string, owner: boolean): Promise<{ name: string; title?: string }[]> {
  const res = await registry(env).fetch(new Request("https://do/faces"));
  if (!res.ok) return [];
  const { faces } = (await res.json()) as { faces: { name: string; title: string; targets: string[]; visibility: string }[] };
  return faces.filter((f) => f.targets.includes(id) && (owner || f.visibility !== "private"));
}
