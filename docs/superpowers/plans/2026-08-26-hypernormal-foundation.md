# Hypernormal Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Hypernormal library: a forkable Cloudflare Workers repository implementing the durable faceless apps definition, with kernel, routes, face runtime, WebMCP bridge, examples, and docs.

**Architecture:** One Worker fronts two SQLite-backed Durable Object classes: `App` (one per app: charter, state, history, sockets, alarm) and `Registry` (singleton: app index, faces). Verbs execute in a QuickJS sandbox through a per-app serial chain with atomic single-row state. The face runtime is one ES module that projects the charter into live values, verb functions, and WebMCP tools.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (SQLite), QuickJS via `quickjs-emscripten-core` + `@jitl/quickjs-wasmfile-release-asyncify`, `croner`, vitest + `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-08-26-hypernormal-foundation-design.md` (governed by `docs/superpowers/specs/2026-08-26-durable-faceless-apps-definition.md`).

## Global Constraints

- The definition governs. Vocabulary everywhere: charter, verb, state, face, intent, law, mint, amend, seed, fork, retire. Never "manifest", "function", "prompt".
- Docs register: no em-dashes, no hype words, every claim checkable.
- Error form everywhere: `{ok: false, error: "<message an agent can act on>"}`. Denials are 404, never 403.
- Budgets live in `src/types.ts` only; every other place reads them from there.
- Verb names: `/^[a-zA-Z0-9_-]{1,64}$/`.
- Ancestors for ports are cloned at `.context/repos/farnsworth-house` and `.context/repos/durable-headless-apps`. Copy pinned dependency versions from `.context/repos/farnsworth-house/package.json` verbatim: `@jitl/quickjs-wasmfile-release-asyncify ^0.32.0`, `quickjs-emscripten-core ^0.32.0`, `croner ^9.0.0`, `qrcode-generator ^2.0.4`, `miniflare 4.20260708.1` (exact), `@cloudflare/vitest-pool-workers ^0.18.4`, `@cloudflare/workers-types ^5.20260713.1`, `typescript ^5.9.0`, `vitest ^4.1.10`, `wrangler ^4.110.0`. All confirmed present in the ancestor at plan-writing time.
- All code lands at the repository root (this repo becomes the library; publish is a later curated copy).
- TDD per task: failing test first, then code, then green, then commit.

---

### Task 1: Scaffold, health route, QuickJS wasm smoke test

**Files:**
- Create: `package.json`, `wrangler.jsonc`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `DEFINITION.md`, `src/index.ts`, `src/types.ts`, `src/wasm.d.ts`, `test/health.test.ts`, `test/wasm.test.ts`, `test/tsconfig.json`

**Interfaces:**
- Produces: `BUDGET` constants and charter types in `src/types.ts` used by every later task; a deployable Worker skeleton with `GET /health`.

- [ ] **Step 1: Copy scaffolding from the ancestor and adjust**

Copy these from `.context/repos/farnsworth-house/`: `tsconfig.json`, `test/tsconfig.json`, `.gitignore`, `vitest.config.ts` (keep `isolatedStorage: false, singleWorker: true` and the miniflare comment). Create `package.json` with name `hypernormal`, private, and the same pinned versions as the ancestor's `package.json` for: `quickjs-emscripten-core`, `@jitl/quickjs-wasmfile-release-asyncify`, `croner`, `wrangler`, `vitest`, `@cloudflare/vitest-pool-workers`, `miniflare` (exact pin), `typescript`. Scripts:

```json
{
  "scripts": {
    "dev": "npm run build:wasm && wrangler dev",
    "deploy": "npm run build:wasm && wrangler deploy",
    "build:wasm": "node -e \"require('fs').copyFileSync(require.resolve('@jitl/quickjs-wasmfile-release-asyncify/dist/emscripten-module.wasm'), 'src/quickjs.wasm')\"",
    "test": "npm run build:wasm && vitest run",
    "typecheck": "wrangler types && tsc --noEmit"
  }
}
```

Create `wrangler.jsonc`:

```jsonc
{
  "name": "hypernormal",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-01",
  "workers_dev": true,
  "durable_objects": {
    "bindings": [
      { "name": "APP", "class_name": "App" },
      { "name": "REGISTRY", "class_name": "Registry" }
    ]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["App", "Registry"] }],
  "rules": [{ "type": "CompiledWasm", "globs": ["**/*.wasm"], "fallthrough": true }],
  "unsafe": {
    "bindings": [
      { "name": "PUBLIC_RL", "type": "ratelimit", "namespace_id": "3001", "simple": { "limit": 200, "period": 60 } },
      { "name": "LOGIN_RL", "type": "ratelimit", "namespace_id": "3002", "simple": { "limit": 10, "period": 60 } }
    ]
  }
}
```

In `vitest.config.ts` set miniflare bindings `{ OWNER_KEY: "test-owner-key" }`.

Create `LICENSE` (MIT, copyright holder "RM"). Create `DEFINITION.md` by copying `docs/superpowers/specs/2026-08-26-durable-faceless-apps-definition.md` and changing the Status line to: `Status: governing. Code implements this document; nothing in code may contradict it.`

Copy `src/wasm.d.ts` from `.context/repos/farnsworth-house/src/wasm.d.ts` (declares `*.wasm` as `WebAssembly.Module`).

Create `src/types.ts`:

```ts
export const BUDGET = {
  OPS: 20_000,          // sandbox interrupt checks
  MEMORY: 64 * 1024 * 1024,
  STACK: 512 * 1024,
  INPUT: 64 * 1024,     // bytes of JSON
  RESULT: 256 * 1024,
  STATE: 1024 * 1024,
  CHARTER: 256 * 1024,
  FACE: 512 * 1024,
  SIGNAL: 4 * 1024,
  HISTORY: 10,          // charter versions kept
} as const;

export type Access = "owner" | "public";
export type Visibility = "private" | "unlisted" | "public";

export interface SchemaNode {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

export interface Verb {
  description: string;
  inputSchema: SchemaNode;
  code: string;
  access: Access;
}

export interface Law {
  visibility: Visibility;
  allowedHosts: string[];
}

export interface Charter {
  intent: string;
  verbs: Record<string, Verb>;
  law: Law;
  schedule?: { cron: string; verb: string };
}

export interface Env {
  APP: DurableObjectNamespace;
  REGISTRY: DurableObjectNamespace;
  OWNER_KEY?: string;
  OPEN_MINT?: string;
  WEBMCP_OT_TOKEN?: string;
  PUBLIC_RL?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  LOGIN_RL?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}
```

Create `src/index.ts` (skeleton, grows in later tasks):

```ts
import type { Env } from "./types";
export { App } from "./app";
export { Registry } from "./registry";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false, error: "no route" }, { status: 404 });
  },
};
```

Until Task 6 and Task 10 exist, create placeholder DO classes so the Worker compiles: `src/app.ts` and `src/registry.ts` each exporting a class with `fetch()` returning `Response.json({ ok: false, error: "no route" }, { status: 404 })`, extending `DurableObject` from `"cloudflare:workers"`.

- [ ] **Step 2: Write the failing tests**

`test/health.test.ts`:

```ts
import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("health", () => {
  it("responds ok", async () => {
    const res = await SELF.fetch("https://x/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  it("404s unknown routes with the error form", async () => {
    const res = await SELF.fetch("https://x/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  });
});
```

`test/wasm.test.ts` (proves the CompiledWasm path before anything builds on it):

```ts
import { describe, it, expect } from "vitest";
import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-wasmfile-release-asyncify";
// @ts-expect-error wasm module import
import wasmModule from "../src/quickjs.wasm";

describe("quickjs wasm", () => {
  it("loads and evaluates", async () => {
    const mod = await newQuickJSAsyncWASMModuleFromVariant(newVariant(variant, { wasmModule }));
    const vm = mod.newRuntime().newContext();
    const out = vm.unwrapResult(vm.evalCode("1 + 1"));
    expect(vm.getNumber(out)).toBe(2);
    out.dispose();
    vm.dispose();
  });
});
```

Note: if the ancestor's `sandbox.ts` imports the wasm by relative node_modules path instead of the copied file, mirror whatever `.context/repos/farnsworth-house/src/sandbox.ts` actually does; the copy script then becomes unnecessary and should be removed. Match the ancestor exactly; it is the proven pattern.

- [ ] **Step 3: Run tests, expect failure** (`npm install` first)

Run: `npm test`
Expected: FAIL (missing files, then failing assertions) until Step 1 files are complete; iterate until green.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Scaffold: worker skeleton, budgets, quickjs wasm proven"
```

---

### Task 2: WebMCP local proof page (human checkpoint)

**Files:**
- Create: `examples/webmcp-proof.html`, `docs/webmcp-verification.md`

**Interfaces:**
- Produces: evidence that `document.modelContext.registerTool` works locally before the library depends on it.

- [ ] **Step 1: Create the proof page**

`examples/webmcp-proof.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>webmcp proof</title>
<h1>webmcp proof</h1>
<p id="out">tools: not registered</p>
<script>
  const out = document.getElementById("out");
  if (!("modelContext" in document)) {
    out.textContent = "document.modelContext is absent. Enable chrome://flags/#enable-webmcp-testing and relaunch.";
  } else {
    document.modelContext.registerTool({
      name: "echo",
      description: "Returns the text it is given. Exists to prove tool registration works.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      async execute({ text }) { return { content: [{ type: "text", text }] }; }
    }).then(() => { out.textContent = "tools: echo registered"; });
  }
</script>
```

- [ ] **Step 2: Write the verification doc**

`docs/webmcp-verification.md`: instructions to open Chrome with `chrome://flags/#enable-webmcp-testing` enabled, serve the file (`npx serve examples` or `python3 -m http.server`), install the Model Context Tool Inspector extension, confirm the `echo` tool appears and executes. Record the Chrome version and result in this file under a `## Log` heading.

- [ ] **Step 3: Human checkpoint**

STOP and ask the human to run the verification and paste the result into the log. Do not proceed on a failure; the spec names this the single point of failure.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Add local WebMCP proof page and verification log"
```

---

### Task 3: Sandbox port

**Files:**
- Create: `src/sandbox.ts`, `test/sandbox.test.ts`, `test/sandbox-http.test.ts`

**Interfaces:**
- Produces:

```ts
export type HostHttp = {
  get(url: string, headers?: Record<string, string>): Promise<{ status: number; body: string } | { error: string }>;
  post(url: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; body: string } | { error: string }>;
};
export type ExecResult = { ok: true; result: unknown; state: unknown } | { ok: false; error: string };
export async function execute(code: string, state: unknown, input: unknown, opts?: { hostHttp?: HostHttp }): Promise<ExecResult>;
```

- [ ] **Step 1: Port with named deletions**

Copy `.context/repos/farnsworth-house/src/sandbox.ts` to `src/sandbox.ts`. Then:

1. Delete everything for `ctx.secrets` (the `__deepFreeze` injection), `ctx.private`, and `ctx.call` / `__call` (deferred features). The returned program JSON drops `private`.
2. Budgets come from `BUDGET` in `./types`: `CYCLE_BUDGET` becomes `BUDGET.OPS`, memory `BUDGET.MEMORY`, stack `BUDGET.STACK`. Delete local constants.
3. Keep: per-invocation runtime+context, interrupt handler, `now` fixed at invocation, seeded `random()`, `http` attached only when `opts.hostHttp` is provided, the IIFE wrapper, `undefined` result normalized to `null`, the asyncify teardown quirk with its comment, string-body-verbatim vs object-body-JSON rule in the http shim.
4. Export exactly the signature above.

- [ ] **Step 2: Port and adjust the tests**

Copy `.context/repos/farnsworth-house/test/sandbox.test.ts` and `test/sandbox-http.test.ts`; delete cases for secrets/private/call; update imports. Ensure these cases remain (add if the ancestor lacks them):

```ts
it("enforces the ops budget", async () => {
  const r = await execute("while(true){}", {}, {});
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/interrupt|budget|timeout/i);
});
it("mutates state atomically in-sandbox and returns it", async () => {
  const r = await execute("ctx.state.n = (ctx.state.n ?? 0) + 1; return ctx.state.n;", {}, {});
  expect(r).toMatchObject({ ok: true, result: 1, state: { n: 1 } });
});
it("has no http without hostHttp", async () => {
  const r = await execute("return typeof ctx.http;", {}, {});
  expect(r).toMatchObject({ ok: true, result: "undefined" });
});
it("freezes the clock and seeds randomness", async () => {
  const r = await execute("const a = ctx.now; const b = ctx.now; return { same: a === b, rnd: typeof ctx.random() };", {}, {});
  expect(r).toMatchObject({ ok: true, result: { same: true, rnd: "number" } });
});
```

- [ ] **Step 3: Run, expect fail, fix, expect pass**

Run: `npx vitest run test/sandbox.test.ts test/sandbox-http.test.ts`

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Port QuickJS sandbox with budgets, minus deferred capabilities"
```

---

### Task 4: safe-fetch port

**Files:**
- Create: `src/safe-fetch.ts`, `test/safe-fetch.test.ts`

**Interfaces:**
- Produces: `assertAllowed(rawUrl: string, allowedHosts: string[]): void` (throws coded errors) and `safeFetch(url: string, init: RequestInit, opts: { allowedHosts: string[]; timeoutMs?: number; maxBytes?: number }): Promise<Response>`.

- [ ] **Step 1: Copy unchanged**

Copy `.context/repos/farnsworth-house/src/safe-fetch.ts` to `src/safe-fetch.ts` and `.context/repos/farnsworth-house/test/safe-fetch.test.ts` to `test/safe-fetch.test.ts`. Fix imports only. Behavior stays: HTTPS only, exact-hostname allowlist, IP literals and internal hosts blocked, any 3xx throws `redirect_blocked`, 8 s timeout, 1 MB cap.

- [ ] **Step 2: Run, expect pass**

Run: `npx vitest run test/safe-fetch.test.ts`

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "Port safe-fetch unchanged"
```

---

### Task 5: Schema subset and charter validation

**Files:**
- Create: `src/schema.ts`, `src/charter.ts`, `test/schema.test.ts`, `test/charter.test.ts`

**Interfaces:**
- Produces:

```ts
// schema.ts
export function checkSchema(node: unknown, depth?: number): string | null;   // null = valid
export function checkInput(schema: SchemaNode, input: unknown): string | null;
// charter.ts
export function checkCharter(c: unknown): string | null;
export function applyAmendment(current: Charter, patch: unknown): { charter: Charter } | { error: string };
export const VERB_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
```

- [ ] **Step 1: Write the failing tests**

`test/schema.test.ts` (representative cases; write all):

```ts
import { describe, it, expect } from "vitest";
import { checkSchema, checkInput } from "../src/schema";

describe("checkSchema", () => {
  it("accepts the subset", () => {
    expect(checkSchema({ type: "object", properties: { n: { type: "number", minimum: 0 } }, required: ["n"] })).toBeNull();
    expect(checkSchema({ type: "array", items: { type: "string", maxLength: 10 } })).toBeNull();
    expect(checkSchema({ type: "string", enum: ["a", "b"] })).toBeNull();
  });
  it("rejects outside the subset at declaration time", () => {
    expect(checkSchema({ type: "object", patternProperties: {} })).toMatch(/patternProperties/);
    expect(checkSchema({ oneOf: [] })).toMatch(/type/);
    expect(checkSchema({ type: "null" })).toMatch(/type/);
  });
  it("rejects nesting deeper than 8", () => {
    let node: any = { type: "string" };
    for (let i = 0; i < 9; i++) node = { type: "object", properties: { x: node } };
    expect(checkSchema(node)).toMatch(/depth/);
  });
});

describe("checkInput", () => {
  const s = { type: "object", properties: { n: { type: "integer", minimum: 1, maximum: 5 }, tag: { type: "string", enum: ["a", "b"] } }, required: ["n"] } as const;
  it("accepts valid input", () => expect(checkInput(s as any, { n: 3 })).toBeNull());
  it("rejects missing required", () => expect(checkInput(s as any, {})).toMatch(/n/));
  it("rejects undeclared properties strictly", () => expect(checkInput(s as any, { n: 2, extra: 1 })).toMatch(/extra/));
  it("rejects wrong types, non-integers, bounds, enum misses", () => {
    expect(checkInput(s as any, { n: "3" })).toMatch(/n/);
    expect(checkInput(s as any, { n: 2.5 })).toMatch(/integer/);
    expect(checkInput(s as any, { n: 9 })).toMatch(/maximum/);
    expect(checkInput(s as any, { n: 2, tag: "c" })).toMatch(/enum|tag/);
  });
});
```

`test/charter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkCharter, applyAmendment } from "../src/charter";

const good = {
  intent: "A counter. State is {count: number}. bump adds one and returns the new count.",
  verbs: { bump: { description: "Add one to the count.", inputSchema: { type: "object", properties: {} }, code: "ctx.state.count=(ctx.state.count??0)+1; return ctx.state.count;", access: "public" } },
  law: { visibility: "unlisted", allowedHosts: [] },
};

describe("checkCharter", () => {
  it("accepts a complete charter", () => expect(checkCharter(good)).toBeNull());
  it("rejects empty intent, bad verb names, bad access, bad visibility, bad schema, oversize", () => {
    expect(checkCharter({ ...good, intent: "" })).toMatch(/intent/);
    expect(checkCharter({ ...good, verbs: { "has.dot": good.verbs.bump } })).toMatch(/name/);
    expect(checkCharter({ ...good, verbs: { bump: { ...good.verbs.bump, access: "root" } } })).toMatch(/access/);
    expect(checkCharter({ ...good, law: { visibility: "secret", allowedHosts: [] } })).toMatch(/visibility/);
    expect(checkCharter({ ...good, verbs: { bump: { ...good.verbs.bump, inputSchema: { oneOf: [] } } } })).toMatch(/type/);
    expect(checkCharter({ ...good, intent: "x".repeat(300 * 1024) })).toMatch(/charter budget/);
  });
  it("rejects a schedule naming a missing verb", () => {
    expect(checkCharter({ ...good, schedule: { cron: "0 * * * *", verb: "nope" } })).toMatch(/schedule/);
  });
});

describe("applyAmendment", () => {
  it("merges verbs by name and null deletes", () => {
    const out = applyAmendment(good as any, { verbs: { bump: null, tick: good.verbs.bump } });
    expect("charter" in out && Object.keys(out.charter.verbs)).toEqual(["tick"]);
  });
  it("replaces intent and law when present, validates the result", () => {
    const out = applyAmendment(good as any, { law: { visibility: "public", allowedHosts: [] } });
    expect("charter" in out && out.charter.law.visibility).toBe("public");
    expect("error" in applyAmendment(good as any, { intent: "" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run test/schema.test.ts test/charter.test.ts`

- [ ] **Step 3: Implement**

`src/schema.ts`:

```ts
import type { SchemaNode } from "./types";

const TYPES = ["object", "string", "number", "integer", "boolean", "array"];
const KEYS: Record<string, string[]> = {
  object: ["type", "description", "properties", "required"],
  array: ["type", "description", "items"],
  string: ["type", "description", "enum", "minLength", "maxLength"],
  number: ["type", "description", "enum", "minimum", "maximum"],
  integer: ["type", "description", "enum", "minimum", "maximum"],
  boolean: ["type", "description"],
};

export function checkSchema(node: unknown, depth = 0): string | null {
  if (depth > 8) return "schema nesting depth exceeds 8";
  if (typeof node !== "object" || node === null || Array.isArray(node)) return "schema node must be an object";
  const n = node as Record<string, unknown>;
  if (typeof n.type !== "string" || !TYPES.includes(n.type)) return `schema type must be one of ${TYPES.join(", ")}`;
  for (const k of Object.keys(n)) {
    if (!KEYS[n.type as string].includes(k)) return `schema key "${k}" is outside the subset for type ${n.type}`;
  }
  if (n.type === "object" && n.properties !== undefined) {
    if (typeof n.properties !== "object" || n.properties === null) return "properties must be an object";
    for (const [k, v] of Object.entries(n.properties)) {
      const err = checkSchema(v, depth + 1);
      if (err) return `properties.${k}: ${err}`;
    }
    if (n.required !== undefined) {
      if (!Array.isArray(n.required) || n.required.some((r) => typeof r !== "string")) return "required must be a list of strings";
      for (const r of n.required) if (!(r in (n.properties as object))) return `required "${r}" is not a declared property`;
    }
  }
  if (n.type === "array") {
    if (n.items === undefined) return "array schema needs items";
    const err = checkSchema(n.items, depth + 1);
    if (err) return `items: ${err}`;
  }
  return null;
}

export function checkInput(schema: SchemaNode, input: unknown): string | null {
  return check(schema, input, "input");
}

function check(s: SchemaNode, v: unknown, path: string): string | null {
  switch (s.type) {
    case "object": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return `${path} must be an object`;
      const obj = v as Record<string, unknown>;
      const props = s.properties ?? {};
      for (const k of Object.keys(obj)) if (!(k in props)) return `${path}.${k} is not declared; undeclared properties are rejected`;
      for (const r of s.required ?? []) if (!(r in obj)) return `${path}.${r} is required`;
      for (const [k, sub] of Object.entries(props)) {
        if (k in obj) { const err = check(sub, obj[k], `${path}.${k}`); if (err) return err; }
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(v)) return `${path} must be an array`;
      for (let i = 0; i < v.length; i++) { const err = check(s.items as SchemaNode, v[i], `${path}[${i}]`); if (err) return err; }
      return null;
    }
    case "string": {
      if (typeof v !== "string") return `${path} must be a string`;
      if (s.minLength !== undefined && v.length < s.minLength) return `${path} is shorter than minLength ${s.minLength}`;
      if (s.maxLength !== undefined && v.length > s.maxLength) return `${path} is longer than maxLength ${s.maxLength}`;
      if (s.enum && !s.enum.includes(v)) return `${path} must be one of the enum values`;
      return null;
    }
    case "number":
    case "integer": {
      if (typeof v !== "number" || Number.isNaN(v)) return `${path} must be a number`;
      if (s.type === "integer" && !Number.isInteger(v)) return `${path} must be an integer`;
      if (s.minimum !== undefined && v < s.minimum) return `${path} is below minimum ${s.minimum}`;
      if (s.maximum !== undefined && v > s.maximum) return `${path} is above maximum ${s.maximum}`;
      if (s.enum && !s.enum.includes(v)) return `${path} must be one of the enum values`;
      return null;
    }
    case "boolean":
      return typeof v === "boolean" ? null : `${path} must be a boolean`;
  }
}
```

`src/charter.ts`:

```ts
import { BUDGET, type Charter, type Verb } from "./types";
import { checkSchema } from "./schema";

export const VERB_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const VISIBILITIES = ["private", "unlisted", "public"];
const ACCESSES = ["owner", "public"];

export function checkCharter(c: unknown): string | null {
  if (typeof c !== "object" || c === null) return "charter must be a JSON object";
  const ch = c as Record<string, unknown>;
  if (typeof ch.intent !== "string" || ch.intent.trim() === "") return "intent (non-empty prose) is required";
  if (typeof ch.verbs !== "object" || ch.verbs === null) return "verbs (object of name to verb) is required";
  for (const [name, v] of Object.entries(ch.verbs as Record<string, unknown>)) {
    if (!VERB_NAME.test(name)) return `verb name "${name}" must match ${VERB_NAME}`;
    const err = checkVerb(v);
    if (err) return `verbs.${name}: ${err}`;
  }
  const law = ch.law as Record<string, unknown> | undefined;
  if (!law || typeof law !== "object") return "law {visibility, allowedHosts} is required";
  if (!VISIBILITIES.includes(law.visibility as string)) return `law.visibility must be one of ${VISIBILITIES.join(", ")}`;
  if (!Array.isArray(law.allowedHosts) || law.allowedHosts.some((h) => typeof h !== "string")) return "law.allowedHosts must be a list of hostnames";
  if (ch.schedule !== undefined) {
    const s = ch.schedule as Record<string, unknown>;
    if (typeof s.cron !== "string" || typeof s.verb !== "string" || !(s.verb in (ch.verbs as object)))
      return "schedule must be {cron, verb} naming an existing verb";
  }
  if (byteLength(c) > BUDGET.CHARTER) return `charter budget exceeded: ${byteLength(c)} > ${BUDGET.CHARTER} bytes`;
  return null;
}

function checkVerb(v: unknown): string | null {
  if (typeof v !== "object" || v === null) return "must be an object";
  const verb = v as Record<string, unknown>;
  if (typeof verb.description !== "string" || verb.description.trim() === "") return "description is required";
  if (typeof verb.code !== "string" || verb.code.trim() === "") return "code is required";
  if (!ACCESSES.includes(verb.access as string)) return `access must be one of ${ACCESSES.join(", ")}`;
  const err = checkSchema(verb.inputSchema);
  if (err) return `inputSchema: ${err}`;
  return null;
}

export function applyAmendment(current: Charter, patch: unknown): { charter: Charter } | { error: string } {
  if (typeof patch !== "object" || patch === null) return { error: "amendment must be a JSON object" };
  const p = patch as Record<string, unknown>;
  const next: Charter = structuredClone(current);
  if (p.intent !== undefined) next.intent = p.intent as string;
  if (p.law !== undefined) next.law = p.law as Charter["law"];
  if (p.schedule !== undefined) next.schedule = (p.schedule ?? undefined) as Charter["schedule"];
  if (p.verbs !== undefined) {
    if (typeof p.verbs !== "object" || p.verbs === null) return { error: "verbs must be an object; null value deletes a verb" };
    for (const [name, v] of Object.entries(p.verbs as Record<string, unknown>)) {
      if (v === null) delete next.verbs[name];
      else next.verbs[name] = v as Verb;
    }
  }
  const err = checkCharter(next);
  if (err) return { error: err };
  return { charter: next };
}

export function byteLength(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}
```

- [ ] **Step 4: Run, expect pass; typecheck**

Run: `npx vitest run test/schema.test.ts test/charter.test.ts && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add schema subset and charter validation"
```

---

### Task 6: App DO, invocation path

**Files:**
- Modify: `src/app.ts` (replace placeholder)
- Create: `test/app-invoke.test.ts`, `test/helpers.ts`

**Interfaces:**
- Consumes: `execute` (Task 3), `safeFetch` (Task 4), `checkCharter`/`checkInput`/`byteLength` (Task 5), `BUDGET` (Task 1).
- Produces: DO paths used by the router (Task 9): `POST /init` (trusted only; body `{charter, state?}`), `GET /charter`, `GET /state`, `POST /rpc/:verb`, `PUT /state`. Trust contract: the DO reads `X-Owner: 0|1` and never anything else for identity. All handlers that write go through `runSerial`.

- [ ] **Step 1: Write the failing tests**

`test/helpers.ts`:

```ts
import { env } from "cloudflare:test";

export function appStub(id?: string) {
  const objectId = id ? env.APP.idFromString(id) : env.APP.newUniqueId();
  return { id: objectId.toString(), stub: env.APP.get(objectId) };
}

export async function mint(charter: unknown, state?: unknown) {
  const { id, stub } = appStub();
  const res = await stub.fetch("https://do/init", {
    method: "POST",
    headers: { "X-Owner": "1" },
    body: JSON.stringify({ charter, state }),
  });
  return { id, stub, res };
}

export const counterCharter = {
  intent: "A counter. State is {count: number}. bump adds one and returns the new count. read returns the count.",
  verbs: {
    bump: { description: "Add one to the count.", inputSchema: { type: "object", properties: {} }, code: "ctx.state.count=(ctx.state.count??0)+1; return ctx.state.count;", access: "public" },
    read: { description: "Return the count.", inputSchema: { type: "object", properties: {} }, code: "return ctx.state.count ?? 0;", access: "public" },
    reset: { description: "Set the count to zero.", inputSchema: { type: "object", properties: {} }, code: "ctx.state.count = 0; return 0;", access: "owner" },
  },
  law: { visibility: "unlisted", allowedHosts: [] },
};
```

`test/app-invoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
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
  it("no lost update when a slow http verb overlaps a fast one", async () => {
    // slowHost is a helper verb using ctx.http against a mock; see fetchMock note below.
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
```

For the slow host, use `fetchMock` from `cloudflare:test` (`fetchMock.get("https://slow.example").intercept({ path: "/wait" }).reply(200, "ok").delay(300)`); follow the ancestor's `test/sandbox-http.test.ts` mock pattern exactly.

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run test/app-invoke.test.ts`

- [ ] **Step 3: Implement `src/app.ts`**

```ts
import { DurableObject } from "cloudflare:workers";
import { BUDGET, type Charter, type Env } from "./types";
import { checkCharter, byteLength } from "./charter";
import { checkInput } from "./schema";
import { execute, type HostHttp } from "./sandbox";
import { safeFetch } from "./safe-fetch";

const err = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export class App extends DurableObject<Env> {
  private chain: Promise<unknown> = Promise.resolve();

  private runSerial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const owner = request.headers.get("X-Owner") === "1";
    const path = url.pathname;

    if (request.method === "POST" && path === "/init") return this.init(request, owner);

    const charter = await this.ctx.storage.get<Charter>("charter");
    if (!charter) return err(404, "No app lives at this URL.");

    if (request.method === "GET" && path === "/charter") return Response.json({ ok: true, charter });
    if (request.method === "GET" && path === "/state") return Response.json({ ok: true, state: await this.readState() });
    if (request.method === "PUT" && path === "/state") return this.seed(request, owner);
    if (request.method === "POST" && path.startsWith("/rpc/")) return this.rpc(charter, path.slice(5), request, owner);

    return err(404, `No route for ${request.method} ${path} on this app.`);
  }

  private async init(request: Request, owner: boolean): Promise<Response> {
    if (!owner) return err(404, "No app lives at this URL.");
    const body = (await request.json().catch(() => null)) as { charter?: unknown; state?: unknown } | null;
    if (!body) return err(400, "Body must be JSON: {charter, state?}.");
    const invalid = checkCharter(body.charter);
    if (invalid) return err(400, invalid);
    if (body.state !== undefined && byteLength(body.state) > BUDGET.STATE) return err(400, "state budget exceeded");
    await this.ctx.storage.put("charter", body.charter as Charter);
    await this.ctx.storage.put("state", body.state ?? {});
    return Response.json({ ok: true }, { status: 201 });
  }

  private async seed(request: Request, owner: boolean): Promise<Response> {
    if (!owner) return err(404, "No app lives at this URL.");
    const state = await request.json().catch(() => undefined);
    if (state === undefined) return err(400, "Body must be JSON state.");
    if (byteLength(state) > BUDGET.STATE) return err(400, "state budget exceeded");
    return this.runSerial(async () => {
      await this.ctx.storage.put("state", state);
      this.broadcastState(state);
      return Response.json({ ok: true });
    });
  }

  private async rpc(charter: Charter, name: string, request: Request, owner: boolean): Promise<Response> {
    const verb = charter.verbs[name];
    if (!verb) return err(404, `No verb "${name}". Available: ${Object.keys(charter.verbs).join(", ")}`);
    if (verb.access === "owner" && !owner) return err(404, `No verb "${name}".`);
    const input = (await request.json().catch(() => ({}))) as unknown;
    if (byteLength(input) > BUDGET.INPUT) return err(400, `input budget exceeded: over ${BUDGET.INPUT} bytes`);
    const invalid = checkInput(verb.inputSchema, input);
    if (invalid) return err(400, invalid);

    return this.runSerial(async () => {
      const state = await this.readState();
      const hostHttp = charter.law.allowedHosts.length > 0 ? this.makeHostHttp(charter.law.allowedHosts) : undefined;
      const out = await execute(verb.code, state, input, { hostHttp });
      if (!out.ok) return err(400, `${out.error} (verb "${name}"). Fix the code and amend the charter to heal the app.`);
      if (byteLength(out.result) > BUDGET.RESULT) return err(400, "result budget exceeded");
      if (byteLength(out.state) > BUDGET.STATE) return err(400, "state budget exceeded; state is unchanged");
      await this.ctx.storage.put("state", out.state);
      this.broadcastState(out.state);
      return Response.json({ ok: true, result: out.result });
    });
  }

  private makeHostHttp(allowedHosts: string[]): HostHttp {
    const call = async (url: string, init: RequestInit) => {
      try {
        const res = await safeFetch(url, init, { allowedHosts });
        return { status: res.status, body: await res.text() };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };
    return {
      get: (url, headers) => call(url, { method: "GET", headers }),
      post: (url, body, headers) =>
        call(url, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }),
    };
  }

  private readState(): Promise<unknown> {
    return this.ctx.storage.get("state").then((s) => s ?? {});
  }

  protected broadcastState(_state: unknown): void {
    // Sockets arrive in Task 8; this hook exists so rpc/seed call sites do not change.
  }
}
```

- [ ] **Step 4: Run, expect pass; typecheck**

Run: `npx vitest run test/app-invoke.test.ts && npm run typecheck`
The serial-law test is the one that matters most; if it flakes, the chain is wrong, not the test.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "App DO: init, reads, seed, atomic serial invocation with budgets"
```

---

### Task 7: App DO, acts and history

**Files:**
- Modify: `src/app.ts`
- Create: `test/app-acts.test.ts`

**Interfaces:**
- Consumes: `applyAmendment` (Task 5).
- Produces: DO paths `PUT /charter` (amend, body is a patch), `GET /history`, `POST /rollback` (`{version}`), `GET /export`, `POST /retire`. History entries: `{version: number, at: number, charter: Charter}`; versions never renumber; cap `BUDGET.HISTORY`.

- [ ] **Step 1: Write the failing tests**

`test/app-acts.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run test/app-acts.test.ts`

- [ ] **Step 3: Implement in `src/app.ts`**

Add to the routing in `fetch` (after the charter existence check):

```ts
    if (request.method === "PUT" && path === "/charter") return this.amend(charter, request, owner);
    if (request.method === "GET" && path === "/history") return this.history();
    if (request.method === "POST" && path === "/rollback") return this.rollback(charter, request, owner);
    if (request.method === "GET" && path === "/export") return Response.json({ ok: true, export: { charter, state: await this.readState() } });
    if (request.method === "POST" && path === "/retire") return this.retire(owner);
```

And the methods:

```ts
  private async amend(current: Charter, request: Request, owner: boolean): Promise<Response> {
    if (!owner) return err(404, "No app lives at this URL.");
    const patch = await request.json().catch(() => null);
    if (patch === null) return err(400, "Body must be a JSON amendment: {intent?, verbs?, law?, schedule?}.");
    const out = applyAmendment(current, patch);
    if ("error" in out) return err(400, out.error);
    return this.runSerial(async () => {
      await this.pushHistory(current);
      await this.ctx.storage.put("charter", out.charter);
      this.broadcastCharter(out.charter);
      return Response.json({ ok: true, verbs: Object.keys(out.charter.verbs) });
    });
  }

  private async history(): Promise<Response> {
    const history = (await this.ctx.storage.get<{ version: number; at: number; charter: Charter }[]>("history")) ?? [];
    return Response.json({ ok: true, history });
  }

  private async rollback(current: Charter, request: Request, owner: boolean): Promise<Response> {
    if (!owner) return err(404, "No app lives at this URL.");
    const body = (await request.json().catch(() => ({}))) as { version?: number };
    const history = (await this.ctx.storage.get<{ version: number; at: number; charter: Charter }[]>("history")) ?? [];
    const entry = history.find((h) => h.version === body.version);
    if (!entry) return err(404, `No history version ${body.version ?? "(none given)"}. Versions: ${history.map((h) => h.version).join(", ") || "none"}.`);
    return this.runSerial(async () => {
      await this.pushHistory(current);
      await this.ctx.storage.put("charter", entry.charter);
      this.broadcastCharter(entry.charter);
      return Response.json({ ok: true, restored: entry.version, verbs: Object.keys(entry.charter.verbs) });
    });
  }

  private async retire(owner: boolean): Promise<Response> {
    if (!owner) return err(404, "No app lives at this URL.");
    await this.ctx.storage.deleteAll();
    return Response.json({ ok: true });
  }

  private async pushHistory(charter: Charter): Promise<void> {
    const history = (await this.ctx.storage.get<{ version: number; at: number; charter: Charter }[]>("history")) ?? [];
    const seq = ((await this.ctx.storage.get<number>("historySeq")) ?? 0) + 1;
    history.push({ version: seq, at: Date.now(), charter });
    while (history.length > BUDGET.HISTORY) history.shift();
    await this.ctx.storage.put("historySeq", seq);
    await this.ctx.storage.put("history", history);
  }

  protected broadcastCharter(_charter: Charter): void {
    // Sockets arrive in Task 8.
  }
```

Import `applyAmendment` from `./charter`.

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run test/app-acts.test.ts test/app-invoke.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "App DO: amend, history, rollback, export, retire"
```

---

### Task 8: Watching: sockets, broadcasts, presence

**Files:**
- Modify: `src/app.ts`
- Create: `test/watch.test.ts`

**Interfaces:**
- Produces: DO path `GET /ws` (upgrade). Server messages: `{type:"state",state}` on connect and after every state change, `{type:"charter",charter}` after amend and rollback, `{type:"pong"}`. Client messages: literal `"ping"`; `{type:"presence",...}` under `BUDGET.SIGNAL`, relayed to every other socket, never stored.

- [ ] **Step 1: Write the failing tests**

`test/watch.test.ts` (follow the connection pattern in `.context/repos/farnsworth-house/test/ws.test.ts` for opening socket pairs against a DO stub in vitest-pool-workers):

```ts
import { describe, it, expect } from "vitest";
import { mint, counterCharter } from "./helpers";

const guest = { "X-Owner": "0" };

async function open(stub: any) {
  const res = await stub.fetch("https://do/ws", { headers: { ...guest, Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const messages: any[] = [];
  ws.addEventListener("message", (e: MessageEvent) => messages.push(JSON.parse(e.data as string)));
  return { ws, messages };
}
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("watching", () => {
  it("sends full state on connect", async () => {
    const { stub } = await mint(counterCharter, { count: 4 });
    const { messages } = await open(stub);
    await settle();
    expect(messages[0]).toEqual({ type: "state", state: { count: 4 } });
  });
  it("broadcasts state after invocation and seed, charter after amend and rollback", async () => {
    const { stub } = await mint(counterCharter, { count: 0 });
    const { messages } = await open(stub);
    await settle();
    await stub.fetch("https://do/rpc/bump", { method: "POST", headers: guest, body: "{}" });
    await stub.fetch("https://do/state", { method: "PUT", headers: { "X-Owner": "1" }, body: JSON.stringify({ count: 8 }) });
    await stub.fetch("https://do/charter", { method: "PUT", headers: { "X-Owner": "1" }, body: JSON.stringify({ intent: "Edition 2. State is {count}." }) });
    await settle();
    const types = messages.map((m) => m.type);
    expect(types).toEqual(["state", "state", "state", "charter"]);
    expect(messages[3].charter.intent).toMatch(/Edition 2/);
  });
  it("relays presence to others only, never stores it, enforces the signal budget", async () => {
    const { stub } = await mint(counterCharter);
    const a = await open(stub);
    const b = await open(stub);
    await settle();
    a.ws.send(JSON.stringify({ type: "presence", cursor: [1, 2] }));
    a.ws.send(JSON.stringify({ type: "presence", blob: "x".repeat(5000) })); // over budget: dropped
    a.ws.send("not json"); // dropped
    await settle();
    expect(b.messages.filter((m) => m.type === "presence")).toHaveLength(1);
    expect(a.messages.filter((m) => m.type === "presence")).toHaveLength(0);
    const s = (await (await stub.fetch("https://do/state", { headers: guest })).json()) as any;
    expect(JSON.stringify(s.state)).not.toMatch(/cursor/);
  });
  it("answers ping with pong", async () => {
    const { stub } = await mint(counterCharter);
    const a = await open(stub);
    await settle();
    a.ws.send("ping");
    await settle();
    expect(a.messages.at(-1)).toEqual({ type: "pong" });
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run test/watch.test.ts`

- [ ] **Step 3: Implement in `src/app.ts`**

Add to routing (after charter existence check): 

```ts
    if (path === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return err(426, "Expected a WebSocket upgrade.");
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: "state", state: await this.readState() }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
```

Replace the two broadcast hooks and add the hibernation handlers:

```ts
  protected broadcastState(state: unknown): void {
    this.broadcast(JSON.stringify({ type: "state", state }));
  }
  protected broadcastCharter(charter: Charter): void {
    this.broadcast(JSON.stringify({ type: "charter", charter }));
  }
  private broadcast(payload: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch { /* a closing socket is not our problem */ }
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    if (message === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
    if (message.length > BUDGET.SIGNAL) return;
    let parsed: unknown;
    try { parsed = JSON.parse(message); } catch { return; }
    if (typeof parsed !== "object" || parsed === null || (parsed as { type?: string }).type !== "presence") return;
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) { try { other.send(message); } catch { /* ignore */ } }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try { ws.close(); } catch { /* already closed */ }
  }
```

- [ ] **Step 4: Run all app tests, expect pass**

Run: `npx vitest run test/watch.test.ts test/app-invoke.test.ts test/app-acts.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "App DO: sockets, state and charter broadcasts, presence relay"
```

---

### Task 9: Schedule

**Files:**
- Create: `src/schedule.ts`, `test/schedule.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Produces: `nextCronTime(cron: string, fromMs: number): number` (UTC, throws `cron_no_next_run`). App DO arms its alarm on init/amend/rollback and runs the scheduled verb with input `{scheduled: true}` through `runSerial`, then re-arms.

- [ ] **Step 1: Port and test**

Copy `.context/repos/farnsworth-house/src/schedule.ts` (croner, `timezone: "UTC"`). Copy `.context/repos/farnsworth-house/test/schedule.test.ts` and the alarm test pattern from `test/app-alarm.test.ts` (uses `runDurableObjectAlarm` from `cloudflare:test`). New test `test/schedule.test.ts` must cover:

```ts
import { describe, it, expect } from "vitest";
import { runDurableObjectAlarm } from "cloudflare:test";
import { mint, counterCharter } from "./helpers";

describe("schedule", () => {
  it("alarm runs the scheduled verb and re-arms", async () => {
    const charter = structuredClone(counterCharter) as any;
    charter.schedule = { cron: "* * * * *", verb: "bump" };
    const { stub } = await mint(charter, { count: 0 });
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const s = (await (await stub.fetch("https://do/state", { headers: { "X-Owner": "0" } })).json()) as any;
    expect(s.state.count).toBe(1);
  });
  it("amending away the schedule disarms the alarm", async () => {
    const charter = structuredClone(counterCharter) as any;
    charter.schedule = { cron: "* * * * *", verb: "bump" };
    const { stub } = await mint(charter);
    await stub.fetch("https://do/charter", { method: "PUT", headers: { "X-Owner": "1" }, body: JSON.stringify({ schedule: null }) });
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run test/schedule.test.ts`

- [ ] **Step 3: Implement in `src/app.ts`**

`applySchedule` called at the end of `init`, `amend`, and `rollback` (inside the serial block, after the charter write):

```ts
  private async applySchedule(charter: Charter): Promise<void> {
    if (charter.schedule) {
      await this.ctx.storage.setAlarm(nextCronTime(charter.schedule.cron, Date.now()));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async alarm(): Promise<void> {
    const charter = await this.ctx.storage.get<Charter>("charter");
    if (!charter?.schedule) return;
    const verb = charter.verbs[charter.schedule.verb];
    if (verb) {
      await this.runSerial(async () => {
        const state = await this.readState();
        const hostHttp = charter.law.allowedHosts.length > 0 ? this.makeHostHttp(charter.law.allowedHosts) : undefined;
        const out = await execute(verb.code, state, { scheduled: true }, { hostHttp });
        if (out.ok && byteLength(out.state) <= BUDGET.STATE) {
          await this.ctx.storage.put("state", out.state);
          this.broadcastState(out.state);
        }
      });
    }
    await this.applySchedule(charter);
  }
```

Note: the scheduled verb runs regardless of its `access`; the platform is the caller. Amendment patch value `schedule: null` must clear the schedule (adjust `applyAmendment` if Task 5's handling of `null` does not already produce `undefined`).

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run test/schedule.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Schedule: cron alarm invokes the scheduled verb through the serial chain"
```

---

### Task 10: Auth

**Files:**
- Create: `src/auth.ts`, `test/auth.test.ts`

**Interfaces:**
- Produces:

```ts
export async function isOwner(request: Request, env: Env): Promise<boolean>;   // bearer or session cookie
export async function mintSession(env: Env): Promise<string>;                  // Set-Cookie value for __Host-sid
export function clearSession(): string;                                       // expiring Set-Cookie value
```

- [ ] **Step 1: Port the primitives**

From `.context/repos/farnsworth-house/src/crypto.ts` and `src/auth.ts` port: SHA-256 + `crypto.subtle.timingSafeEqual` key comparison, `mintTicket`/`verifyTicket` (HMAC-SHA256, 30-day TTL, `__Host-sid` cookie shape `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`). Delete all Cloudflare Access code. New: the ticket HMAC key is derived, not configured:

```ts
async function sessionKey(ownerKey: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hypernormal-session-v1:" + ownerKey));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
```

- [ ] **Step 2: Write the failing tests**

`test/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { isOwner, mintSession } from "../src/auth";

const req = (headers: Record<string, string> = {}) => new Request("https://x/", { headers });

describe("auth", () => {
  it("accepts the bearer key, rejects wrong and empty", async () => {
    expect(await isOwner(req({ Authorization: "Bearer test-owner-key" }), env as any)).toBe(true);
    expect(await isOwner(req({ Authorization: "Bearer wrong" }), env as any)).toBe(false);
    expect(await isOwner(req({ Authorization: "Bearer " }), env as any)).toBe(false);
    expect(await isOwner(req(), env as any)).toBe(false);
  });
  it("fails closed with no configured key", async () => {
    expect(await isOwner(req({ Authorization: "Bearer " }), { OWNER_KEY: "" } as any)).toBe(false);
    expect(await isOwner(req({ Authorization: "Bearer x" }), {} as any)).toBe(false);
  });
  it("session cookie authenticates; rotating the owner key invalidates it", async () => {
    const cookie = await mintSession(env as any);
    const sid = cookie.split(";")[0];
    expect(await isOwner(req({ Cookie: sid }), env as any)).toBe(true);
    expect(await isOwner(req({ Cookie: sid }), { OWNER_KEY: "rotated" } as any)).toBe(false);
  });
});
```

- [ ] **Step 3: Run fail, implement, run pass**

Run: `npx vitest run test/auth.test.ts`

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Auth: one secret, bearer plus derived session tickets, fail closed"
```

---

### Task 11: Registry DO

**Files:**
- Modify: `src/registry.ts` (replace placeholder)
- Create: `test/registry.test.ts`

**Interfaces:**
- Produces: internal routes on the singleton (`env.REGISTRY.getByName("registry")` from the router):
  - `POST /apps/register` body `{id, intent, visibility}` (upsert), `POST /apps/unregister` body `{id}`, `GET /apps` returns `{ok, apps: [{id, intent, visibility, updated}]}` newest first.
  - `PUT /faces/:name` body `{title, html, targets, visibility}` (upsert; `name` matches `VERB_NAME`; html under `BUDGET.FACE`), `GET /faces/:name` returns `{ok, face}`, `DELETE /faces/:name`, `GET /faces` returns `{ok, faces: [{name, title, targets, visibility, updated}]}` (no html).

- [ ] **Step 1: Write the failing tests**

`test/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const reg = () => env.REGISTRY.get(env.REGISTRY.idFromName("registry"));
const j = (m: string, p: string, body?: unknown) =>
  reg().fetch(`https://do${p}`, { method: m, body: body === undefined ? undefined : JSON.stringify(body) });

describe("registry", () => {
  it("registers, lists newest first, unregisters", async () => {
    await j("POST", "/apps/register", { id: "a1", intent: "First.", visibility: "public" });
    await j("POST", "/apps/register", { id: "a2", intent: "Second.", visibility: "unlisted" });
    const list = (await (await j("GET", "/apps")).json()) as any;
    expect(list.apps.map((a: any) => a.id)).toEqual(["a2", "a1"]);
    await j("POST", "/apps/unregister", { id: "a1" });
    const after = (await (await j("GET", "/apps")).json()) as any;
    expect(after.apps.map((a: any) => a.id)).toEqual(["a2"]);
  });
  it("stores and serves faces, enforces the face budget, lists without html", async () => {
    const face = { title: "List", html: "<!doctype html><p>hi</p>", targets: ["a2"], visibility: "public" };
    expect((await j("PUT", "/faces/list", face)).status).toBe(200);
    const got = (await (await j("GET", "/faces/list")).json()) as any;
    expect(got.face.html).toMatch(/hi/);
    const big = { ...face, html: "x".repeat(600 * 1024) };
    expect((await j("PUT", "/faces/big", big)).status).toBe(400);
    const all = (await (await j("GET", "/faces")).json()) as any;
    expect(all.faces[0]).not.toHaveProperty("html");
    expect((await j("DELETE", "/faces/list")).status).toBe(200);
    expect((await j("GET", "/faces/list")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run test/registry.test.ts`

- [ ] **Step 3: Implement `src/registry.ts`**

```ts
import { DurableObject } from "cloudflare:workers";
import { BUDGET, type Env } from "./types";
import { VERB_NAME } from "./charter";

const err = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export class Registry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS apps (id TEXT PRIMARY KEY, intent TEXT, visibility TEXT, updated INTEGER);
      CREATE TABLE IF NOT EXISTS faces (name TEXT PRIMARY KEY, title TEXT, html TEXT, targets TEXT, visibility TEXT, updated INTEGER);`);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sql = this.ctx.storage.sql;
    const path = url.pathname;
    const m = request.method;

    if (m === "POST" && path === "/apps/register") {
      const b = (await request.json()) as { id: string; intent: string; visibility: string };
      sql.exec("INSERT INTO apps (id, intent, visibility, updated) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET intent=excluded.intent, visibility=excluded.visibility, updated=excluded.updated", b.id, b.intent, b.visibility, Date.now());
      return Response.json({ ok: true });
    }
    if (m === "POST" && path === "/apps/unregister") {
      const b = (await request.json()) as { id: string };
      sql.exec("DELETE FROM apps WHERE id = ?", b.id);
      return Response.json({ ok: true });
    }
    if (m === "GET" && path === "/apps") {
      const apps = sql.exec("SELECT id, intent, visibility, updated FROM apps ORDER BY updated DESC").toArray();
      return Response.json({ ok: true, apps });
    }
    if (path.startsWith("/faces/")) {
      const name = path.slice("/faces/".length);
      if (!VERB_NAME.test(name)) return err(400, `face name must match ${VERB_NAME}`);
      if (m === "PUT") {
        const b = (await request.json()) as { title: string; html: string; targets: string[]; visibility: string };
        if (typeof b.html !== "string" || b.html.length > BUDGET.FACE) return err(400, `face budget exceeded: over ${BUDGET.FACE} bytes`);
        sql.exec("INSERT INTO faces (name, title, html, targets, visibility, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET title=excluded.title, html=excluded.html, targets=excluded.targets, visibility=excluded.visibility, updated=excluded.updated", name, b.title ?? name, b.html, JSON.stringify(b.targets ?? []), b.visibility ?? "unlisted", Date.now());
        return Response.json({ ok: true });
      }
      if (m === "GET") {
        const row = sql.exec("SELECT * FROM faces WHERE name = ?", name).toArray()[0];
        if (!row) return err(404, `No face named "${name}".`);
        return Response.json({ ok: true, face: { ...row, targets: JSON.parse(row.targets as string) } });
      }
      if (m === "DELETE") {
        sql.exec("DELETE FROM faces WHERE name = ?", name);
        return Response.json({ ok: true });
      }
    }
    if (m === "GET" && path === "/faces") {
      const faces = sql.exec("SELECT name, title, targets, visibility, updated FROM faces ORDER BY updated DESC").toArray()
        .map((f) => ({ ...f, targets: JSON.parse(f.targets as string) }));
      return Response.json({ ok: true, faces });
    }
    return err(404, `No route for ${m} ${path} on the registry.`);
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run test/registry.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Registry DO: app index and stored faces"
```

---

### Task 12: Router

**Files:**
- Modify: `src/index.ts`
- Create: `src/pages.ts`, `test/router.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the public HTTP surface of the spec's route table, exactly. `src/pages.ts` exports `manualMarkdown(origin: string, openMint: boolean): string`, `manualHtml(...)`, `landingHtml(id, charter, faces)`, `loginHtml(failed: boolean)`.

- [ ] **Step 1: Write the failing tests**

`test/router.test.ts` (via `SELF.fetch`; the bearer header `Authorization: Bearer test-owner-key` is "as owner"):

```ts
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
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run test/router.test.ts`

- [ ] **Step 3: Implement**

`src/index.ts` structure:

```ts
import type { Charter, Env } from "./types";
import { isOwner, mintSession, clearSession } from "./auth";
import { checkCharter } from "./charter";
import { manualMarkdown, manualHtml, landingHtml, loginHtml } from "./pages";
import runtimeSource from "../face/runtime.js";
```

Serving `runtime.js`: add a wrangler `rules` entry `{ "type": "Text", "globs": ["face/**/*.js"], "fallthrough": true }` so the import above yields the file as a string, and add the declaration `declare module "*/runtime.js" { const s: string; export default s; }` to `src/wasm.d.ts`. Serve with `Content-Type: text/javascript`.

CORS: derived faces run from anywhere (a local file, a sandboxed preview), so the JSON surface is open. A `cors(res)` helper adds `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`, `Access-Control-Allow-Headers: Authorization, Content-Type` to every non-HTML response, and `OPTIONS *` answers 204 with those headers before any other routing. Add to `test/router.test.ts`:

```ts
  it("answers OPTIONS with CORS and marks JSON responses", async () => {
    const pre = await SELF.fetch("https://x/apps", { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const res = await SELF.fetch("https://x/health");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
```

QR: copy `.context/repos/farnsworth-house/src/qr.ts` to `src/qr.ts` unchanged, fixing imports only. It depends on the pinned `qrcode-generator` package; add it to `package.json` at the version pinned in `.context/repos/farnsworth-house/package.json` (`^2.0.4`) if Task 1 did not already include it. Route `GET /a/:id/qr` gated like the charter, `Content-Type: image/svg+xml`, `Cache-Control: public, max-age=3600`. Test: mint, fetch `/a/<id>/qr`, expect 200 and an `<svg` body.

Router rules, in order, inside `fetch` after computing `const owner = await isOwner(request, env)`:

0. `OPTIONS` anywhere: 204 with CORS headers.

1. `GET /health`, `GET /runtime.js`.
2. `GET|POST /login`, `POST /logout` (POST rate-limited by `LOGIN_RL` keyed on `CF-Connecting-IP` when the binding exists; degrade to no limit when absent).
3. `GET /` → manual: HTML when `Accept` includes `text/html`, else markdown (`text/markdown; charset=utf-8`).
4. `GET /apps` → registry list, filtered to `visibility === "public"` unless owner.
5. `POST /apps` → mint gate: `owner || env.OPEN_MINT === "true"`; else 404. Validate `checkCharter`, create `env.APP.newUniqueId()`, call DO `/init` with `X-Owner: 1`, register in registry (id, first 140 chars of intent, visibility), return `{ok: true, id, url}` 201.
6. `/a/:id/...`: parse id (`[0-9a-f]{64}`, else 404). Visibility gate: fetch charter from the DO first (internal `GET /charter` with the trusted owner flag); for `private` require owner; block the client path `/init` explicitly (404 before forwarding). Then:
   - `GET /a/:id` with `text/html` in Accept → `landingHtml`.
   - `POST /a/:id/fork` (owner): read `/export` from the source DO, mint a new DO with it (`withState` from the body), register, return `{ok, id, url}`.
   - `DELETE /a/:id` (owner) → DO `/retire` + registry unregister.
   - `PUT /a/:id` → DO `PUT /charter`; then re-register intent/visibility in the registry.
   - everything else forwards to the DO verbatim with `X-Owner` overwritten (`/state`, `/rpc/*`, `/history`, `/rollback`, `/export`, `/ws` as `?owner=0|1` upgrade passthrough), rate-limited by `PUBLIC_RL` keyed on pathname when the binding exists.
7. `/f/:name`: `PUT`/`DELETE` owner-gated to the registry; `GET` fetches the face, gates non-public visibility to owner (unlisted faces are reachable by link: gate only `private`), serves html with `Content-Type: text/html`, injects `<meta http-equiv="origin-trial" content="...">` after `<head>`-open or doctype when `env.WEBMCP_OT_TOKEN` is set.
8. 404 fallthrough with the error form.

Every response passes a `finalize(res, indexed: boolean)` helper adding `Referrer-Policy: no-referrer` and, unless `indexed`, `X-Robots-Tag: noindex`; WebSocket 101 responses pass through untouched. Indexed surfaces: `/`, `GET /apps`, public faces, public app landings.

`src/pages.ts`: four small template functions, dependency free, in the definition's register. `manualMarkdown` is the agent-facing contract; write it fully, covering: what this installation is (three sentences from the definition), how to read a charter, invoke (`POST /a/<id>/rpc/<verb>`, error form, transport vs app-level ok), watch (socket messages), the acts and their auth, whether minting is open here (from `openMint`), and the mint body shape with one complete charter example (use the counter charter). `landingHtml`: title (first sentence of intent), the intent, public verb names, links to `/a/<id>` (JSON), `/state`, faces targeting this app. `loginHtml`: one form, field `key`.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: everything green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Router: full public surface, gates, manual, faces, fork"
```

---

### Task 13: Face runtime and WebMCP bridge

**Files:**
- Create: `face/runtime.js`, `test/runtime-tools.test.ts`

**Interfaces:**
- Produces: ES module exports `connect(appUrl, options?)` and `toolsFromCharter(charter, invoke)`. `connect` returns `{state, charter, verbs, presence, invoke, close}` where `state`/`charter` are `{value, watch(fn)}` (watch fires immediately and on change, returns unwatch), `verbs.<name>(input)` resolves with the verb result or throws `Error(message)`, `presence` is `{emit(signal), watch(fn)}`.

- [ ] **Step 1: Write the failing test for the pure part**

`test/runtime-tools.test.ts` (vitest, plain node environment is fine; the function is pure):

```ts
import { describe, it, expect } from "vitest";
import { toolsFromCharter } from "../face/runtime.js";

const charter = {
  intent: "x",
  verbs: {
    add: { description: "Add an item.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, code: "...", access: "public" },
    wipe: { description: "Owner only.", inputSchema: { type: "object", properties: {} }, code: "...", access: "owner" },
  },
  law: { visibility: "public", allowedHosts: [] },
};

describe("toolsFromCharter", () => {
  it("maps public verbs only, mechanically, with untrusted output annotation", () => {
    const calls: any[] = [];
    const tools = toolsFromCharter(charter, (name, input) => { calls.push([name, input]); return Promise.resolve("done"); });
    expect(tools).toHaveLength(1);
    const t = tools[0];
    expect(t.name).toBe("add");
    expect(t.description).toBe("Add an item.");
    expect(t.inputSchema).toEqual(charter.verbs.add.inputSchema);
    expect(t.annotations).toEqual({ untrustedContentHint: true });
    return t.execute({ text: "hi" }).then(() => expect(calls).toEqual([["add", { text: "hi" }]]));
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run test/runtime-tools.test.ts`

- [ ] **Step 3: Implement `face/runtime.js`**

```js
// Hypernormal face runtime. ES module, no dependencies.
// An app handle is a projection of its charter: verbs become functions,
// state and charter are values you can read and watch, presence is events.

export function toolsFromCharter(charter, invoke) {
  return Object.entries(charter.verbs)
    .filter(([, v]) => v.access === "public")
    .map(([name, v]) => ({
      name,
      description: v.description,
      inputSchema: v.inputSchema,
      annotations: { untrustedContentHint: true },
      execute: (input) => invoke(name, input).then((result) => ({
        content: [{ type: "text", text: JSON.stringify(result) }],
      })),
    }));
}

function live(initial) {
  const watchers = new Set();
  let value = initial;
  return {
    get value() { return value; },
    set(next) { value = next; for (const fn of watchers) fn(value); },
    watch(fn) { watchers.add(fn); if (value !== undefined) fn(value); return () => watchers.delete(fn); },
  };
}

export async function connect(appUrl, options = {}) {
  const base = appUrl.replace(/\/$/, "");
  const invoke = async (name, input) => {
    const res = await fetch(`${base}/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? {}),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error);
    return body.result;
  };

  const charterRes = await fetch(base, { headers: { Accept: "application/json" } });
  const charterBody = await charterRes.json();
  if (!charterBody.ok) throw new Error(charterBody.error);

  const state = live(undefined);
  const charter = live(charterBody.charter);
  const presenceWatchers = new Set();

  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws");
  const firstState = new Promise((resolve) => {
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "state") { state.set(msg.state); resolve(); }
      else if (msg.type === "charter") { charter.set(msg.charter); retool(); }
      else if (msg.type === "presence") { for (const fn of presenceWatchers) fn(msg); }
    });
  });

  const verbs = {};
  function bindVerbs() {
    for (const k of Object.keys(verbs)) delete verbs[k];
    for (const [name, v] of Object.entries(charter.value.verbs)) {
      if (v.access === "public") verbs[name] = (input) => invoke(name, input);
    }
  }

  let toolController = null;
  async function retool() {
    bindVerbs();
    if (options.tools === false || typeof document === "undefined" || !("modelContext" in document)) return;
    if (toolController) toolController.abort();
    toolController = new AbortController();
    for (const tool of toolsFromCharter(charter.value, invoke)) {
      await document.modelContext.registerTool(tool, { signal: toolController.signal });
    }
  }

  await firstState;
  await retool();

  return {
    state: { get value() { return state.value; }, watch: state.watch },
    charter: { get value() { return charter.value; }, watch: charter.watch },
    verbs,
    invoke,
    presence: {
      emit(signal) { ws.send(JSON.stringify({ type: "presence", ...signal })); },
      watch(fn) { presenceWatchers.add(fn); return () => presenceWatchers.delete(fn); },
    },
    close() { if (toolController) toolController.abort(); ws.close(); },
  };
}
```

Note for the executor: `test/runtime-tools.test.ts` imports from `../face/runtime.js`; if the workers test pool rejects the import, give this one test file a node environment via a second vitest project (`vitest.workspace.ts` with a `node` project matching only `test/runtime-tools.test.ts`). Do not move the runtime into `src/`.

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run test/runtime-tools.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Face runtime: live values, charter-derived verbs, WebMCP bridge"
```

---

### Task 14: Examples

**Files:**
- Create: `examples/shared-list/charter.json`, `examples/shared-list/face.html`, `examples/poll/charter.json`, `examples/poll/face.html`, `examples/pulse/charter.json`, `examples/pulse/face.html`, `test/examples.test.ts`

**Interfaces:**
- Consumes: the full stack. Each example is a complete charter passing `checkCharter` plus a face using only `/runtime.js`.

- [ ] **Step 1: Write the failing test**

`test/examples.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import list from "../examples/shared-list/charter.json";
import poll from "../examples/poll/charter.json";
import pulse from "../examples/pulse/charter.json";

const owner = { Authorization: "Bearer test-owner-key" };

describe.each([
  ["shared-list", list, "add", { text: "milk" }],
  ["poll", poll, "vote", { option: "yes" }],
  ["pulse", pulse, "beat", {}],
])("example %s", (name, charter, verb, input) => {
  it("mints and its first verb runs", async () => {
    const res = await SELF.fetch("https://x/apps", { method: "POST", headers: owner, body: JSON.stringify({ charter }) });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as any;
    const r = await SELF.fetch(`https://x/a/${id}/rpc/${verb}`, { method: "POST", body: JSON.stringify(input) });
    expect(((await r.json()) as any).ok).toBe(true);
  });
});
```

If `tsconfig.json` lacks `resolveJsonModule`, enable it so the test can import the example charters.

- [ ] **Step 2: Write the three examples**

Each `charter.json` must pass the completeness rule: the intent alone tells a stranger the state shape, the rules, and what each verb means.

`examples/shared-list/charter.json`: intent describes `state = {items: [{id, text, done}]}`; verbs `add {text}` (public), `toggle {id}` (public), `remove {id}` (public), `clear` (owner). Initial state `{items: []}` documented in the intent.

`examples/poll/charter.json`: intent describes `state = {question, options: {yes: number, no: number}, open: boolean}`; verbs `vote {option enum [yes,no]}` (public, rejects when closed by returning `{ok:false, reason}` as its result), `close` (owner), `reopen` (owner).

`examples/pulse/charter.json`: a counter with `schedule: {cron: "0 * * * *", verb: "beat"}`; intent explains that the app beats hourly on its own; verbs `beat` (public), `read` (public).

Each `face.html`: one self-contained page, no CSS framework, that does exactly this shape:

```html
<!doctype html>
<meta charset="utf-8">
<title>Shared list</title>
<ul id="items"></ul>
<form id="f"><input id="t" placeholder="add an item"><button>Add</button></form>
<script type="module">
  import { connect } from "/runtime.js";
  const app = await connect(new URLSearchParams(location.search).get("app"));
  app.state.watch((s) => {
    document.getElementById("items").innerHTML = (s.items ?? [])
      .map((i) => `<li data-id="${i.id}" style="${i.done ? "text-decoration:line-through" : ""}">${i.text}</li>`).join("");
  });
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    await app.verbs.add({ text: document.getElementById("t").value });
    e.target.reset();
  };
  document.getElementById("items").onclick = (e) => {
    const id = e.target.dataset.id; if (id) app.verbs.toggle({ id });
  };
</script>
```

Poll and pulse faces follow the same pattern (render from `state.watch`, act through `app.verbs`). Escape user text before injecting into innerHTML (write a four-line `esc()` and use it; the shared-list snippet above must use it too in the final code).

- [ ] **Step 3: Run, expect pass**

Run: `npx vitest run test/examples.test.ts`

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Examples: shared list, poll, scheduled pulse"
```

---

### Task 15: PROTOCOL.md, README.md, owner CLI

**Files:**
- Create: `PROTOCOL.md`, `README.md`, `scripts/hn.sh`

- [ ] **Step 1: Write PROTOCOL.md**

Sections, all content real, no placeholders:
1. **Semantics** (from the spec, verbatim in register): a verb is a pure step from state and input to state and result; an invocation is atomic; invocations on one app are totally ordered; state is a value you can always read and watch, presence is events you can only witness.
2. **Routes**: the full table from the spec with methods, auth, shapes.
3. **Error form**: `{ok:false, error}`; transport vs app-level ok, with the double-ok example.
4. **Budgets**: the table, values copied from `src/types.ts` at writing time, with a note that `src/types.ts` is the source of truth.
5. **Schema subset**: allowed keys per type, depth 8, strict input validation.
6. **Socket protocol**: the three server message types, the two client message types, ordering promise.
7. **WebMCP mapping**: public verb to tool, field by field, `untrustedContentHint` always true, re-registration on charter change.

- [ ] **Step 2: Write README.md**

Content: what Hypernormal is (three sentences, definition register), the three words, fork-and-deploy: `npm install`, `npx wrangler secret put OWNER_KEY`, `npm run deploy`, sign in at `/login`, read `/` for the manual. Optional env: `OPEN_MINT`, `WEBMCP_OT_TOKEN`. Pointer to DEFINITION.md and PROTOCOL.md. State plainly: rate limiting depends on the ratelimit binding; if a plan lacks it the deploy still works and abuse limits are absent.

- [ ] **Step 3: Write scripts/hn.sh**

Port `.context/repos/farnsworth-house/scripts/fw.sh`, simplified: reads `.owner-key` (gitignored) from repo root or `$HN_KEY`, base URL from `$HN_BASE`, sends `Authorization: Bearer`, prints body and status. Usage line: `hn.sh METHOD PATH [JSON_BODY]`.

- [ ] **Step 4: Verify docs against code**

Re-read `PROTOCOL.md` against `src/index.ts` routes and `src/types.ts` budgets; fix any drift now.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Docs: PROTOCOL, README, owner CLI"
```

---

### Task 16: Full verification

- [ ] **Step 1: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all green. Fix anything red before proceeding; do not weaken a test to pass it.

- [ ] **Step 2: Live smoke (human checkpoint)**

`npm run dev`, then with `scripts/hn.sh`: mint the shared-list example, open its face in a browser with `?app=http://localhost:8787/a/<id>`, watch two tabs sync, register the face via `PUT /f/shared-list`, open `/f/shared-list?app=...`. In WebMCP-enabled Chrome, confirm the tools appear via the inspector extension. Record results in `docs/webmcp-verification.md` under the log.

- [ ] **Step 3: Commit any fixes; report**

Summarize deviations from plan in the final report to the human.
