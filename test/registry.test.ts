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
  it("validates face visibility against the enum, failing closed on a typo", async () => {
    const base = { title: "T", html: "<p>x</p>", targets: [] as string[] };
    // A typo must be rejected, not stored: the /f gate serves everything that is
    // not exactly "private", so an unvalidated "privat" would fail open.
    const bad = await j("PUT", "/faces/typo", { ...base, visibility: "privat" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toMatch(/visibility/);
    // A stored face is never left behind by the rejected write.
    expect((await j("GET", "/faces/typo")).status).toBe(404);
    for (const visibility of ["private", "unlisted", "public"]) {
      expect((await j("PUT", `/faces/ok-${visibility}`, { ...base, visibility })).status).toBe(200);
    }
  });
  it("rejects a non-array targets with a 400", async () => {
    const bad = await j("PUT", "/faces/badtargets", { title: "T", html: "<p>x</p>", targets: "a1", visibility: "public" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toMatch(/targets/);
    expect((await j("GET", "/faces/badtargets")).status).toBe(404);
  });
  it("enforces the face budget in UTF-8 bytes, not JS string length", async () => {
    // Each "🎉" is 2 UTF-16 code units (JS .length) but 4 UTF-8 bytes: 200,000 of them is
    // 400,000 in .length (under BUDGET.FACE=512*1024=524288) but 800,000 UTF-8 bytes (over budget).
    const html = "🎉".repeat(200_000);
    expect(html.length).toBeLessThan(512 * 1024);
    const face = { title: "Emoji", html, targets: [], visibility: "public" };
    expect((await j("PUT", "/faces/emoji", face)).status).toBe(400);
  });
  it("orders GET /apps by a monotonic sequence, not by Date.now() (which can tie even across back-to-back awaited calls)", async () => {
    // The original flake reproduced with nothing more exotic than two sequential, awaited
    // POST /apps/register calls (see the first test above): Workers coarsens Date.now() during
    // synchronous execution, so two DO round trips issued back-to-back in a fast test harness
    // can still land in the same millisecond. Registering many apps in a tight sequential loop
    // -- each fully awaited before the next starts, so there is no concurrent-dispatch reordering
    // to confound the result -- reliably reproduces that same-millisecond collision opportunity.
    // seq (not updated) must be the sole tie-breaker, so the response must reflect exact
    // registration order regardless of what Date.now() returned for each insert.
    const ids = Array.from({ length: 25 }, (_, i) => `s${i}`);
    for (const id of ids) {
      await j("POST", "/apps/register", { id, intent: id, visibility: "public" });
    }
    const list = (await (await j("GET", "/apps")).json()) as any;
    const ours = list.apps.map((a: any) => a.id).filter((id: string) => ids.includes(id));
    expect(ours).toEqual([...ids].reverse());
  });
  it("orders GET /faces by a monotonic sequence too, for the same reason", async () => {
    const names = Array.from({ length: 25 }, (_, i) => `t${i}`);
    for (const name of names) {
      await j("PUT", `/faces/${name}`, { title: name, html: "<p>x</p>", targets: [], visibility: "public" });
    }
    const list = (await (await j("GET", "/faces")).json()) as any;
    const ours = list.faces.map((f: any) => f.name).filter((name: string) => names.includes(name));
    expect(ours).toEqual([...names].reverse());
  });
});
