declare module "*.wasm" {
  const mod: WebAssembly.Module;
  export default mod;
}

// src/runtime-source.txt is a build-time copy of face/runtime.js, imported as
// text (see the Text rule in wrangler.jsonc) so the Worker can serve the same
// source the face-runtime tests import as a module.
declare module "*.txt" {
  const source: string;
  export default source;
}
