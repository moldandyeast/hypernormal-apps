import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import look from "../site/look.charter.json";
import lookState from "../site/look.state.json";
import log from "../site/log.charter.json";
import logState from "../site/log.state.json";
import page from "../site/page.charter.json";
import pageState from "../site/page.state.json";

const owner = { Authorization: "Bearer test-owner-key" };

async function mint(charter: unknown, state: unknown): Promise<string> {
  const res = await SELF.fetch("https://x/apps", {
    method: "POST",
    headers: owner,
    body: JSON.stringify({ charter, state }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const rpc = (id: string, verb: string, input: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch(`https://x/a/${id}/rpc/${verb}`, { method: "POST", headers, body: JSON.stringify(input) });

describe("site: look app", () => {
  it("changes within the palette and bumps seq; rejects outside it", async () => {
    const id = await mint(look, lookState);
    const r1 = (await (await rpc(id, "set_accent", { accent: "teal" })).json()) as any;
    expect(r1).toMatchObject({ ok: true, result: { accent: "teal", seq: 1 } });
    const r2 = (await (await rpc(id, "set_mode", { mode: "dark" })).json()) as any;
    expect(r2.result.seq).toBe(2);
    const bad = await rpc(id, "set_accent", { accent: "hotpink" });
    expect(bad.status).toBe(400);
    const badMode = await rpc(id, "set_mode", { mode: "blinding" });
    expect(badMode.status).toBe(400);
    const reset = (await (await rpc(id, "reset", {})).json()) as any;
    expect(reset.result).toMatchObject({ mode: "light", accent: "indigo", radius: "soft", seq: 3 });
  });
});

describe("site: log app", () => {
  it("records once per seq, refuses duplicates, validates the snapshot", async () => {
    const id = await mint(log, logState);
    const snap = { mode: "dark", accent: "teal", radius: "round" };
    const first = (await (await rpc(id, "record", { seq: 1, look: snap })).json()) as any;
    expect(first.result).toMatchObject({ recorded: true, count: 1 });
    const dup = (await (await rpc(id, "record", { seq: 1, look: snap })).json()) as any;
    expect(dup.result).toMatchObject({ recorded: false, count: 1 });
    const second = (await (await rpc(id, "record", { seq: 2, look: { ...snap, accent: "red" } })).json()) as any;
    expect(second.result).toMatchObject({ recorded: true, count: 2 });
    const badSnap = await rpc(id, "record", { seq: 3, look: { ...snap, accent: "hotpink" } });
    expect(badSnap.status).toBe(400);
    const guestClear = await rpc(id, "clear", {});
    expect(guestClear.status).toBe(404);
    const ownerClear = (await (await rpc(id, "clear", {}, owner)).json()) as any;
    expect(ownerClear.result).toMatchObject({ cleared: true });
  });
});

describe("site: page app", () => {
  it("serves sections to anyone; only the owner edits; unknown id lists valid ids", async () => {
    const id = await mint(page, pageState);
    const state = (await (await SELF.fetch(`https://x/a/${id}/state`)).json()) as any;
    expect(state.state.sections.map((s: any) => s.id)).toContain("separation");
    const guest = await rpc(id, "edit_section", { id: "claim", title: "hax" });
    expect(guest.status).toBe(404);
    const edit = (await (await rpc(id, "edit_section", { id: "claim", title: "there is no perfect interface, plainly" }, owner)).json()) as any;
    expect(edit.result).toMatchObject({ id: "claim", title: "there is no perfect interface, plainly" });
    const missing = await rpc(id, "edit_section", { id: "nope" }, owner);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as any).error).toMatch(/separation/);
  });
});
