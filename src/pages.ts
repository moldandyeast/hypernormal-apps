import { BUDGET, type Charter } from "./types";

// Every page in this file is a template function over plain strings: no
// framework, no client bundle, nothing to build. The manual is the important
// one — it is the agent-facing contract, and it is written to be read once,
// in full, by something that has never seen this installation before.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const EXAMPLE_CHARTER = `{
  "intent": "A counter. State is {count: number}. bump adds one and returns the new count. read returns the count. Anyone may bump or read; only the owner may reset.",
  "verbs": {
    "bump": {
      "description": "Add one to the count.",
      "inputSchema": { "type": "object", "properties": {} },
      "code": "ctx.state.count = (ctx.state.count ?? 0) + 1; return ctx.state.count;",
      "access": "public"
    },
    "read": {
      "description": "Return the count.",
      "inputSchema": { "type": "object", "properties": {} },
      "code": "return ctx.state.count ?? 0;",
      "access": "public"
    },
    "reset": {
      "description": "Set the count to zero.",
      "inputSchema": { "type": "object", "properties": {} },
      "code": "ctx.state.count = 0; return 0;",
      "access": "owner"
    }
  },
  "law": { "visibility": "unlisted", "allowedHosts": [] }
}`;

export function manualMarkdown(origin: string, openMint: boolean): string {
  const o = origin.replace(/\/$/, "");
  const minting = openMint
    ? "Minting is **open** on this installation: anyone may mint, rate limited, under every budget listed above. Apps minted by a guest belong to the installation's owner."
    : "Minting is **closed** on this installation: only the owner may mint. Everything else is open to you — read a charter, read state, invoke, watch, export. Between installations no act is needed: export what the law lets you read and mint the copy on an installation you own.";

  return `# Hypernormal

This installation hosts durable faceless apps. An app is a pair — a charter and a state — living at one URL, persisting on its own, with no page open and no process running anywhere. The platform holds no intelligence: it stores state and executes verbs, and every decision arrives from outside, carried by whoever visits. An app has no canonical interface either; interfaces are derived from the app's own charter, by anyone, at any time.

You are most likely an agent, and this page is the whole contract. There is no SDK and none is required: HTTP and JSON are all of it. Every reply is \`{"ok": true, ...}\` or \`{"ok": false, "error": "..."}\`, and every denial is a 404, never a 403 — an app you may not see does not exist as far as you are concerned.

## Reading an app

\`\`\`
GET ${o}/apps          -> {ok, apps}      public apps; all of them for the owner
GET ${o}/a/<id>        -> {ok, charter}
GET ${o}/a/<id>/state  -> {ok, state}
\`\`\`

A charter is \`{intent, verbs, law, schedule?}\` and it fully describes the app.

- **intent** — prose. What the app is for, its rules, and the shape of its state. If you need something the intent does not tell you, that is a defect in the charter, not a question to ask around: say so plainly, and amend it if the app is yours.
- **verbs** — a map of name to \`{description, inputSchema, code, access}\`. The description says what invoking the verb *means*, not what the code does. The inputSchema is a JSON Schema subset: \`type\` (object, string, number, integer, boolean, array), \`properties\`, \`required\`, \`items\`, \`enum\`, \`minimum\`, \`maximum\`, \`minLength\`, \`maxLength\`, \`description\`. The code is the body of a synchronous JavaScript function, stored as text, and you may read it. Access is \`owner\` or \`public\`.
- **law** — \`{visibility, allowedHosts}\`. Visibility is \`private\` (the owner only), \`unlisted\` (anyone holding the link) or \`public\` (anyone, and this installation lists the app). allowedHosts are the hostnames this app's verbs may reach over HTTPS; an empty list means the app cannot reach the network at all, which makes its verbs pure functions of state, input, clock and seed.
- **schedule** — optional \`{cron, verb}\`. The platform invokes that verb on that schedule, in UTC, with input \`{"scheduled": true}\` and no caller. It is the one way an app acts while nobody is present.

A charter is complete only if a stranger given nothing but the URL can use the app and build a correct interface for it without asking a question.

## Invoking

\`\`\`
POST ${o}/a/<id>/rpc/<verb>
Content-Type: application/json

<input>

-> {ok: true, result}
-> {ok: false, error}
\`\`\`

Input is validated against the verb's inputSchema before any code runs, strictly: undeclared properties are rejected, not stripped. An invocation is atomic — it either commits the new state and returns the result, or changes nothing and returns the error. Invocations on one app run one at a time, in arrival order, so there is no lost update to defend against.

Two levels of \`ok\`, and they mean different things. The outer \`ok\` is about the invocation itself: false means the verb did not run — unknown verb, invalid input, a budget exceeded, code that threw. Anything inside \`result\` is the app's own vocabulary, so \`{"ok": true, "result": {"ok": false, "reason": "seat taken"}}\` is a perfectly good reply: the verb ran, and the app said no.

Errors are written to be acted on. When a verb's code fails, the error names the verb and carries the failure in prose plain enough to amend the code against and try again.

## Watching

\`\`\`
GET ${o}/a/<id>/ws     (WebSocket upgrade)
\`\`\`

The server sends:

- \`{"type": "state", "state": ...}\` on connect, and after every state change.
- \`{"type": "charter", "charter": ...}\` after every amendment or rollback.
- \`{"type": "pong"}\` in reply to a ping.

You may send:

- the literal string \`ping\`.
- \`{"type": "presence", ...}\` under the signal budget — relayed to every other watcher, never stored, never part of state. Cursors and presence live here.

A result goes only to its caller; state goes to everyone watching. Those are the system's two channels and they are not interchangeable. An interface should hydrate from the socket's first state message rather than reading state separately, so there is one source of truth on screen.

\`${o}/runtime.js\` is a small dependency-free ES module that wraps exactly the above — a live state value, one function per public verb, presence, and registration of the public verbs as browser tools where the browser has a tool API. It is a convenience and never a requirement.

## The acts

Invocations change state. Acts change apps.

- **Mint** — \`POST ${o}/apps\` with \`{charter, state?}\`. Owner, or anyone when minting is open.
- **Amend** — \`PUT ${o}/a/<id>\` with a partial \`{intent?, verbs?, law?, schedule?}\`. Owner. Only the parts you name change; a verb set to \`null\` is deleted. Every amendment appends the previous charter to a bounded history.
- **Fork** — \`POST ${o}/a/<id>/fork\` with \`{withState?: boolean}\`. Owner. Copies the charter, and optionally the state, to a new URL in this installation. History does not copy.
- **Seed** — \`PUT ${o}/a/<id>/state\` with the state document. Owner. The one write that bypasses verbs.
- **Retire** — \`DELETE ${o}/a/<id>\`. Owner. The URL stops resolving.
- **Roll back** — \`POST ${o}/a/<id>/rollback\` with \`{version}\`. Owner. Restores a charter version; the rollback is itself recorded.
- **Read history** — \`GET ${o}/a/<id>/history\` -> \`{ok, history}\`, the last ${BUDGET.HISTORY} charter versions. Anyone the law admits.
- **Export** — \`GET ${o}/a/<id>/export\` -> \`{ok, export: {charter, state}}\`. Anyone the law admits.

The owner sends \`Authorization: Bearer <owner key>\` (a browser session cookie from \`POST ${o}/login\` counts the same). There is exactly one owner per installation and there are no accounts; everyone else is a guest, identified by nothing but possession of a link.

## Budgets

Every budget is finite and enforced. A verb that exceeds one fails cleanly and changes nothing.

- operations: ${BUDGET.OPS.toLocaleString("en-US")} interrupt checks
- memory: ${BUDGET.MEMORY / 1024 / 1024} MB
- stack: ${BUDGET.STACK / 1024} KB
- input: ${BUDGET.INPUT / 1024} KB of JSON
- result: ${BUDGET.RESULT / 1024} KB
- state: ${BUDGET.STATE / 1024 / 1024} MB — an app that outgrows its state budget is two apps
- charter: ${BUDGET.CHARTER / 1024} KB
- face HTML: ${BUDGET.FACE / 1024} KB
- presence signal: ${BUDGET.SIGNAL / 1024} KB
- charter history: ${BUDGET.HISTORY} versions

## Minting here

${minting}

\`\`\`
POST ${o}/apps
Content-Type: application/json
Authorization: Bearer <owner key>

{"charter": { ... }, "state": { ... }}

-> 201 {ok: true, id, url}
\`\`\`

\`{charter, state}\` is exactly the shape \`GET /a/<id>/export\` returns, so an export is a mint body, unchanged.

A complete charter, small enough to read in full:

\`\`\`json
${EXAMPLE_CHARTER}
\`\`\`

Verb names match \`[a-zA-Z0-9_-]{1,64}\`. Code runs in a sandbox that sees exactly \`ctx.input\`, \`ctx.state\`, \`ctx.now\` (a clock fixed at invocation time), \`ctx.random()\` (a seeded random source), and, only when allowedHosts is non-empty, a blocking \`ctx.http.get\`/\`ctx.http.post\` restricted to those hosts. The ambient \`Date\` and \`Math.random\` globals are routed to those same two sources: \`Date.now()\` and \`new Date()\` read \`ctx.now\`, and \`Math.random()\` draws from the same seeded PRNG as \`ctx.random()\`. Both are safe to use and deterministic, not a second live source of time or entropy. It cannot import, cannot await, cannot see another app. Mutate \`ctx.state\` and it persists; whatever you return goes to the caller.

## Everything else

- \`GET ${o}/\` — this manual. Ask for \`text/html\` and you get a page; anything else gets markdown.
- \`GET ${o}/health\` — \`{ok: true}\`.
- \`GET ${o}/a/<id>/qr\` — an SVG QR code of the app's own address, gated like its charter.
- \`GET ${o}/f/<name>\` — a face: one HTML document that renders an app and invokes its verbs. Faces are derived and disposable; deleting one never touches an app.
- \`PUT ${o}/f/<name>\` with \`{title, html, targets, visibility}\` — owner. \`DELETE\` the same path removes it.

The JSON surface allows any origin, because a derived interface may run from anywhere — a local file, a sandboxed preview, another host. Authorization is the owner key and the app's law, never the origin.
`;
}

// A deliberately small markdown renderer: exactly the constructs the manual
// above uses (headings, fenced code, bullets, paragraphs, inline code, bold,
// links) and nothing else. Escaping happens before any inline markup is
// expanded, so nothing in a charter or an error message can become HTML.
function renderMarkdown(md: string): string {
  const out: string[] = [];
  const segments = md.split(/```/);
  segments.forEach((segment, i) => {
    if (i % 2 === 1) {
      const body = segment.replace(/^[a-z]*\n/, "");
      out.push(`<pre><code>${escapeHtml(body.replace(/\n$/, ""))}</code></pre>`);
      return;
    }
    let list: string[] = [];
    let para: string[] = [];
    const flushList = () => {
      if (list.length) out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`);
      list = [];
    };
    const flushPara = () => {
      if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    };
    for (const line of segment.split("\n")) {
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      const bullet = line.match(/^-\s+(.*)$/);
      if (heading) {
        flushPara(); flushList();
        out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      } else if (bullet) {
        flushPara();
        list.push(bullet[1]);
      } else if (line.trim() === "") {
        flushPara(); flushList();
      } else if (list.length) {
        list[list.length - 1] += " " + line.trim();
      } else {
        para.push(line.trim());
      }
    }
    flushPara(); flushList();
  });
  return out.join("\n");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, (_, bold) => `<strong>${bold}</strong>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => `<a href="${href}">${text}</a>`);
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 16px/1.65 ui-sans-serif, system-ui, sans-serif; max-width: 46rem; margin: 4rem auto; padding: 0 1.5rem; }
  h1, h2, h3 { font-weight: 500; letter-spacing: -0.01em; line-height: 1.25; }
  h1 { margin-bottom: 0.25rem; }
  h2 { margin-top: 2.5rem; }
  a { color: inherit; }
  code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.85em; }
  pre { background: color-mix(in srgb, currentColor 7%, transparent); padding: 0.9rem 1rem; border-radius: 6px; overflow-x: auto; }
  pre code { font-size: 0.8rem; line-height: 1.5; }
  ul { padding-left: 1.2rem; }
  li { margin: 0.35rem 0; }
  .sub { opacity: 0.55; font-size: 0.9rem; margin: 0 0 2rem; }
  .err { color: #c0392b; }
  form { display: flex; gap: 0.5rem; max-width: 24rem; }
  input { flex: 1; padding: 0.5rem; font: inherit; }
  button { font: inherit; padding: 0.5rem 0.9rem; }
  .qr { display: block; width: 180px; height: 180px; margin: 1.5rem 0; image-rendering: pixelated; }
  .mono { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.85rem; opacity: 0.7; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

export function manualHtml(origin: string, openMint: boolean): string {
  return page("Hypernormal", renderMarkdown(manualMarkdown(origin, openMint)));
}

export function landingHtml(
  id: string,
  charter: Charter,
  faces: { name: string; title?: string }[],
): string {
  const title = (charter.intent.split(/(?<=[.!?])\s|\n/)[0] || "A faceless app").slice(0, 100);
  const verbs = Object.entries(charter.verbs).filter(([, v]) => v.access === "public").map(([n]) => n);
  const faceList = faces
    .map((f) => `<li><a href="/f/${escapeHtml(f.name)}">${escapeHtml(f.title || f.name)}</a> <span class="mono">/f/${escapeHtml(f.name)}</span></li>`)
    .join("");
  return page(
    title,
    `<h1>${escapeHtml(title)}</h1>
     <p class="sub">A faceless app · ${escapeHtml(charter.law.visibility)} · <span class="mono">/a/${escapeHtml(id)}</span></p>
     <p>${escapeHtml(charter.intent)}</p>
     <img class="qr" alt="QR code for this app" src="/a/${escapeHtml(id)}/qr">
     <p>This code is the app's address. Scan it to open the app on a phone, or hand it to someone.</p>
     ${verbs.length ? `<p class="mono">verbs: ${escapeHtml(verbs.join(", "))}</p>` : `<p class="mono">no public verbs</p>`}
     ${faceList ? `<p>Faces for this app:</p><ul>${faceList}</ul>` : `<p class="sub">No face has been registered for this app. It does not need one: read the charter and derive your own.</p>`}
     <p class="mono"><a href="/a/${escapeHtml(id)}">charter</a> · <a href="/a/${escapeHtml(id)}/state">state</a> · <a href="/a/${escapeHtml(id)}/export">export</a> · <a href="/">the manual</a></p>
     <p class="sub">Those return JSON to anything that does not ask for HTML. The charter is the whole contract: read it and build your own interface.</p>`,
  );
}

export function loginHtml(failed: boolean): string {
  return page(
    "Hypernormal",
    `<h1>Hypernormal</h1>
     <p class="sub">owner key</p>
     ${failed ? `<p class="err">That is not the key.</p>` : ""}
     <form action="/login" method="post">
       <input type="password" name="key" placeholder="owner key" autofocus autocomplete="current-password">
       <button type="submit">Enter</button>
     </form>`,
  );
}
