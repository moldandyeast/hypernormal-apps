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
