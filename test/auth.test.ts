import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { isOwner, mintSession } from "../src/auth";

const req = (headers: Record<string, string> = {}) => new Request("https://x/", { headers });

// Forges a validly-signed session ticket without importing any internals from
// src/auth.ts: this replicates the module's documented derivation
// ("hypernormal-session-v1:" + ownerKey -> SHA-256 -> HMAC key) using only
// Web Crypto, the same way an attacker who somehow obtained OWNER_KEY (or a
// future ticket-minting code path reusing the same derived key) would be
// able to. `payloadJson` is passed as a raw string, not an object run through
// JSON.stringify, so tests can construct out-of-range numeric literals
// (e.g. "1e999") that JSON.stringify could never produce but JSON.parse on
// the verifying side still accepts as Infinity.
async function forgeTicket(ownerKey: string, payloadJson: string): Promise<string> {
  const enc = new TextEncoder();
  const b64url = (bytes: Uint8Array) => {
    let s = "";
    for (const byte of bytes) s += String.fromCharCode(byte);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("hypernormal-session-v1:" + ownerKey));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const p = b64url(enc.encode(payloadJson));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(p));
  return `${p}.${b64url(new Uint8Array(sig))}`;
}

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
  it("rejects a validly-signed ticket with the wrong or missing sub", async () => {
    const future = Math.floor(Date.now() / 1000) + 1000;
    const wrongSub = await forgeTicket("test-owner-key", JSON.stringify({ sub: "attacker", exp: future }));
    expect(await isOwner(req({ Cookie: `__Host-sid=${wrongSub}` }), env as any)).toBe(false);

    const noSub = await forgeTicket("test-owner-key", JSON.stringify({ exp: future }));
    expect(await isOwner(req({ Cookie: `__Host-sid=${noSub}` }), env as any)).toBe(false);
  });
  it("rejects a validly-signed ticket with a non-finite exp", async () => {
    // A raw out-of-range numeric literal: JSON.parse turns this into
    // Infinity, which `typeof x === "number"` would wrongly accept.
    const ticket = await forgeTicket("test-owner-key", '{"sub":"owner","exp":1e999}');
    expect(await isOwner(req({ Cookie: `__Host-sid=${ticket}` }), env as any)).toBe(false);
  });
});
