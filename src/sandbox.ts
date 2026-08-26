import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import type { QuickJSAsyncWASMModule } from "quickjs-emscripten-core";
import baseVariant from "@jitl/quickjs-wasmfile-release-asyncify";
import wasmModule from "./quickjs.wasm";
import { BUDGET } from "./types";

let modulePromise: Promise<QuickJSAsyncWASMModule> | undefined;
function getModule(): Promise<QuickJSAsyncWASMModule> {
  modulePromise ??= newQuickJSAsyncWASMModuleFromVariant(newVariant(baseVariant, { wasmModule }));
  return modulePromise;
}

export type HostHttp = {
  get(url: string, headers?: Record<string, string>): Promise<{ status: number; body: string } | { error: string }>;
  post(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: string } | { error: string }>;
};

export type ExecResult = { ok: true; result: unknown; state: unknown } | { ok: false; error: string };

export async function execute(
  code: string,
  state: unknown,
  input: unknown,
  opts: { hostHttp?: HostHttp } = {},
): Promise<ExecResult> {
  const module = await getModule();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(BUDGET.MEMORY);
  runtime.setMaxStackSize(BUDGET.STACK);
  let cycles = 0;
  runtime.setInterruptHandler(() => ++cycles > BUDGET.OPS);

  const vm = await runtime.newContext();
  try {
    if (opts.hostHttp) attachHttp(vm, opts.hostHttp);
    const httpLiteral = opts.hostHttp
      ? `{
          get: (url, headers) => JSON.parse(__http("GET", url, JSON.stringify(headers ?? {}), "")),
          post: (url, body, headers) => JSON.parse(__http("POST", url, JSON.stringify(headers ?? {}), body === undefined || body === null ? "" : (typeof body === "string" ? body : JSON.stringify(body))))
        }`
      : `undefined`;
    // Honest capabilities the host (unlike the guest) genuinely has: a real clock
    // and CSPRNG. We do NOT expose Date/Math.random; we inject two controlled
    // functions. `now` is captured once at invocation; `random()` is a mulberry32
    // PRNG seeded per-invocation from crypto.getRandomValues so guests get fresh,
    // non-guessable randomness without an ambient source.
    const now = Date.now();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    const program = `
      const __now = ${now};
      let __rngState = ${seed} >>> 0;
      function __random() {
        __rngState = (__rngState + 0x6D2B79F5) | 0;
        let t = Math.imul(__rngState ^ (__rngState >>> 15), 1 | __rngState);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      }
      const ctx = {
        input: ${JSON.stringify(input ?? {})},
        state: ${JSON.stringify(state ?? {})},
        now: __now,
        random: __random,
        http: ${httpLiteral}
      };
      const __result = (function () { ${code}\n })();
      JSON.stringify({ result: __result === undefined ? null : __result, state: ctx.state });
    `;
    const evaluated = await vm.evalCodeAsync(program);
    if (evaluated.error) {
      const dumped = vm.dump(evaluated.error);
      evaluated.error.dispose();
      const message =
        dumped && typeof dumped === "object" && "message" in dumped
          ? `${(dumped as { name?: string }).name ?? "Error"}: ${(dumped as { message?: string }).message}`
          : String(dumped);
      return { ok: false, error: message };
    }
    const raw = vm.getString(evaluated.value);
    evaluated.value.dispose();
    const parsed = JSON.parse(raw);
    return { ok: true, result: parsed.result, state: parsed.state };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    vm.dispose();
    runtime.setMemoryLimit(-1);
    try {
      runtime.dispose();
    } catch (disposeErr) {
      // Asyncify teardown quirk (only triggered once an asyncified host function
      // like ctx.http has been registered): the asyncify build runs the module's
      // deleteRuntime callback BEFORE the final freeHostRef(rt, INT_MIN) that
      // QTS_FreeRuntime emits, so the library throws
      // "QuickJSRuntime(...) not found when trying to free HostRef". That ref is a
      // no-op sentinel and the underlying C free still completes — verified by
      // running hundreds of dispose cycles (each allocating multi-MB guest state)
      // with no WASM heap growth or OOM. Swallow only this specific benign error;
      // rethrow anything else so real disposal failures still surface.
      if (
        !(disposeErr instanceof Error) ||
        !disposeErr.message.includes("not found when trying to free HostRef")
      ) {
        throw disposeErr;
      }
    }
  }
}

// --- host http bridge ---
// The guest-side shim (httpLiteral above) marshals args to strings before crossing
// the asyncify boundary: a string body crosses verbatim (e.g. form-encoded OAuth
// posts), an object body is JSON-encoded first. Here we unmarshal and dispatch to
// the host-supplied HostHttp capability, then marshal its result back as JSON.
function attachHttp(vm: any, hostHttp: HostHttp) {
  const fn = vm.newAsyncifiedFunction("__http", async (mH: any, uH: any, hH: any, bH: any) => {
    const method = vm.getString(mH);
    const url = vm.getString(uH);
    const headers = JSON.parse(vm.getString(hH) || "{}");
    const bodyRaw = vm.getString(bH);
    const result =
      method === "POST"
        ? await hostHttp.post(url, bodyRaw === "" ? undefined : bodyRaw, headers)
        : await hostHttp.get(url, headers);
    return vm.newString(JSON.stringify(result));
  });
  vm.setProp(vm.global, "__http", fn);
  fn.dispose();
}
