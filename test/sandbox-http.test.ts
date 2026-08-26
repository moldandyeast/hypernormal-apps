import { describe, it, expect } from "vitest";
import { execute, type HostHttp } from "../src/sandbox";

describe("ctx.http", () => {
  it("guest calls ctx.http.get synchronously and gets the body", async () => {
    const hostHttp: HostHttp = {
      get: async () => ({ status: 200, body: "pong" }),
      post: async () => ({ status: 200, body: "" }),
    };
    const r = await execute(
      "const res = ctx.http.get('https://api.example.com/ping'); return res.body;",
      {},
      {},
      { hostHttp },
    );
    expect(r).toEqual({ ok: true, result: "pong", state: {} });
  });

  it("a host error surfaces as an error object to the guest", async () => {
    const hostHttp: HostHttp = {
      get: async () => ({ error: "host_not_allowlisted" }),
      post: async () => ({ status: 200, body: "" }),
    };
    const r = await execute("return ctx.http.get('https://evil.com/x').error;", {}, {}, { hostHttp });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toBe("host_not_allowlisted");
  });

  it("sends a string body verbatim (form-encoded OAuth, not double-encoded)", async () => {
    let seenBody: unknown;
    let seenHeaders: unknown;
    const hostHttp: HostHttp = {
      get: async () => ({ status: 200, body: "" }),
      post: async (_url, body, headers) => {
        seenBody = body;
        seenHeaders = headers;
        return { status: 200, body: "ok" };
      },
    };
    const r = await execute(
      "return ctx.http.post('https://api.example.com/token', 'grant_type=client_credentials&scope=a', { 'Content-Type': 'application/x-www-form-urlencoded' }).status;",
      {},
      {},
      { hostHttp },
    );
    expect(r).toEqual({ ok: true, result: 200, state: {} });
    expect(seenBody).toBe("grant_type=client_credentials&scope=a");
    expect(seenHeaders).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
  });

  it("JSON-encodes an object body (existing behavior preserved)", async () => {
    let seenBody: unknown;
    const hostHttp: HostHttp = {
      get: async () => ({ status: 200, body: "" }),
      post: async (_url, body) => {
        seenBody = body;
        return { status: 200, body: "ok" };
      },
    };
    const r = await execute(
      "return ctx.http.post('https://api.example.com/x', { a: 1, b: 'two' }).status;",
      {},
      {},
      { hostHttp },
    );
    expect(r).toEqual({ ok: true, result: 200, state: {} });
    expect(seenBody).toBe(JSON.stringify({ a: 1, b: "two" }));
  });
});
