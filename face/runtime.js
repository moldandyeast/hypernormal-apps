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
    if (options.tools === false || typeof document === "undefined" || !("modelContext" in document)) return;
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
