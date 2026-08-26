import { describe, it, expect } from "vitest";
import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-wasmfile-release-asyncify";
// @ts-expect-error wasm module import
import wasmModule from "../src/quickjs.wasm";

describe("quickjs wasm", () => {
  it("loads and evaluates", async () => {
    const mod = await newQuickJSAsyncWASMModuleFromVariant(newVariant(variant, { wasmModule }));
    const vm = mod.newRuntime().newContext();
    const out = vm.unwrapResult(vm.evalCode("1 + 1"));
    expect(vm.getNumber(out)).toBe(2);
    out.dispose();
    vm.dispose();
  });
});
