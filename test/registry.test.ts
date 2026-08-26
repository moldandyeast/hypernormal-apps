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
