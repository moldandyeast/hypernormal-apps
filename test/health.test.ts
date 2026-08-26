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
