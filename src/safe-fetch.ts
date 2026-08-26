const BLOCKED_HOST_RE = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

function isIpLiteralOrEncoded(host: string): boolean {
  if (host.includes(":")) return true; // IPv6 literal
  if (/^\d+$/.test(host)) return true; // decimal
  if (/^0x[0-9a-f]+$/i.test(host)) return true; // hex
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // dotted v4
  if (/^0\d+/.test(host)) return true; // octal-ish
  return false;
}

export function assertAllowed(rawUrl: string, allowedHosts: string[]): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("bad_url");
  }
  if (u.protocol !== "https:") throw new Error("scheme_blocked");
  const host = u.hostname.replace(/\.$/, "").toLowerCase();
  if (isIpLiteralOrEncoded(host)) throw new Error("ip_literal_blocked");
  if (BLOCKED_HOST_RE.test(host)) throw new Error("internal_host_blocked");
  const allow = new Set(allowedHosts.map((h) => h.replace(/\.$/, "").toLowerCase()));
  if (!allow.has(host)) throw new Error("host_not_allowlisted");
  u.hostname = host;
  return u;
}

export async function safeFetch(
  rawUrl: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  opts: { allowedHosts: string[]; timeoutMs?: number; maxBytes?: number },
): Promise<{ status: number; body: string }> {
  const url = assertAllowed(rawUrl, opts.allowedHosts);
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const res = await fetch(url.toString(), {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    redirect: "manual",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
  });
  if (res.status >= 300 && res.status < 400) throw new Error("redirect_blocked");
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("response_too_large");
      }
      chunks.push(value);
    }
  }
  return { status: res.status, body: new TextDecoder().decode(concat(chunks, total)) };
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
