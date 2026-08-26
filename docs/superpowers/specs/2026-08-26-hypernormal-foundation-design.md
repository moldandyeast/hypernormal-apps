# Hypernormal: foundation design

Status: draft for review, 2026-08-26.
Depends on: `2026-08-26-durable-faceless-apps-definition.md` (the definition). The definition governs; where this document and the definition disagree, the definition wins and this document has a bug.

Out of scope, deliberately: the proof of concept for the WebMCP Challenge. It gets its own design once the foundation stands. This document covers the library only.

## 1. What is being built

Hypernormal is an open source library for durable faceless apps. It is a forkable repository, not an npm package. Forking it and deploying it to a Cloudflare account yields one installation: one Worker, one domain, one owner, and apps as data. Greenfield code, with proven modules ported from Farnsworth v2 together with their tests: the QuickJS sandbox, safe-fetch, the cron evaluator, the WebSocket patterns, and the auth shapes.

License: MIT.

## 2. Repository layout

```
hypernormal/
  DEFINITION.md        the definition, verbatim
  README.md            what it is, how to fork and deploy
  PROTOCOL.md          exact wire shapes: routes, message forms, error forms, budgets, schema subset
  LICENSE              MIT
  wrangler.jsonc       worker, two DO bindings, wasm rule
  package.json
  src/
    index.ts           router, auth gate, face serving
    app.ts             App Durable Object
    registry.ts        Registry Durable Object (singleton)
    sandbox.ts         QuickJS execution with budgets     (ported)
    safe-fetch.ts      allowedHosts HTTP helper           (ported)
    schedule.ts        cron evaluation                    (ported)
    auth.ts            owner key and session cookie       (ported, simplified)
    charter.ts         charter types and validation
    schema.ts          inputSchema subset validation
    types.ts
  face/
    runtime.js         face runtime and WebMCP bridge
  examples/            charters and faces that pass the completeness rule
  test/
  scripts/
    hn.sh              owner CLI: hn.sh METHOD PATH [BODY]
```

Development happens in the kohlhaas workspace. At publish time the public repository is created fresh so its history opens with DEFINITION.md and the code follows it.

## 3. Kernel

Two Durable Object classes, both SQLite-backed.

**App** (one per app). Holds, in separate storage entries: `charter`, `state` (one JSON value in one row, written once per successful invocation), `history` (bounded list of prior charters with version numbers that never renumber), and the alarm for the schedule. Handles invocation, amendment, seed, rollback, fork, export, retire, and the WebSocket surface.

**Registry** (singleton). Two tables: `apps` (id, intent summary, visibility, updated) and `faces` (name, title, html, targets, visibility, updated). Holds no auth logic. Faces live here, not in App, so deleting a face never touches an app.

**Trust boundary.** The Worker computes `owner` once per request and forwards it to DOs on a header it always overwrites; a client-supplied value never survives. WebSocket upgrades carry the flag as a trusted query parameter because upgrade headers cannot be rewritten safely.

### Named requirement: serial invocations

Definition law 5 says invocations on one app execute one at a time. Durable Objects do not give this for free: a verb using the HTTP helper suspends on a network await, and a second invocation can enter and cause a lost update. The App DO therefore runs every invocation and every alarm execution through one internal promise chain. Reads (charter, state, history) stay concurrent; only invocations and acts that write serialize. This requirement has a dedicated race test.

### Named requirement: atomic state

Definition law 4 says no partial write. State is one JSON value in one storage row, written exactly once after successful execution. Failure writes nothing. The state budget (below) keeps the row under the platform's 2 MB limit.

## 4. Routes

| Route | Method | Auth | Meaning |
|---|---|---|---|
| `/` | GET | public | The manual. Content negotiation: HTML for browsers, markdown for everyone else. Lists public apps. |
| `/health` | GET | public | `{ok: true}` |
| `/login`, `/logout` | GET/POST | rate limited | Owner session |
| `/runtime.js` | GET | public | The face runtime |
| `/apps` | GET | law | Public apps for guests, all apps for the owner |
| `/apps` | POST | owner, or guest if minting open | Mint |
| `/a/:id` | GET | law | Charter (JSON), or HTML landing for browsers |
| `/a/:id` | PUT | owner | Amend (partial: intent, verbs, law; a null verb deletes) |
| `/a/:id` | DELETE | owner | Retire |
| `/a/:id/state` | GET | law | State |
| `/a/:id/state` | PUT | owner | Seed |
| `/a/:id/rpc/:verb` | POST | law and verb access | Invoke |
| `/a/:id/ws` | GET upgrade | law | Watch |
| `/a/:id/history` | GET | law | Charter versions |
| `/a/:id/rollback` | POST | owner | Restore a version; itself recorded |
| `/a/:id/export` | GET | law | `{charter, state}`; mint accepts exactly this shape |
| `/a/:id/fork` | POST | owner | Copy within the installation |
| `/a/:id/qr` | GET | law | SVG QR of the app URL |
| `/f/:name` | GET | face visibility | Serve a face |
| `/f/:name` | PUT | owner | Register or replace a face `{name, title, html, targets, visibility}` |
| `/f/:name` | DELETE | owner | Delete a face |

Error form everywhere: `{ok: false, error}` with a message an agent can act on. Denials are 404, never 403.

CORS is open on the JSON surface (`Access-Control-Allow-Origin: *`, with `Authorization` and `Content-Type` allowed and `OPTIONS` answered), because derived faces run from anywhere: a local file, a sandboxed preview, another host. Authorization is the owner key and the law, never the origin. Transport and app-level success are distinct: `{ok: true, result: {ok: false, ...}}` is a valid reply and PROTOCOL.md says so.

Headers on every response: `Referrer-Policy: no-referrer`; `X-Robots-Tag: noindex` except on public surfaces. Responses to browser-served HTML include the Chrome origin-trial token from an env var when set.

Rate limits: a limiter binding on public invocation and face routes, and a stricter one on `/login`. If the binding is unavailable on the forker's plan, the deployment works and README states the gap plainly. Verify availability during implementation; do not fake a limiter.

## 5. Execution engine

Ported Farnsworth sandbox, QuickJS via WASM, fresh context per invocation, disposed after.

Injected capabilities, exactly: `input`, `state`, `now` (ms epoch, fixed at invocation), `random()` (PRNG seeded per invocation from the platform CSPRNG), and `http.get`/`http.post` only when `allowedHosts` is non-empty. QuickJS stock globals (`Date`, `Math`, `JSON`) remain available; the docs say so and nothing pretends otherwise.

safe-fetch, ported: HTTPS only, exact hostname allowlist, IP literals and internal hosts blocked, redirects refused, 8 s timeout, 1 MB response cap. String bodies sent verbatim, object bodies JSON-encoded.

Budgets, defined in one file (`types.ts`) and printed in PROTOCOL.md:

| Budget | Default |
|---|---|
| operations | 20,000 interrupt checks |
| memory | 64 MB |
| stack | 512 KB |
| input | 64 KB |
| result | 256 KB |
| state | 1 MB |
| charter | 256 KB |
| face html | 512 KB |
| presence signal | 4 KB |
| history | 10 versions |

Input is validated against the verb's `inputSchema` before any code runs. Verb errors return as `{ok: false, error}` with name and message, plain enough to amend against.

Schedule: `schedule = (cron, verb)`, UTC, evaluated with the ported cron module. The alarm invokes the scheduled verb with input `{scheduled: true}` through the same serial chain, then re-arms. Amending or rolling back re-applies the schedule; a schedule naming a missing verb is rejected at amendment time.

## 6. Charter validation

`charter.ts` validates at mint and amend:

- `intent`: non-empty prose.
- Verb names: `[a-zA-Z0-9_-]`, 1 to 64 chars, unique. Inside WebMCP's tool-name rule so the bridge never renames, and dot-free so every verb is a valid property name in the face runtime.
- Each verb: non-empty `description`, valid `inputSchema` (see below), non-empty `code`, `access` in `{owner, public}`.
- `law`: visibility in `{private, unlisted, public}`, `allowedHosts` a list of hostnames.
- Total size within the charter budget.

`schema.ts` accepts a defined subset of JSON Schema: `type` (object, string, number, integer, boolean, array), `properties`, `required`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `description`. Nesting depth at most 8. Anything outside the subset is rejected at mint or amend, never at invoke. Input validation is strict: undeclared properties are rejected, not stripped.

## 7. Auth

One secret: `OWNER_KEY`. Three ways to be the owner:

1. `Authorization: Bearer <OWNER_KEY>`, compared by hash with a timing-safe comparison.
2. Session cookie `__Host-sid`, an HMAC ticket with 30-day expiry, minted at `/login`. The HMAC key is derived from `OWNER_KEY` with a fixed context string, so there is no second secret and rotating the owner key invalidates all sessions.
3. Nothing else. Cloudflare Access support is dropped from v1; the Farnsworth documentation is referenced for those who want it.

Fail closed: empty configured key or empty presented key never authenticates.

Guest minting: env var `OPEN_MINT`. Default absent, meaning closed. When open, `POST /apps` accepts unauthenticated mints, rate limited, with all budgets enforced; minted apps belong to the installation owner, per the definition.

## 8. Face runtime and WebMCP bridge

`face/runtime.js`, dependency-free, served at `/runtime.js`. A convenience, never a requirement. An ES module with named exports, no global.

The API is a projection of the charter, built on two shapes used uniformly: a live value `{value, watch(fn)}` where `watch` fires immediately with the current value and on every change, and an event stream `{emit(e), watch(fn)}` where `watch` fires only on events.

- `connect(appUrl, options)` resolves after charter fetch and first socket state message.
- `app.state`: live value of the app's state. `app.charter`: live value of the charter. Hydration only from the socket; `watch(render)` is rendering and hydration in one line. No optimistic mutation.
- `app.verbs.<name>(input)`: one async function per public verb, generated from the charter at connect time and regenerated on charter change. If the verb ran, the call returns its result. If it could not run (unknown verb, invalid input, budget exceeded, transport failure), the call throws with the server's message. `app.invoke(name, input)` remains as the escape hatch for dynamic names and carries the same error contract.
- `app.presence`: event stream. `emit` sends a signal, `watch` witnesses others' signals. Never stored.
- `app.close()` ends the socket and unregisters tools.
- Bridge: `options.tools` defaults to true where `document.modelContext` exists. Every public verb registers as a tool: name to name, description to description, `inputSchema` verbatim, `execute` delegates to the verb function. Every tool carries `untrustedContentHint: true`. One AbortController unregisters all tools on close. On a `charter` socket message, tools re-register, so amendments update live tool sets.
- Named exports: `connect`, and the pure `toolsFromCharter(charter)` for testing and reuse.

Socket protocol (PROTOCOL.md carries exact shapes):

- Server sends: `{type: "state", state}` on connect and after every state change; `{type: "charter", charter}` after every amendment or rollback; `{type: "pong"}`.
- Client sends: the literal string `ping`; `{type: "presence", ...}` under the signal budget, relayed to every other watcher, never stored.

## 9. Examples

`examples/` holds three complete apps, each a charter JSON plus one face, each passing the completeness rule: a stranger agent given only the URL can use every projection without a question. The three: a shared list, a poll, and a counter with a schedule. They are the library's documentation by demonstration and the seed pool for the later proof of concept. Each example face uses `runtime.js` and nothing else.

## 10. Testing

`@cloudflare/vitest-pool-workers`, exact-pinned miniflare, patterns and tests ported from Farnsworth where the module is ported. New tests the definition demands:

- **Serial law race test**: a verb with an artificial slow HTTP call, a concurrent fast invocation, assert no lost update.
- **Atomicity**: a verb that mutates state then throws leaves state untouched.
- **Budgets**: each budget in the table has a test that exceeds it and asserts clean failure.
- **Schema**: subset acceptance, out-of-subset rejection at mint, strict input rejection at invoke.
- **Auth**: fail-closed cases, spoofed owner header ignored, session derivation, rotation invalidates sessions.
- **Watching**: state broadcast on change, charter broadcast on amend and rollback, presence relayed not stored, signal budget enforced.
- **Schedule**: alarm runs the verb through the serial chain and re-arms; invalid schedule rejected.
- **Acts**: mint, amend, seed, fork, retire, export/mint round-trip, history caps and rollback recording.
- **Bridge**: `toolsFromCharter` unit tests. Browser behavior of `runtime.js` is exercised later by the proof of concept's Playwright checks, not unit-tested here.

## 11. Documentation

- `DEFINITION.md`: the definition, verbatim, governing.
- `README.md`: what this is, fork and deploy in five steps, one secret, the manual's location. Written in the definition's register. No claims the tests do not back.
- `PROTOCOL.md`: routes, wire shapes, error forms, budgets, the schema subset, the socket protocol, the WebMCP mapping, and a short Semantics section in plain language: a verb is a pure step from state and input to state and result; an invocation is atomic; invocations on one app are totally ordered; state is a value you can always read and watch, presence is events you can only witness. Everything an implementer or agent needs without reading source.
- `GET /` serves the in-band manual for agents: the contract, how to read a charter, how to invoke, how to watch, how minting works on this installation.

## 12. Open risks

1. WebMCP end-to-end (Chrome origin trial token on the deployed domain, ChatGPT desktop behavior against registered tools) is unverified. Prove it with a one-verb app on day one of implementation, before building on it.
2. Rate limiter binding availability on the free plan is unverified. Resolve during implementation; document honestly either way.
3. QuickJS wasm loading under current wrangler versions: proven pattern exists in both ancestors, but pin versions early.

## 13. Order of work

1. Repo scaffold, wrangler config, DEFINITION.md, LICENSE, pinned toolchain. QuickJS wasm loading proven with one smoke test.
2. Kernel: charter validation, schema subset, App DO with serial chain and atomic state, budgets, sandbox port, safe-fetch port.
3. Routes and auth, Registry, faces, manual.
4. Watching: sockets, broadcasts, presence.
5. Schedule.
6. Face runtime and bridge; WebMCP proven live with a one-verb app.
7. Examples, PROTOCOL.md, README.md.
8. Then, separately: the proof of concept design.
