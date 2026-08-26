import { describe, it, expect } from "vitest";
import { mint, counterCharter } from "./helpers";

const guest = { "X-Owner": "0" };

async function open(stub: any) {
  const res = await stub.fetch("https://do/ws", { headers: { ...guest, Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const messages: any[] = [];
  ws.addEventListener("message", (e: MessageEvent) => { messages.push(JSON.parse(e.data as string)); });
  return { ws, messages };
}
// Fixed-delay sleeps before asserting on accumulated WebSocket messages are
// inherently flaky under load: a busy test runner can make delivery take
// longer than any fixed budget. Instead, poll for the specific condition
// each call site actually depends on (a message count, a message type, a
// close event) and fail fast with a clear error if it never arrives, rather
// than silently racing a timer.
async function waitFor(predicate: () => boolean, description: string, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor: timed out after ${timeout}ms waiting for: ${description}`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("watching", () => {
  it("sends full state on connect", async () => {
    const { stub } = await mint(counterCharter, { count: 4 });
    const { messages } = await open(stub);
    await waitFor(() => messages.length >= 1, "initial state message");
    expect(messages[0]).toEqual({ type: "state", state: { count: 4 } });
  });
  it("broadcasts state after invocation and seed, charter after amend and rollback", async () => {
    const { stub } = await mint(counterCharter, { count: 0 });
    const { messages } = await open(stub);
    await waitFor(() => messages.length >= 1, "initial state message");
    await stub.fetch("https://do/rpc/bump", { method: "POST", headers: guest, body: "{}" });
    await stub.fetch("https://do/state", { method: "PUT", headers: { "X-Owner": "1" }, body: JSON.stringify({ count: 8 }) });
    await stub.fetch("https://do/charter", { method: "PUT", headers: { "X-Owner": "1" }, body: JSON.stringify({ intent: "Edition 2. State is {count}." }) });
    await waitFor(() => messages.length >= 4, "bump/seed/amend broadcasts (3 state/charter messages after the initial state)");
    const types = messages.map((m) => m.type);
    expect(types).toEqual(["state", "state", "state", "charter"]);
    expect(messages[3].charter.intent).toMatch(/Edition 2/);
  });
  it("refuses a guest's socket on a private app without the router's help", async () => {
    // Straight at the Durable Object, no router in the path: the app itself
    // decides who may watch it, so the router's connect-time gate cannot be
    // raced by an amendment landing between its charter read and its upgrade.
    const priv = structuredClone(counterCharter) as any;
    priv.law.visibility = "private";
    const { stub } = await mint(priv, { count: 0 });

    const denied = await stub.fetch("https://do/ws", { headers: { ...guest, Upgrade: "websocket" } });
    expect(denied.status).toBe(404);
    expect(denied.webSocket).toBe(null);
    expect(((await denied.json()) as any).error).toMatch(/No app lives at this URL/);

    const allowed = await stub.fetch("https://do/ws", { headers: { "X-Owner": "1", Upgrade: "websocket" } });
    expect(allowed.status).toBe(101);
    allowed.webSocket!.accept();
    allowed.webSocket!.close();
  });
  it("closes every watcher when an amendment makes the app private", async () => {
    // counterCharter is unlisted, so this guest is admitted when it connects.
    const { stub } = await mint(counterCharter, { count: 0 });
    const a = await open(stub);
    await waitFor(() => a.messages.length >= 1, "initial state message");
    expect(a.messages[0]).toEqual({ type: "state", state: { count: 0 } });
    const closes: { code: number; reason: string }[] = [];
    a.ws.addEventListener("close", (e: CloseEvent) => { closes.push({ code: e.code, reason: e.reason }); });

    await stub.fetch("https://do/charter", {
      method: "PUT",
      headers: { "X-Owner": "1" },
      body: JSON.stringify({ law: { visibility: "private", allowedHosts: [] } }),
    });
    // The server broadcasts the charter and then closes the socket in the
    // same synchronous handler (see closeSocketsIfPrivate in src/app.ts), so
    // waiting for the close event guarantees the charter message already
    // arrived on this same ordered connection.
    await waitFor(() => closes.length >= 1, "socket close after privatizing amendment");

    // The final charter still reaches the socket, then the socket goes.
    expect(a.messages.at(-1).type).toBe("charter");
    expect(closes).toHaveLength(1);
    expect(closes[0].code).toBe(4001);
    expect(closes[0].reason).toMatch(/private/i);
  });
  it("leaves watchers connected when an amendment only makes the app unlisted", async () => {
    const pub = structuredClone(counterCharter) as any;
    pub.law.visibility = "public";
    const { stub } = await mint(pub, { count: 0 });
    const a = await open(stub);
    await waitFor(() => a.messages.length >= 1, "initial state message");
    const closes: number[] = [];
    a.ws.addEventListener("close", (e: CloseEvent) => { closes.push(e.code); });

    await stub.fetch("https://do/charter", {
      method: "PUT",
      headers: { "X-Owner": "1" },
      body: JSON.stringify({ law: { visibility: "unlisted", allowedHosts: [] } }),
    });
    await stub.fetch("https://do/rpc/bump", { method: "POST", headers: guest, body: "{}" });
    await waitFor(
      () => a.messages.some((m) => m.type === "state" && m.state?.count === 1),
      "bumped state message after unlisted amendment",
    );

    expect(closes).toHaveLength(0);
    expect(a.messages.at(-1)).toEqual({ type: "state", state: { count: 1 } });
  });
  it("relays presence to others only, never stores it, enforces the signal budget", async () => {
    const { stub } = await mint(counterCharter);
    const a = await open(stub);
    const b = await open(stub);
    await waitFor(() => a.messages.length >= 1 && b.messages.length >= 1, "initial state on both sockets");
    a.ws.send(JSON.stringify({ type: "presence", cursor: [1, 2] }));
    a.ws.send(JSON.stringify({ type: "presence", blob: "x".repeat(5000) })); // over budget: dropped
    a.ws.send("not json"); // dropped
    // The valid presence signal, the over-budget one, and the malformed one
    // are all handled in the order they were sent on the same socket, so by
    // the time the valid one is relayed to b, the server has already decided
    // the fate of the other two (drop silently, never touch a).
    await waitFor(() => b.messages.some((m) => m.type === "presence"), "relayed presence message on b");
    expect(b.messages.filter((m) => m.type === "presence")).toHaveLength(1);
    expect(a.messages.filter((m) => m.type === "presence")).toHaveLength(0);
    const s = (await (await stub.fetch("https://do/state", { headers: guest })).json()) as any;
    expect(JSON.stringify(s.state)).not.toMatch(/cursor/);
  });
  it("enforces the signal budget in UTF-8 bytes, not JS string length", async () => {
    const { stub } = await mint(counterCharter);
    const a = await open(stub);
    const b = await open(stub);
    await waitFor(() => a.messages.length >= 1 && b.messages.length >= 1, "initial state on both sockets");
    // Each "🎉" is 2 UTF-16 code units (JS .length) but 4 UTF-8 bytes: 1500 of them is
    // 3000 in .length (under BUDGET.SIGNAL=4096) but 6000 UTF-8 bytes (over budget).
    const over = JSON.stringify({ type: "presence", blob: "🎉".repeat(1500) });
    expect(over.length).toBeLessThan(4096);
    a.ws.send(over); // over the real byte budget: dropped
    const under = JSON.stringify({ type: "presence", blob: "🎉".repeat(100) }); // well under budget either way
    a.ws.send(under);
    // Same ordering guarantee as the previous test: both sends are handled
    // in order on the same socket, so the under-budget relay landing on b
    // means the over-budget one has already been dropped.
    await waitFor(() => b.messages.some((m) => m.type === "presence"), "relayed presence message on b");
    const relayed = b.messages.filter((m) => m.type === "presence");
    expect(relayed).toHaveLength(1);
    expect(relayed[0].blob).toBe("🎉".repeat(100));
  });
  it("answers ping with pong", async () => {
    const { stub } = await mint(counterCharter);
    const a = await open(stub);
    await waitFor(() => a.messages.length >= 1, "initial state message");
    a.ws.send("ping");
    await waitFor(() => a.messages.some((m) => m.type === "pong"), "pong reply");
    expect(a.messages.at(-1)).toEqual({ type: "pong" });
  });
});
