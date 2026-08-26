import type { Env } from "./types";

const enc = new TextEncoder();
const dec = new TextDecoder();

const COOKIE_NAME = "__Host-sid";
const SESSION_TTL_SEC = 2_592_000; // 30 days

export async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  // crypto.subtle.timingSafeEqual throws on mismatched lengths. Compare a
  // digest against itself instead of short-circuiting on `a.byteLength ===
  // b.byteLength`, so an attacker can't learn anything from a length check.
  return a.byteLength === b.byteLength
    ? crypto.subtle.timingSafeEqual(a, b)
    : !crypto.subtle.timingSafeEqual(a, a);
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// The session ticket's HMAC key is derived from OWNER_KEY rather than
// configured as a second secret. This means:
//   - forkers only ever set one secret (OWNER_KEY),
//   - rotating OWNER_KEY silently invalidates every outstanding session,
//   - the derivation is deterministic (same OWNER_KEY -> same key), so
//     tickets minted before a Worker restart still verify.
// The prefix namespaces the derivation so this key can never collide with
// OWNER_KEY's own use as a bearer-comparison input.
async function sessionKey(ownerKey: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("hypernormal-session-v1:" + ownerKey));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function mintTicket(ownerKey: string, ttlSec = SESSION_TTL_SEC): Promise<string> {
  const payload = JSON.stringify({ sub: "owner", exp: Math.floor(Date.now() / 1000) + ttlSec });
  const p = b64url(enc.encode(payload));
  const sig = await crypto.subtle.sign("HMAC", await sessionKey(ownerKey), enc.encode(p));
  return `${p}.${b64url(new Uint8Array(sig))}`;
}

async function verifyTicket(ownerKey: string, ticket: string | null): Promise<boolean> {
  // Fail closed on an empty owner key: an empty OWNER_KEY would derive a key
  // from a fixed, publicly-known string, letting anyone forge a valid
  // ticket. Never authenticate against that.
  if (!ownerKey || !ticket) return false;
  const dot = ticket.indexOf(".");
  if (dot < 0) return false;
  const p = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);
  let expected: ArrayBuffer;
  try {
    expected = await crypto.subtle.sign("HMAC", await sessionKey(ownerKey), enc.encode(p));
  } catch {
    return false;
  }
  try {
    if (!timingSafeEqualBytes(b64urlToBytes(sig), new Uint8Array(expected))) return false;
    const { exp } = JSON.parse(dec.decode(b64urlToBytes(p)));
    return typeof exp === "number" && exp > Math.floor(Date.now() / 1000);
  } catch {
    // Malformed base64/JSON in either segment: fail closed, never throw.
    return false;
  }
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

async function checkOwnerKey(presented: string, ownerKey: string | undefined): Promise<boolean> {
  // Fail closed on an empty configured key: with an empty OWNER_KEY, an empty
  // presented bearer would hash-match and grant owner. Never let an unset
  // secret be satisfied by an unset (or blank) credential.
  if (!ownerKey || !presented) return false;
  const [a, b] = await Promise.all([sha256(presented), sha256(ownerKey)]);
  return timingSafeEqualBytes(a, b);
}

export async function isOwner(request: Request, env: Env): Promise<boolean> {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    if (await checkOwnerKey(auth.slice(7), env.OWNER_KEY)) return true;
  }
  return verifyTicket(env.OWNER_KEY ?? "", readCookie(request, COOKIE_NAME));
}

export async function mintSession(env: Env): Promise<string> {
  const ticket = await mintTicket(env.OWNER_KEY ?? "");
  return `${COOKIE_NAME}=${ticket}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`;
}

export function clearSession(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
