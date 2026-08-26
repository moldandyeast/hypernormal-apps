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

// Exported and tested. Decides whether connect() may register WebMCP tools.
// docOrigin is self.location.origin (or null/undefined outside a browser);
// appUrl is the target app URL; opts is connect()'s options.
//
// The default is same-origin-only: a face registers tools onto the document's
// origin, and a tool's name and description are attacker-controlled text
// whenever the app is attacker-controlled. Registering only when the app is
// same-origin as the face keeps that text confined to content the origin
// already trusts. Cross-origin registration is opt-in only, via
// {tools: "cross-origin"}.
export function mayRegisterTools(appUrl, docOrigin, opts = {}) {
  if (opts.tools === false) return false; // explicit full opt-out (existing behavior)
  if (opts.tools === "cross-origin") return true; // explicit opt-in to cross-origin registration
  if (!docOrigin) return false; // no trusted origin to register onto (file://, opaque, non-browser)
  let appOrigin;
  try {
    appOrigin = new URL(appUrl, docOrigin).origin;
  } catch {
    return false;
  }
  return appOrigin === docOrigin; // same-origin only, by default
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
  const firstState = new Promise((resolve, reject) => {
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "state") { state.set(msg.state); resolve(); }
      else if (msg.type === "charter") { charter.set(msg.charter); retool(); }
      else if (msg.type === "presence") { for (const fn of presenceWatchers) fn(msg); }
    });
    ws.addEventListener("error", () => reject(new Error(`WebSocket connection to ${base}/ws failed`)));
    ws.addEventListener("close", () => reject(new Error(`WebSocket to ${base}/ws closed before receiving state`)));
  });

  const verbs = {};
  function bindVerbs() {
    for (const k of Object.keys(verbs)) delete verbs[k];
    for (const [name, v] of Object.entries(charter.value.verbs)) {
      if (v.access === "public") verbs[name] = (input) => invoke(name, input);
    }
  }

  let toolController = null;
  async function registerTools() {
    if (typeof document === "undefined" || !("modelContext" in document)) return;
    if (options.tools === false) return;
    const docOrigin = typeof self !== "undefined" && self.location ? self.location.origin : undefined;
    if (!mayRegisterTools(appUrl, docOrigin, options)) {
      console.warn('Hypernormal: not registering WebMCP tools for a cross-origin app; pass { tools: "cross-origin" } to connect() to override.');
      return;
    }
    if (toolController) toolController.abort();
    toolController = new AbortController();
    const signal = toolController.signal;
    for (const tool of toolsFromCharter(charter.value, invoke)) {
      await document.modelContext.registerTool(tool, { signal });
    }
  }

  let retooling = Promise.resolve();
  function retool() {
    bindVerbs();
    retooling = retooling.then(registerTools).catch(() => {});
    return retooling;
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
