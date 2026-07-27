// Thin wrapper over the single-threaded OxiPNG codec.
//
// @jsquash/oxipng ships its own optimise.js, but that one imports the bare
// specifier "wasm-feature-detect" to decide whether to use the multi-threaded
// build. Threads need SharedArrayBuffer, which needs COOP/COEP headers that
// GitHub Pages does not send, so that branch could never be taken here — and
// the bare import would not resolve in a browser anyway. This talks to the
// single-threaded codec directly instead.

import init, { optimise_raw } from "./oxipng/squoosh_oxipng.js";

let ready;

// level 2 is OxiPNG's own default: most of the win, seconds rather than
// minutes. Higher levels chase single-digit percentages.
export default async function optimise(imageData, level = 2) {
  if (!ready) ready = init();
  await ready;
  return optimise_raw(imageData.data, imageData.width, imageData.height, level, false, true).buffer;
}
