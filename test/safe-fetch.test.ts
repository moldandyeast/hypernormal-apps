import { describe, it, expect } from "vitest";
import { assertAllowed } from "../src/safe-fetch";

describe("assertAllowed", () => {
  const allow = ["api.example.com"];
  it("permits an allowlisted https host", () => {
    expect(assertAllowed("https://api.example.com/x", allow).hostname).toBe("api.example.com");
  });
  it("is case-insensitive and strips trailing dot", () => {
    expect(assertAllowed("https://API.example.com./x", allow).hostname).toBe("api.example.com");
  });
  it("rejects non-allowlisted host", () => {
    expect(() => assertAllowed("https://evil.com/x", allow)).toThrow("host_not_allowlisted");
  });
  it("rejects http scheme", () => {
    expect(() => assertAllowed("http://api.example.com/x", allow)).toThrow("scheme_blocked");
  });
  it("rejects IP literals and encoded IPs", () => {
    expect(() => assertAllowed("https://127.0.0.1/x", ["127.0.0.1"])).toThrow("ip_literal_blocked");
    expect(() => assertAllowed("https://2852039166/x", ["2852039166"])).toThrow("ip_literal_blocked");
    expect(() => assertAllowed("https://0x7f000001/x", ["0x7f000001"])).toThrow("ip_literal_blocked");
  });
  it("rejects internal hostnames", () => {
    expect(() => assertAllowed("https://localhost/x", ["localhost"])).toThrow("internal_host_blocked");
    expect(() => assertAllowed("https://metadata.google.internal/x", ["metadata.google.internal"])).toThrow(
      "internal_host_blocked",
    );
  });
  it("rejects malformed URLs", () => {
    expect(() => assertAllowed("not a url", allow)).toThrow("bad_url");
  });
});
