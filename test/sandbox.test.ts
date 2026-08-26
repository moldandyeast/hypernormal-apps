import { describe, it, expect } from "vitest";
import { execute } from "../src/sandbox";

describe("execute", () => {
  it("returns a computed result and unchanged state", async () => {
    const r = await execute("return ctx.input.a + ctx.input.b;", {}, { a: 2, b: 3 });
    expect(r).toEqual({ ok: true, result: 5, state: {} });
  });

  it("mutates and persists state", async () => {
    const r = await execute(
      "ctx.state.count = (ctx.state.count || 0) + ctx.input.n; return ctx.state.count;",
      { count: 1 },
      { n: 4 },
    );
    expect(r).toEqual({ ok: true, result: 5, state: { count: 5 } });
  });

  it("mutates state atomically in-sandbox and returns it", async () => {
    const r = await execute("ctx.state.n = (ctx.state.n ?? 0) + 1; return ctx.state.n;", {}, {});
    expect(r).toMatchObject({ ok: true, result: 1, state: { n: 1 } });
  });

  it("normalizes undefined result to null", async () => {
    const r = await execute("ctx.state.k = 1;", {}, {});
    expect(r).toEqual({ ok: true, result: null, state: { k: 1 } });
  });

  it("returns a readable error on throw", async () => {
    const r = await execute("throw new Error('kaboom');", {}, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("kaboom");
  });

  it("enforces the ops budget", async () => {
    const r = await execute("while(true){}", {}, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/interrupt|budget|timeout/i);
  }, 10_000);

  it("has no http without hostHttp", async () => {
    const r = await execute("return typeof ctx.http;", {}, {});
    expect(r).toMatchObject({ ok: true, result: "undefined" });
  });

  it("exposes ctx.now as a real timestamp near invocation", async () => {
    const before = Date.now();
    const r = await execute("return ctx.now;", {}, {});
    const after = Date.now();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(typeof r.result).toBe("number");
      expect(r.result as number).toBeGreaterThanOrEqual(before);
      expect(r.result as number).toBeLessThanOrEqual(after);
    }
  });

  it("freezes the clock and seeds randomness", async () => {
    const r = await execute(
      "const a = ctx.now; const b = ctx.now; return { same: a === b, rnd: typeof ctx.random() };",
      {},
      {},
    );
    expect(r).toMatchObject({ ok: true, result: { same: true, rnd: "number" } });
  });

  it("exposes ctx.random() as a float in [0,1) that advances", async () => {
    const r = await execute(
      "const a = ctx.random(); const b = ctx.random(); return { a, b, inRange: a >= 0 && a < 1 && b >= 0 && b < 1, differ: a !== b };",
      {},
      {},
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = r.result as { inRange: boolean; differ: boolean };
      expect(out.inRange).toBe(true);
      expect(out.differ).toBe(true);
    }
  });

  it("re-seeds ctx.random per invocation (not deterministic across calls)", async () => {
    const one = await execute("return ctx.random();", {}, {});
    const two = await execute("return ctx.random();", {}, {});
    expect(one.ok && two.ok).toBe(true);
    if (one.ok && two.ok) expect(one.result).not.toBe(two.result);
  });

  // The definition's central law: a verb with no allowedHosts is a pure function
  // of (state, input, clock, seed). The ambient `Date` and `Math.random` globals
  // must not be a second, live source of time or entropy.
  it("routes ambient Date to the frozen clock: Date.now() equals ctx.now and is stable", async () => {
    const r = await execute(
      `const a = Date.now(); const b = Date.now();
       return { a, b, ctxNow: ctx.now, viaNew: new Date().getTime() };`,
      {},
      {},
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const o = r.result as { a: number; b: number; ctxNow: number; viaNew: number };
      expect(o.a).toBe(o.ctxNow);
      expect(o.b).toBe(o.ctxNow);
      expect(o.a).toBe(o.b);
      expect(o.viaNew).toBe(o.ctxNow);
    }
  });

  it("a verb cannot recover a live wall clock by any escape", async () => {
    const r = await execute(
      `const nested = () => Date.now();
       // eval may be disabled in this build; if so, fall back to ctx.now so the
       // probe still asserts "no value other than ctx.now is reachable".
       const viaEval = (function () {
         try { return (0, eval)("Date.now()"); } catch (e) { return ctx.now; }
       })();
       // The instance's prototype-chain constructor must lead back to the shadow,
       // never to the real Date (whose now()/no-arg construction reads the host
       // wall clock).
       const viaInstanceCtor = new Date().constructor.now();
       const viaProtoCtor = Date.prototype.constructor.now();
       const viaReconstruct = new (new Date().constructor)().getTime();
       return {
         ctxNow: ctx.now,
         nested: nested(),
         viaEval,
         viaInstanceCtor,
         viaProtoCtor,
         viaReconstruct,
         realDateType: typeof RealDate,
       };`,
      {},
      {},
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const o = r.result as Record<string, unknown>;
      // The real reference is trapped in an inner scope; the guest sees nothing.
      expect(o.realDateType).toBe("undefined");
      for (const k of ["nested", "viaEval", "viaInstanceCtor", "viaProtoCtor", "viaReconstruct"]) {
        expect(o[k], `escape via ${k} recovered a clock other than ctx.now`).toBe(o.ctxNow);
      }
    }
  });

  it("routes ambient Math.random to the seeded PRNG (identity with ctx.random)", async () => {
    const r = await execute(
      `const same = Math.random === ctx.random;
       const a = Math.random(); const b = Math.random();
       return { same, a, b, inRange: a >= 0 && a < 1 && b >= 0 && b < 1, differ: a !== b };`,
      {},
      {},
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const o = r.result as { same: boolean; inRange: boolean; differ: boolean };
      expect(o.same).toBe(true);
      expect(o.inRange).toBe(true);
      expect(o.differ).toBe(true);
    }
  });
});
