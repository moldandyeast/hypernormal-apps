# PROTOCOL

The wire protocol for a Hypernormal installation: every route, the shape of every
reply, the budgets that bound execution, the schema subset a charter may use, the
socket protocol, and the mapping onto WebMCP. `DEFINITION.md` says what the system
is; this document says exactly what talking to one looks like. Where the two ever
disagree, the code is authoritative. This file describes it; it does not define it.

Nothing here is aspirational. Every route, error, and number below was read out of
the current source (`src/index.ts`, `src/app.ts`, `src/registry.ts`, `src/types.ts`,
`src/charter.ts`, `src/schema.ts`, `face/runtime.js`) at the time this file was
written.

## 1. Semantics

A verb is a pure step from state and input to state and result. An invocation is
atomic: it either commits a new state and returns a result, or changes nothing and
returns an error. There is no partial write. Invocations on one app are totally
ordered: they execute one at a time, in arrival order, so there is no concurrent
write and no lost update to defend against.

State is a value you can always read (`GET /a/<id>/state`) and watch (the `/ws`
socket): every write persists, survives every restart, and is delivered to every
watcher. It carries no history of its own; only the charter does (`GET
/a/<id>/history` and `BUDGET.HISTORY` in §4 both apply to the charter alone,
never to state). A bad write is not recoverable through the platform: the
durability guarantee comes from each write being atomic, not from state being
versioned.

Presence is events you can only witness: a presence signal is relayed to other
watchers as it happens, never written to storage, and never becomes part of
state. Presence has neither durability nor history; state has durability
without history.

## 2. Routes

Every response is JSON unless noted. `owner` is decided once, at the Worker, from
either `Authorization: Bearer <owner key>` or the session cookie `POST /login`
mints; nothing a caller sends downstream of that can override it.

| Method | Path | Auth | What |
|---|---|---|---|
| GET | `/health` | none | `{ok:true}` |
| GET | `/runtime.js` | none | the face runtime, served as `text/javascript` |
| GET | `/login` | none | HTML sign-in form; redirects to `/` if already owner |
| POST | `/login` | none, rate-limited (`LOGIN_RL`, key `login:<ip>`) | form body `key=<owner key>`; sets the session cookie and redirects on success, `401` HTML on failure |
| POST | `/logout` | none | clears the session cookie, redirects to `/` |
| GET | `/` | none | the manual: HTML if `Accept` includes `text/html`, markdown otherwise |
| GET | `/apps` | none | `{ok, apps}`; owner sees every app, a guest sees only `visibility:"public"` ones |
| POST | `/apps` | owner, or anyone if `OPEN_MINT` is exactly `"true"` (then rate-limited, `PUBLIC_RL`, key `mint:<ip>`) | `{charter, state?}` -> `201 {ok, id, url}` |
| GET | `/a/<id>` | gated by visibility | `{ok, charter}` as JSON, or an HTML landing page |
| GET | `/a/<id>/qr` | gated by visibility | an SVG QR code of the app's own URL |
| GET | `/a/<id>/state` | gated by visibility; `PUBLIC_RL` keyed on the request path | `{ok, state}` |
| PUT | `/a/<id>/state` | owner (checked inside the App DO); `PUBLIC_RL` keyed on path | body is the new state document (seed) -> `{ok:true}` |
| POST | `/a/<id>/rpc/<verb>` | gated by visibility, then the named verb's own `access` (`owner` verbs 404 to a guest); `PUBLIC_RL` keyed on path | body is the verb's input -> `{ok, result}` or `{ok:false, error}` |
| PUT | `/a/<id>` | owner | body is a partial charter `{intent?, verbs?, law?, schedule?}` -> `{ok, verbs}` (amend) |
| GET | `/a/<id>/history` | gated by visibility; `PUBLIC_RL` keyed on path | `{ok, history}`, up to `BUDGET.HISTORY` versions |
| POST | `/a/<id>/rollback` | owner (checked inside the App DO); `PUBLIC_RL` keyed on path | body `{version}` -> `{ok, restored, verbs}` |
| GET | `/a/<id>/export` | gated by visibility; `PUBLIC_RL` keyed on path | `{ok, export: {charter, state}}` |
| POST | `/a/<id>/fork` | owner | body `{withState?}` -> `201 {ok, id, url}`, a new app with the same charter |
| DELETE | `/a/<id>` | owner | retires the app -> `{ok:true}` |
| GET | `/a/<id>/ws` | gated by visibility, checked twice (see §6) | WebSocket upgrade |
| GET | `/f/<name>` | gated by the face's own visibility; `PUBLIC_RL` keyed on path | the face, an HTML document |
| PUT | `/f/<name>` | owner | body `{title, html, targets, visibility}` -> `{ok:true}` |
| DELETE | `/f/<name>` | owner | removes the face -> `{ok:true}` |

Notes that don't fit in the table:

- **"Gated by visibility"** means: `404` if the app (or face) doesn't exist at all,
  or if its `visibility` is `private` and the caller isn't the owner. The two
  cases are indistinguishable on purpose. The response is always `404`, never
  `403`: an app a caller may not see does not exist as far as that caller is
  concerned.
- `OPTIONS` on any path answers `204` with CORS headers, before any credential is
  read. A preflight carries none.
- `/init` exists only inside the App Durable Object, for the Worker's own use when
  minting. No public route reaches it; the router refuses `/a/<id>/init` outright.
- **Rate limiting.** `PUBLIC_RL` and `LOGIN_RL` are optional bindings.
  `src/index.ts`'s `limited()` returns `false` (never limited) if the binding is
  absent. Where a key is `path` above, the bucket is the literal request path,
  shared by every caller who hits that exact URL, not a per-caller bucket; `login:`
  and `mint:` keys incorporate the caller's IP instead. Routes not listed as
  rate-limited (mint as owner, amend, fork, retire, `GET /a/<id>`, `/qr`, `/ws`)
  enforce no limiter of their own.
- **Indexing.** Responses are `X-Robots-Tag: noindex` by default. The manual, `GET
  /apps`, a `public`-visibility app's charter/landing page, and a `public`
  face are marked indexable instead: everything reachable by an `unlisted` link or
  gated to the owner stays out of search engines, because an unlisted link is the
  only credential a guest ever holds.

## 3. Error form

Every JSON reply is `{ok: true, ...}` or `{ok: false, error}`. `error` is prose
meant to be acted on: for a verb whose code failed, it names the verb and carries
the failure in language plain enough to amend the code against and retry.

There are two levels of `ok` and they answer different questions. The outer `ok`
is about the invocation itself: did the platform run it at all. `false` means it
did not: unknown verb, disallowed verb, invalid input, a budget exceeded, the
verb's code threw. Anything inside `result` is the app's own vocabulary and means
nothing to the platform, so

```json
{"ok": true, "result": {"ok": false, "reason": "seat taken"}}
```

is a perfectly ordinary reply: the verb ran, and the app itself said no. A client
must never conflate the two.

Status codes carry meaning too:

- `400`: the platform rejected the request, before or after running code. A bad
  charter, invalid input, a budget exceeded, a verb whose code threw, a verb that
  left `state` `undefined`.
- `404`: anything the caller may not see. A missing app, verb, or face, and every
  visibility denial (see §2).
- `426`: a `/ws` request that wasn't a WebSocket upgrade.
- `429`: a caller over its rate limit.
- `500`: the router's own top-level boundary, described next.
- `200` / `201`: otherwise.

**The top-level boundary.** `src/index.ts`'s default export wraps the entire router
in `try`/`catch`. Any exception that escapes `handle()` (reachable without
credentials: `POST /login` reuses `isOwner()` a second time to test the submitted
form key against the one comparison in `auth.ts`, and a key value carrying a
newline throws inside the `Headers` constructor during that check, after the
request's own top-level `isOwner()` call has already completed; the sandbox can
fail through its own WASM teardown rather than resolving) becomes
`{ok:false, error: <message>}` at `500`,
through the same `finalize()` path as every other response. That means even a
crash still gets `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, and CORS
headers; nothing escapes as a raw, headerless `workerd` 500.

## 4. Budgets

Every budget is finite and enforced; a verb or write that exceeds one fails
cleanly and changes nothing. Values below are copied from `src/types.ts`'s
`BUDGET` constant at the time this document was written. **`src/types.ts` is the
source of truth**; if the two ever disagree, trust the code.

| Budget | Value | What it bounds |
|---|---|---|
| `OPS` | 20,000 | sandbox interrupt checks per verb invocation (an operation count, not a wall-clock timeout; see `src/sandbox.ts`) |
| `MEMORY` | 64 × 1024 × 1024 = 67,108,864 bytes (64 MiB) | the QuickJS runtime's memory limit |
| `STACK` | 512 × 1024 = 524,288 bytes (512 KiB) | the QuickJS runtime's max stack size |
| `INPUT` | 64 × 1024 = 65,536 bytes (64 KiB) | a verb invocation's JSON input, checked before schema validation |
| `RESULT` | 256 × 1024 = 262,144 bytes (256 KiB) | a verb's JSON result, checked after execution |
| `STATE` | 1024 × 1024 = 1,048,576 bytes (1 MiB) | the whole state document, checked on init, seed, and after every invocation |
| `CHARTER` | 256 × 1024 = 262,144 bytes (256 KiB) | the whole charter document, checked by `checkCharter` on mint and amend |
| `FACE` | 512 × 1024 = 524,288 bytes (512 KiB) | a face's HTML, checked on `PUT /f/<name>` |
| `SIGNAL` | 4 × 1024 = 4,096 bytes | a presence message over the socket, counted in UTF-8 bytes, not JS string length |
| `HISTORY` | 10 | charter versions kept per app; the oldest is dropped once history would exceed this count |

A verb whose invocation's input passes `INPUT` and schema validation still runs
under `OPS`/`MEMORY`/`STACK` inside the sandbox; its `result` and the app's new
`state` are checked against `RESULT` and `STATE` only after it returns. A verb
that exceeds either loses its write (state is reported unchanged) even though the
code already ran.

## 5. Schema subset

`inputSchema` (on every verb) is not general JSON Schema. `src/schema.ts` accepts
exactly these node shapes, and rejects any other key present on a node outright:
unknown keys are an error, not silently ignored.

| `type` | allowed keys |
|---|---|
| `object` | `type`, `description`, `properties`, `required` |
| `array` | `type`, `description`, `items` |
| `string` | `type`, `description`, `enum`, `minLength`, `maxLength` |
| `number` / `integer` | `type`, `description`, `enum`, `minimum`, `maximum` |
| `boolean` | `type`, `description` |

`properties` must be an object (not an array, not `null`); every name listed in
`required` must be a declared property. An `array` node must declare `items`.
Nesting is capped at depth 8: the root schema is depth 0, and a node past depth 8
is rejected at charter-validation time (mint or amend), never at invocation time.

Input validation (`checkInput`, run on every `POST /a/<id>/rpc/<verb>` before the
verb's code executes) is strict, not permissive: an object carrying a property
`properties` doesn't declare is **rejected outright**, never silently stripped.
Required properties must be present. Values are checked against their declared
constraints (`minLength`/`maxLength` for strings, `minimum`/`maximum` for numbers,
`enum` for both).

## 6. Socket protocol

`GET /a/<id>/ws` upgrades to a WebSocket, gated by visibility exactly like every
other `/a/<id>` route. On connect, the server sends the current state immediately.

**Server to client**, three message types:

- `{"type": "state", "state": <state>}`: on connect, and after every state
  change (an invocation, a seed).
- `{"type": "charter", "charter": <charter>}`: after every amendment or
  rollback.
- `{"type": "pong"}`: in reply to a client `ping`.

**Client to server**, two message shapes:

- the literal string `ping` (not JSON), answered with `pong`.
- `{"type": "presence", ...}`, under the `SIGNAL` budget, relayed verbatim to
  every *other* watcher on the same app. Never sent back to its sender, never
  stored, never folded into state. Over-budget or malformed messages (not valid
  JSON, or valid JSON without `type: "presence"`) are dropped silently: the
  sender gets no error and the connection stays open.

**Ordering.** Invocations on one app are serialized (`App.runSerial`), and a
broadcast for one invocation happens inside that same serialized step, so watchers
receive states in the order the invocations actually occurred; a reconnecting
watcher resumes from the current state via the connect-time send. Two messages
sent on one client socket are handled by the server in the order they were sent.

**Visibility and closing sockets.** An app that is amended or rolled back to
`law.visibility === "private"` closes every currently open socket on that app,
with close code `4001`. This is the one case where the platform tears down a
connection unilaterally rather than waiting for the client. The sequence is:
broadcast the new charter first, then close, so a socket about to be dropped still
learns why before it goes. Only `private` triggers this; an amendment to
`unlisted` leaves existing watchers connected, since `unlisted` still admits
anyone already holding the link.

This close happens in two places, deliberately redundant:

- `App.amend` and `App.rollback` call `closeSocketsIfPrivate` directly after
  broadcasting the new charter (`src/app.ts`).
- The `/ws` upgrade handler itself, both in the Worker router (`src/index.ts`,
  the app-wide visibility gate ahead of every `/a/<id>` route) and again inside
  the App DO's own `fetch` (`src/app.ts`), rejects a *new* connection outright if
  the app is currently private and the caller isn't the owner. The DO's own check
  exists because the router's gate is two round trips (read the charter, then
  upgrade), and an amendment to private can land in the gap between them; the DO
  re-checks against its own, already-serialized view of the charter, so there is
  no window left to race.

## 7. WebMCP mapping

`face/runtime.js`'s `toolsFromCharter` is the whole mapping. It runs once per
charter (initial connect, and again after every `{"type":"charter",...}` socket
message) and produces one WebMCP tool per verb with `access: "public"`. An
`owner`-only verb is never turned into a tool, for any caller, including the
owner using a face.

| Charter field | WebMCP tool field |
|---|---|
| verb name | tool `name` |
| `verb.description` | tool `description` |
| `verb.inputSchema` | tool `inputSchema`, unchanged |
| (fixed, not from the charter) | `annotations: { untrustedContentHint: true }`, always, on every tool |
| (fixed, not from the charter) | `execute(input)` calls `POST /a/<id>/rpc/<name>` and wraps the result as `{content: [{type: "text", text: JSON.stringify(result)}]}` |

`untrustedContentHint` is always `true`, regardless of what a given verb does: a
face's tools carry data that ultimately comes from app state (and, through
`allowedHosts`, from whatever hosts a verb can reach), never from a trusted
operator, so the browser is told that on every single tool rather than being
asked to guess per-verb.

**Registration.** `connect()` calls `document.modelContext.registerTool` for
each tool if `document.modelContext` exists (skipped entirely outside a browser,
or if the caller passes `{tools: false}`). Tools are held under one
`AbortController` per charter generation. Whenever the charter changes,
`retool()` rebuilds the verb bindings and re-registers from scratch: it aborts the
previous controller, deregistering every tool it owned, then registers the current
verb set fresh under a new one. There is no incremental diff. An amendment that
touches one verb still causes every tool to be deregistered and re-registered.
