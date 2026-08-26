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
