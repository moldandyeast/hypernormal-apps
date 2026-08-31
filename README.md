# Hypernormal

There is no perfect interface. Mobile, tablet, desktop were breakpoints; now
the breakpoint is context: device, situation, attention, ability, whether the
user is human at all. Some people want to talk to an app. Some meet it inside
another app. Some need it glanceable, some need it deep. Agents are learning
to read the room: not just files and world state but where we are, what we are
doing, how much space we have. One fraud alert, two expressions. On the go and
stressed, the right interface may be none at all, just "blocked, we will solve
this later." At the desk with mental space: "this happened, I blocked it, want
to investigate together?"

An app is a spreadsheet wearing an experience. Apps have always been data with
an experience layer on top; add functions to a spreadsheet and you have a
program. We collect static files and call them second brains, but knowledge
and language are never static. So here the file becomes a small durable state
machine at a URL: replayable like a log, watched over a WebSocket, written by
many hands, its id tied to its host so it carries provenance and identity.
Multiplayer by default.

Separate church from state. The church is the designed expression; the state
is the data and the verbs. Smart contracts made the frontend optional, anyone
can build one or interact with the contract directly, but their manuals live
outside, in docs. Here the manual is baked in. Ping the address and you
receive the charter: what it is, what it can do, how to speak to it. A
stranger with nothing but the URL has everything.

The intelligence stays outside. The platform stores state and runs verbs; it
decides nothing. Every decision arrives from outside, carried by whoever
visits: a person, a script, an agent. Intelligence added from outside rather
than built into the center makes many actors natural, closer to biology, a
swarm of actors around shared state, than to platforms.

One app, many lenses. A creator ships views; the user is not tied to them.
Use an app as the creator intended, use it through your agent, its verbs
becoming tools over WebMCP, or have an agent derive an interface, a face of
your own, from the charter alone. The same schema serves the person who can only speak, the person who
cannot see, the person who wants one number on a watch face. Accessibility
stops being a separate version.

None of this abolishes design. It multiplies the places where design happens:
someone still shapes the chat's tone, the glanceable widget, the deep view.
It is just no longer bound to one app. Faces compose like lego: one interface
over many apps, disposable, built for a moment. Tokens per second keep
rising; UI arrives just in time.

The live site, [hypernormal.moldandyeast.com](https://hypernormal.moldandyeast.com),
walks this argument as its own white paper: three apps hold its words, its
look, and its memory; the page is one face over them. The proof is that it
runs. Fork it.

## The library

Hypernormal is the argument above, built as a library for durable faceless
apps. An app is a pair: a charter and a state, living at one URL. The charter
says what the app is and what it can do; the state is what it remembers. Both
persist on their own, with no page open and no process running. The platform
stores state and runs the app's verbs. It holds no intelligence of its own:
every decision arrives from outside, carried by whoever calls the app.

An app has no built-in interface. Interfaces are derived from the charter, by
anyone, at any time, and none of them is the app. A person reaches an app the
same way an agent does, through the same three doors.

This repository is the foundation: the library you fork and deploy to run your
own installation. `DEFINITION.md` is the governing specification; this README
is the tour.

## The three words

- **Durable.** An app's address, state, and behavior persist on their own.
  Closing every browser tab in the world changes nothing about the app.
- **Headless.** The platform calls no model, holds no model key, and makes no
  decision. It stores state and runs verbs. The intelligence is always the
  caller's.
- **Faceless.** An app has no canonical interface. Faces are derived,
  disposable, and never the app itself. Several can exist at once, and an app
  needs none of them.

## What an app is

```
app = (charter, state)
charter = (intent, verbs, law)
verb = (name, description, inputSchema, code, access)
```

The **intent** is prose: what the app is for, its rules, and the shape of its
state, written well enough that someone who has never seen the app can use it
and build an interface for it from the charter alone.

A **verb** is the unit of behavior. Its `code` is the body of a synchronous
JavaScript function that reads `ctx.input` and `ctx.state`, changes the state,
and returns a result. Its `description` and `inputSchema` describe it well
enough for an agent to call it without guessing. Its `access` is `owner` or
`public`.

The **state** is one JSON document, the app's only memory, written only by
verbs. The **law** is the access rules: a visibility (`private`, `unlisted`,
`public`) and a list of hosts the verbs may reach.

An app is created by minting a charter, not by deploying code. There is no
build step and no per-app server. The platform is deployed once; every app
after that is data.

## How it works

**Each app is a Durable Object.** Its charter, state, and history live in one
small SQLite-backed unit of storage and compute on Cloudflare. One app cannot
reach into another's storage. A second Durable Object, a singleton, keeps the
index of apps and the stored faces.

**Verbs run in a sandbox.** Verb code executes in QuickJS compiled to
WebAssembly, a fresh context per call, with bounded operations, memory, and
stack. It sees exactly `ctx.input`, `ctx.state`, a clock frozen at invocation,
a random source seeded at invocation, and, only if the app's law names allowed
hosts, a blocking HTTP helper restricted to those hosts. It cannot reach the
network otherwise, read files, import modules, run asynchronously, see another
app, or exceed its budgets. Because the clock and randomness are injected, a
verb with no allowed hosts is a pure function of its inputs and reproducible.

**One invocation is atomic and serialized.** Input is validated against the
verb's schema before any code runs. On success the new state is written once
and every watcher is notified; on failure nothing is written and the caller
gets the error in plain language. Invocations on one app run one at a time, in
order, so there is no lost update and no partial write.

**Watching is live.** Anyone the law admits can hold a WebSocket to an app. On
connect they receive the full state; after every change they receive the full
new state; after every amendment they receive the new charter. Two people
watching the same URL see the same thing at the same moment. Small ephemeral
signals (cursors, presence) are relayed between watchers and never stored.

**An app can act on its own.** A charter may carry a schedule. At each time
the schedule names, the platform runs the named verb with no caller present.
This is how an app changes while no one is watching.

## The three doors

One charter, three ways in. Nothing is declared twice; each door is a
projection of the same charter. This is how one app carries many lenses.

- **Call.** Plain HTTP. `GET` the charter, `GET` the state, `POST` to invoke a
  verb, open a WebSocket to watch. Anything that can fetch a URL is a full
  client. There is no SDK and none is required.
- **Operate.** A face registers the app's public verbs as tools with the
  browser, through the WebMCP API where the browser has one. The person's own
  agent then acts on the app through those tools while the person watches the
  same live state. The mapping is mechanical: a verb's description becomes the
  tool's description, its schema becomes the tool's input schema, an invocation
  becomes a tool call.
- **Derive.** An agent reads the charter and the state and builds an interface
  on the spot, shaped for that person. A stranger's agent, given only the URL,
  has everything it needs.

The rule that ties the three together: a charter is complete only if all three
doors work from it alone. A door that fails indicts the charter, not the door.

## Why it is different

**Apps are data, not deploys.** A normal app is code you write, build, and
host. Here you deploy the platform once, and every app after that is minted at
runtime as a charter and a state. There is no build and no per-app deploy, so
an app can come into existence from a sentence and be shared as a link the
same second.

**The platform never thinks.** There is no model running on the server and no
API key anywhere in the platform. This is the opposite of an agent framework
that puts the model in the loop on the server. Here the model is always on the
caller's side, and the platform is only storage and execution. That is what
makes it cheap to run and safe to hand around.

**It complements backend tool protocols instead of replacing them.** A backend
Model Context Protocol server exposes tools an agent talks to directly,
bypassing the app's own interface and replicating the user's state and auth on
a separate server. Hypernormal keeps the app whole: the verbs are the app's
own behavior, the state is shared and live, and the human and the agent work
on the same app at once. WebMCP is how a browser agent reaches those verbs; the
durability, the shared state, and the ability to exist without an open page are
what a page-scoped tool set does not have.

**One URL is the whole thing.** The URL is the app's identity, its API, a live
object to watch, and a document an agent can build from. Sharing is a link.
Everyone who opens the same URL shares the same state.

## What it makes possible

- An agent can bring a durable, shareable app into existence from a
  description, with no deploy, and hand back a URL.
- A person and their agent can operate an app together: the person watches the
  live state, the agent drives the verbs as browser tools, both looking at the
  same thing.
- Behavior is malleable. Verbs are data. They can be amended, rolled back to an
  earlier version, and forked into a new app. When a verb fails, the error
  comes back readable, so an agent can fix the code and save it, and the app
  heals in place.
- Apps are multiplayer by default. One state per URL, live to every watcher,
  with no frontend to host.
- Apps stay safe to combine because you always reach an app through its verbs,
  never its data. Cross-app invocation is a documented next step, not yet in
  this foundation; the model is built for it.

## Fork and deploy

This is a Cloudflare Worker. It needs one secret and nothing else to run.

```bash
npm install
npx wrangler secret put OWNER_KEY   # a key you choose; this is the whole credential
npm run deploy
```

`npm run deploy` builds before deploying: it copies the QuickJS WebAssembly
blob into `src/quickjs.wasm` and the face runtime's real source
(`face/runtime.js`) into `src/runtime-source.txt`, then runs `wrangler deploy`.
Both generated files are gitignored. The Worker serves `src/runtime-source.txt`
verbatim at `GET /runtime.js`, so what ships to browsers is always exactly
`face/runtime.js`, copied, not reimplemented. `npm run dev` and `npm test` run
the same build step first.

Sign in at `https://<your-worker>.<subdomain>.workers.dev/login` with the key
you set. Then read `GET /`, the manual: the whole contract, written for an
agent that has only the URL and has never seen this installation.

## Using an installation

Everything an agent needs is at `GET /`. In outline:

- **Mint an app.** `POST /apps` with a charter (owner only by default). You get
  back a URL and the app's admin key. An installation can open minting to
  guests by setting `OPEN_MINT`; see below.
- **Use an app.** `GET /a/<id>` for the charter, `GET /a/<id>/state` for the
  state, `POST /a/<id>/rpc/<verb>` to invoke, `GET /a/<id>/ws` to watch. None of
  these needs a credential beyond what the app's law requires.
- **Reshape an app.** `PUT /a/<id>` amends the charter, `POST /a/<id>/rollback`
  restores a version, `POST /a/<id>/fork` makes a copy. These need the owner
  key.
- **Serve a face.** `PUT /f/<name>` stores an HTML face; `GET /f/<name>` serves
  it. A face is one self-contained page that includes `/runtime.js`, renders
  the state, and calls the verbs. The `examples/` directory has three complete
  charter-and-face pairs (`shared-list`, `poll`, `pulse`) worth reading before
  writing your own.

`scripts/hn.sh` is a small owner-authenticated CLI for talking to your own
installation from a shell. Run it with no arguments for usage.

The full route table, the error form, the budget table, the schema subset a
charter's `inputSchema` may use, the socket protocol, and the WebMCP mapping
are all in `PROTOCOL.md`.

## Optional environment

Neither is required. Set them as plain vars in `wrangler.jsonc`, or with
`npx wrangler secret put <NAME>`.

- **`OPEN_MINT`.** Set to exactly the string `"true"` to let guests mint apps.
  Any other value, including `"1"`, or leaving it unset, keeps minting closed
  to everyone but the owner. A guest-minted app has its allowed-hosts list
  forced empty, so opening minting does not turn the installation into an open
  HTTP proxy; the owner can amend a guest app's law afterward.
- **`WEBMCP_OT_TOKEN`.** A Chrome origin-trial token for the WebMCP API. When
  set, the Worker injects it as an `origin-trial` meta tag into the head of
  every face served at `GET /f/<name>`. When unset, a face is served exactly as
  written.

## A note on trust

Two properties are worth understanding before you hand an installation's URL
around.

**WebMCP tool registration is same-origin by default.** A face registers an
app's verbs as browser tools only when the app is on the same origin as the
face. A tool's description is text a browser agent reads as instructions, so a
face must not register descriptions authored by an app on some other origin.
The face runtime refuses to do so unless you pass `{ tools: "cross-origin" }`
to `connect()` explicitly. Cross-origin reading and watching still work; only
tool registration is gated.

**Installing a face runs its code as the owner.** A face served at `GET /f/<name>`
runs on the installation's own origin, so when the owner opens it, its requests
carry the owner's session. Install only faces you wrote or trust, the same way
you would only run a script you trust. Serving faces from a separate origin is
a reasonable hardening for an installation that accepts faces from elsewhere.

## Rate limiting

`PUBLIC_RL` and `LOGIN_RL` in `wrangler.jsonc` are Cloudflare rate-limiting
bindings and require a plan that supports them. If your plan does not, the
binding is simply absent at runtime, the platform's own check treats "no
binding" as "never limited," and the deploy works exactly as described above.
The only difference is that login attempts, guest minting, and app traffic have
no abuse limit enforced. Worth knowing before opening `OPEN_MINT` or handing an
installation's URL around widely.

## What this is, and is not

This is the foundation library, complete and tested, for running durable
faceless apps. It is not a finished product line on top of that foundation: the
proof-of-concept applications and the demo that show the idea at its best are a
separate layer, designed on top of this one.

WebMCP is an emerging browser API, in origin trial in Chrome and Edge at the
time of writing. The Call and Derive doors work in any browser and any client;
the Operate door depends on a browser that exposes the WebMCP API. The face
runtime degrades cleanly where it is absent: the app still works, the tools
just do not register.

## Reference

- `DEFINITION.md`: the governing specification. The vocabulary and what the
  platform does and refuses to do.
- `PROTOCOL.md`: the wire protocol. Every route, the error form, the budgets,
  the schema subset, the socket protocol, and the WebMCP mapping.
- `examples/`: three complete charter-and-face pairs.
- `scripts/hn.sh`: the owner CLI.
- [hypernormal.moldandyeast.com](https://hypernormal.moldandyeast.com): the
  live site, the argument at the top of this README as a live white paper.

## License

MIT. See `LICENSE`.
