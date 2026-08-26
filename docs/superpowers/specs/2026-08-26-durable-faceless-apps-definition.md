# Durable Faceless Apps

A definition.

Status: approved 2026-08-26. This document is the foundation of the library. Code implements it; nothing in code may contradict it.

## The three words

**Durable.** An app's address, state, and behavior persist on their own. They do not depend on any open page, process, session, or interface. Closing every browser tab in the world changes nothing about the app.

**Headless.** The platform contains no intelligence. It stores state and executes verbs. It calls no model, holds no model key, and makes no decision. All intelligence arrives from outside, carried by whoever visits.

**Faceless.** An app has no canonical interface. Interfaces are derived from the app's own description, by anyone, at any time. Several can exist at once. None of them is the app.

## Objects

**App.** A pair: `app = (charter, state)`. One app lives in one Durable Object and is reachable at one URL. The URL is the app's identity.

**Charter.** The app's founding document: `charter = (intent, verbs, law)`. The charter fully describes the app. Anything a visitor must know and cannot learn from the charter is a defect in the charter.

**Intent.** Prose. States what the app is for, its rules, and the shape of its state. The test of an intent: an agent that has never seen the app, given only the URL, can use the app and build a correct interface for it without asking one question.

**Verb.** The unit of behavior: `verb = (name, description, inputSchema, code, access)`.

- `name`: identifier, unique within the app.
- `description`: prose. What invoking the verb means, not what the code does.
- `inputSchema`: a JSON Schema describing the verb's input.
- `code`: the body of a synchronous JavaScript function, stored as text.
- `access`: `owner` or `public`.

**State.** One JSON document. It is the app's only memory. Readable by every visitor the law admits. Written only by verbs, with one exception listed under Acts.

**Law.** The app's access rules: `law = (visibility, allowedHosts)` plus each verb's `access`.

- `visibility`: `private`, `unlisted`, or `public`. Private: owner only. Unlisted: anyone holding the link. Public: anyone, and the app is listed.
- `allowedHosts`: a list of hostnames the app's verbs may reach over HTTPS. Empty by default.

**Face.** An HTML document that renders an app's state and invokes its verbs. A face is derived from the charter and is disposable: deleting a face never touches the app. An app may have many faces or none.

**Owner.** Exactly one per installation. Holds the key. Everyone else is a **guest**: no account, no registration, identified by nothing but possession of a link.

**Agent.** Any software that can read the charter and act on it. Agents author apps, repair them, derive faces, and use apps on a person's behalf. The platform does not distinguish agents from other callers.

## Execution

A verb invocation is the only event in the system. Its form:

```
caller invokes verb(input) on app
state  ->  state'
caller receives result
watchers receive state'
```

The contract of one invocation:

1. Input is validated against `inputSchema`. Invalid input is rejected before any code runs.
2. The code runs in a sandbox. It sees exactly: `input`, `state`, a clock fixed at invocation time, a random source seeded at invocation time, and, if `allowedHosts` is not empty, a blocking HTTP helper restricted to those hosts.
3. The code can not: reach the network otherwise, read files, import modules, run asynchronously, see another app, or exceed its budgets. Budgets bound operations, memory, and stack depth. A verb that exceeds a budget fails.
4. The invocation is atomic. If the code completes, the new state persists and the result returns to the caller. If it fails, state is unchanged and the caller receives the error. There is no partial write.
5. Invocations on one app execute one at a time, in arrival order. There is no concurrent write within an app.
6. A verb's result goes only to its caller. State goes to everyone watching. These are the system's two channels, and they differ: the result is private to the caller, state is shared.

A consequence worth stating: a verb whose app has no `allowedHosts` is a pure function of `(state, input, clock, seed)`. Its behavior is reproducible.

## Reaching an app

One charter, three projections. Nothing is declared twice.

**Call.** Plain HTTP. `GET` the charter, `GET` the state, `POST` an invocation, open a WebSocket to watch. Any process that can fetch a URL is a full client. No SDK exists and none is required.

**Operate.** A face registers the app's public verbs as tools with the browser, using the browser's tool API where the browser has one. The person's own agent then acts on the app through the face while the person watches the same state. The mapping is mechanical: `description` to description, `inputSchema` to input schema, invocation to tool call.

**Derive.** An agent reads the charter and state and constructs a new interface on the spot. Derivation needs nothing beyond what Call already exposes.

The completeness rule: a charter is complete only if all three projections work from it alone. A projection that fails indicts the charter, not the projection.

## Time

An app may carry a schedule: `schedule = (cron, verb)`. At each time the expression names, the platform invokes the scheduled verb with no caller. This is the one exception to "every event has a caller," and the reason an app can act while no one is present.

## Memory of the charter

Every change to a charter appends the previous charter to a bounded history. A rollback restores a named version and is itself recorded. History covers the charter only. State has no history.

## Acts

Acts change what exists. Invocations change state; acts change apps.

- **Mint.** Create an app from a charter and an optional initial state. Owner only.
- **Amend.** Replace parts of a charter: intent, verbs, law. Owner only. A failed verb returns its error in prose plain enough that an agent can amend the code and try again.
- **Fork.** Copy a charter, and optionally state, to a new URL under a new owner key. History does not copy.
- **Seed.** Replace state wholesale. Owner only. This is an administrative act, the one write that bypasses verbs.
- **Retire.** Delete an app. The URL stops resolving.

## Watching

Anyone the law admits may hold a WebSocket to an app. On connect, the watcher receives the full state. After every state change, every watcher receives the full new state. Watchers may relay small ephemeral signals to each other through the app (cursors, presence). These signals are never stored and never enter state.

Faces trust the socket: a face hydrates from the state message it receives on connect, not from a separate read. The socket's state is the single source of truth for every face.

## What the platform refuses

- No accounts. One owner key per installation, links for everyone else.
- No server-side model calls, ever. A platform that thinks is a different thing.
- No build step and no deploy step for apps. Apps are data.
- No SDK requirement. HTTP and JSON are the whole contract.
- No canonical face. The platform serves faces; it does not prefer one.
- No unbounded execution. Every budget is finite and enforced.

## Deferred, deliberately

Named here so their absence reads as a decision: a private state tier, owner-set secrets with output scrubbing, app-to-app invocation, per-user identity, tool discovery beyond the URL. Each can be added without changing any definition above.
