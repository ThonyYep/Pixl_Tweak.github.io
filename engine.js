// engine.js — the pixel pipeline, with no DOM in it.
//
// Everything here runs unchanged in a worker and on the main thread, because
// it only ever touches OffscreenCanvas and createImageBitmap, both of which
// exist in both places. worker.js importScripts() this; index.html loads it
// too, so the fallback path costs nothing extra.

const ENGINE = (() => {

  // Canvas defaults to a 2x2 bilinear tap with no mipmaps at any scale, which
  // aliases badly on downscale. 'high' buys a 4x4 cubic in Chrome and a
  // scale-adaptive filter in Safari; Firefox ignores it, which is what
  // preShrink covers.
  function ctx2d(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    return ctx;
  }

  // OffscreenCanvas where it exists, a DOM canvas where it does not. Without
  // this the "inline fallback" was a lie: every call threw ReferenceError on
  // Safari below 16.4. If OffscreenCanvas is missing then so is the worker, so
  // this branch only ever runs on the main thread, where document exists.
  // Checked per call, not cached, so the fallback is reachable in a test.
  function makeCanvas(w, h) {
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(W, H);
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    return c;
  }

  // Past the browser's canvas cap there is no signal: the context comes back
  // as normal and every draw silently no-ops. Writing one pixel and reading it
  // back is the only way to find out before committing to a decode.
  function assertUsable(canvas) {
    const ctx = ctx2d(canvas);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(canvas.width - 1, canvas.height - 1, 1, 1);
    if (ctx.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data[0] !== 255) {
      throw new Error("CANVAS_TOO_LARGE:" + canvas.width + "×" + canvas.height);
    }
    return ctx;
  }

  // createImageBitmap arrived in Safari 15, OffscreenCanvas only in 16.4, so
  // there is a real window where one exists without the other. Both routes
  // apply EXIF orientation, so they produce the same pixels.
  function decodeToBitmap(blob) {
    if (typeof createImageBitmap === "function") return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
      img.src = url;
    });
  }

  async function decodeToCanvas(blob) {
    const bmp = await decodeToBitmap(blob);
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const canvas = makeCanvas(w, h);
    const ctx = assertUsable(canvas);
    ctx.drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    return canvas;
  }

  // Every file reaching the engine has real bytes, samples included.
  const sourceCanvas = file => decodeToCanvas(file.blob);

  function releaseCanvas(canvas) { canvas.width = 1; canvas.height = 1; }

  // Halve until one more halving would land under the requested size, then let
  // the caller do the last step. A factor of exactly 0.5 is where the 2x2
  // bilinear kernel becomes a correct box average, so chaining them builds a
  // mipmap chain by hand — the part of the fix that works in Firefox too.
  function preShrink(src, dw, dh) {
    let cur = src, cw = src.width, ch = src.height;
    while (cw >= dw * 2 && ch >= dh * 2 && cw > 1 && ch > 1) {
      const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1);
      const step = makeCanvas(nw, nh);
      ctx2d(step).drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
      if (cur !== src) releaseCanvas(cur);
      cur = step; cw = nw; ch = nh;
    }
    return cur;
  }

  function resizeContain(src, size) {
    const scale = Math.min(size / src.width, size / src.height);
    const dw = Math.round(src.width * scale), dh = Math.round(src.height * scale);
    const shrunk = preShrink(src, dw, dh);
    const canvas = makeCanvas(size, size);
    ctx2d(canvas).drawImage(shrunk, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
    if (shrunk !== src) releaseCanvas(shrunk);
    return canvas;
  }

  function resizeCanvas(src, targetW, targetH, fit) {
    // fit: 0=contain, 1=cover, 2=stretch
    const sw = src.width, sh = src.height;
    let dw, dh;
    if (fit === 2) { dw = targetW; dh = targetH; }
    else {
      const scale = fit === 1 ? Math.max(targetW / sw, targetH / sh)
                              : Math.min(targetW / sw, targetH / sh);
      dw = sw * scale; dh = sh * scale;
    }
    const shrunk = preShrink(src, dw, dh);
    const canvas = makeCanvas(targetW, targetH);
    // No background fill: only 'contain' leaves bars, and canvasToBlob already
    // flattens onto white for JPG or when transparency is turned off.
    ctx2d(canvas).drawImage(shrunk, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);
    if (shrunk !== src) releaseCanvas(shrunk);
    return canvas;
  }

  // Reduces bit depth per channel. Note this is not palette quantisation: a
  // setting of 64 allows 64 levels per channel, not 64 colours total.
  function posterizeCanvas(canvas, maxColors) {
    const levels = Math.ceil(Math.log2(Math.max(2, maxColors)));
    const step = 256 / (1 << levels);
    const out = makeCanvas(canvas.width, canvas.height);
    const ctx = ctx2d(out);
    ctx.drawImage(canvas, 0, 0);
    const id = ctx.getImageData(0, 0, out.width, out.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = Math.round(d[i]     / step) * step;
      d[i + 1] = Math.round(d[i + 1] / step) * step;
      d[i + 2] = Math.round(d[i + 2] / step) * step;
    }
    ctx.putImageData(id, 0, 0);
    return out;
  }

  function encodeBMP(canvas) {
    const w = canvas.width, h = canvas.height;
    const pixels = ctx2d(canvas).getImageData(0, 0, w, h).data;
    const pixelDataSize = w * h * 4;
    const fileSize = 54 + pixelDataSize;
    const buf = new ArrayBuffer(fileSize);
    const view = new DataView(buf);
    view.setUint16(0, 0x4D42, true);
    view.setUint32(2, fileSize, true);
    view.setUint32(6, 0, true);
    view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, w, true);
    view.setInt32(22, -h, true);   // negative = top-down
    view.setUint16(26, 1, true);
    view.setUint16(28, 32, true);
    view.setUint32(30, 0, true);
    view.setUint32(34, pixelDataSize, true);
    view.setInt32(38, 2835, true);
    view.setInt32(42, 2835, true);
    view.setUint32(46, 0, true);
    view.setUint32(50, 0, true);
    const u8 = new Uint8Array(buf);
    for (let i = 0, o = 54; i < pixels.length; i += 4, o += 4) {
      u8[o] = pixels[i + 2]; u8[o + 1] = pixels[i + 1];
      u8[o + 2] = pixels[i]; u8[o + 3] = pixels[i + 3];
    }
    return new Blob([buf], { type: "image/bmp" });
  }

  async function encodeICO(sizedPngBlobs) {
    // An ICO with no entries is a 6-byte file every viewer rejects. Refusing
    // turns that into a reported error instead of a corrupt download.
    if (!sizedPngBlobs || sizedPngBlobs.length === 0) {
      throw new Error("ICO needs at least one size of 256px or smaller");
    }
    const entries = await Promise.all(sizedPngBlobs.map(async ({ size, blob }) => ({
      size, data: new Uint8Array(await blob.arrayBuffer()),
    })));
    const n = entries.length;
    const headerSize = 6 + n * 16;
    const offsets = [];
    let pos = headerSize;
    for (const e of entries) { offsets.push(pos); pos += e.data.byteLength; }
    const buf = new ArrayBuffer(pos);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    view.setUint16(0, 0, true);
    view.setUint16(2, 1, true);
    view.setUint16(4, n, true);
    for (let i = 0; i < n; i++) {
      const { size, data } = entries[i];
      const b = 6 + i * 16;
      const s = size >= 256 ? 0 : size;   // 0 means 256 in the ICO spec
      view.setUint8(b, s); view.setUint8(b + 1, s);
      view.setUint8(b + 2, 0); view.setUint8(b + 3, 0);
      view.setUint16(b + 4, 1, true);
      view.setUint16(b + 6, 32, true);
      view.setUint32(b + 8, data.byteLength, true);
      view.setUint32(b + 12, offsets[i], true);
      u8.set(data, offsets[i]);
    }
    return new Blob([buf], { type: "image/x-icon" });
  }

  // ── Optional WASM encoders ───────────────────────────────────────────────
  // MozJPEG and OxiPNG, ~460 KB of wasm between them, so they load on first
  // use and never for runs that don't ask. Relative to self.location so the
  // same specifier resolves from the page and from inside the worker.
  const codecs = {};
  function loadCodec(name, path) {
    if (!codecs[name]) {
      codecs[name] = import(new URL(path, self.location.href).href).then(m => m.default);
    }
    return codecs[name];
  }
  const MAX_COMPRESS_FORMATS = new Set(["JPG", "PNG"]);

  async function encodeMax(canvas, format, quality) {
    const id = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
    if (format === "JPG") {
      const encode = await loadCodec("mozjpeg", "vendor/jpeg/encode.js");
      // Progressive and the MSSIM-tuned quantisation table are jSquash's own
      // defaults; the browser encoder can produce neither.
      return new Blob([await encode(id, { quality: quality == null ? 82 : quality })],
                      { type: "image/jpeg" });
    }
    const optimise = await loadCodec("oxipng", "vendor/oxipng.js");
    return new Blob([await optimise(id)], { type: "image/png" });
  }

  async function canvasToBlob(canvas, format, quality, transparent, maxCompress) {
    const q = (quality == null ? 82 : quality) / 100;
    if (format === "BMP") return encodeBMP(canvas);
    // JPG has no alpha channel at all; the others flatten only if asked.
    const noAlpha = format === "JPG" || transparent === false;
    let src = canvas;
    if (noAlpha) {
      const flat = makeCanvas(canvas.width, canvas.height);
      const ctx = ctx2d(flat);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
      src = flat;
    }
    if (maxCompress && MAX_COMPRESS_FORMATS.has(format)) {
      const out = await encodeMax(src, format, quality);
      if (src !== canvas) releaseCanvas(src);
      return out;
    }
    const mimeMap = {
      PNG:  ["image/png",  1.0],
      JPG:  ["image/jpeg", q],
      // Exactly 1.0 flips WebP to LOSSLESS at libwebp method 0 in Chrome and
      // Firefox — the fastest, worst-compressing mode. The top of a lossy
      // slider should not change modes, so stop just short of the cliff.
      WEBP: ["image/webp", Math.min(q, 0.99)],
    };
    // Falling back to PNG for an unknown format is how ".avif" files ended up
    // holding PNG bytes in the first place. Refuse instead.
    if (!mimeMap[format]) throw new Error("UNSUPPORTED_OUTPUT:" + format);
    const [mime, qVal] = mimeMap[format];
    const tooLarge = () => new Error("CANVAS_TOO_LARGE:" + src.width + "×" + src.height);
    let blob;
    try {
      // OffscreenCanvas on both sides; toBlob is the fallback for a plain
      // <canvas> handed in by a caller that made its own.
      blob = src.convertToBlob
        ? await src.convertToBlob({ type: mime, quality: qVal })
        : await new Promise(r => src.toBlob(r, mime, qVal));
    } catch (e) {
      // convertToBlob rejects instead of returning null when the surface is
      // unusable, which is the past-the-cap case.
      throw tooLarge();
    }
    // Two different failures: a missing blob means the canvas is past the
    // size cap, a blob of the wrong type means the browser cannot encode this
    // format and quietly substituted PNG. Neither throws on its own.
    if (!blob) throw tooLarge();
    if (blob.type !== mime) throw new Error("UNSUPPORTED_OUTPUT:" + format);
    if (src !== canvas) releaseCanvas(src);
    return blob;
  }

  // Find the highest quality whose output still fits a byte budget. There is
  // nothing to model: what a quality setting costs depends on the image, so
  // the only way to know is to encode and look. Binary search settles it in
  // about seven encodes. met:false means even quality 10 overshot.
  async function encodeToTargetSize(canvas, format, targetBytes, transparent, onStep, maxCompress) {
    let lo = 10, hi = 100, best = null, steps = 0;
    while (lo <= hi) {
      const q = Math.round((lo + hi) / 2);
      const blob = await canvasToBlob(canvas, format, q, transparent, maxCompress);
      steps++;
      if (onStep) onStep(steps, q, blob.size);
      if (blob.size <= targetBytes) { best = { blob, quality: q }; lo = q + 1; }
      else { hi = q - 1; }
    }
    if (best) return { ...best, steps, met: true };
    const blob = await canvasToBlob(canvas, format, 10, transparent, maxCompress);
    return { blob, quality: 10, steps: steps + 1, met: false };
  }

  function cropRotate(src, crop, rotation, flipH, flipV) {
    const sw = src.width, sh = src.height;
    const radians = rotation * Math.PI / 180;
    const sinA = Math.abs(Math.sin(radians)), cosA = Math.abs(Math.cos(radians));
    const rw = Math.round(sw * cosA + sh * sinA);
    const rh = Math.round(sw * sinA + sh * cosA);
    const rot = makeCanvas(rw, rh);
    const rctx = ctx2d(rot);
    rctx.translate(rw / 2, rh / 2);
    rctx.rotate(radians);
    rctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    rctx.drawImage(src, -sw / 2, -sh / 2);
    // The crop rectangle is a percentage of the ROTATED image, matching what
    // the overlay draws on, and clamped so an out-of-range rect crops short
    // instead of padding the result with transparent pixels.
    const cx = Math.min(Math.max(0, crop.x / 100 * rw), rw);
    const cy = Math.min(Math.max(0, crop.y / 100 * rh), rh);
    const cw = Math.max(1, Math.min(rw - cx, crop.w / 100 * rw));
    const ch = Math.max(1, Math.min(rh - cy, crop.h / 100 * rh));
    const out = makeCanvas(Math.round(cw), Math.round(ch));
    ctx2d(out).drawImage(rot, cx, cy, cw, ch, 0, 0, out.width, out.height);
    releaseCanvas(rot);
    return out;
  }

  const EXT = { JPG:"jpg", PNG:"png", WEBP:"webp", BMP:"bmp", PDF:"pdf", ICO:"ico" };
  const outputName = (name, format) =>
    name.replace(/\.[^/.]+$/, "") + "." + (EXT[format] || format.toLowerCase());
  const baseName = name => name.replace(/\.[^/.]+$/, "");

  // ── One file, one operation, a list of { path, blob } out ────────────────
  // PDF is the exception: jsPDF needs the DOM, so this hands back a JPEG and
  // the caller assembles the document.
  async function runOne(file, op, s, onStep) {
    const src = await sourceCanvas(file);
    let outputs = [], quality = s.quality, met = true;

    if (op === "convert" && s.format === "ICO") {
      const sizes = (s.icoSizes && s.icoSizes.length ? s.icoSizes : [16, 32, 48, 256])
        .filter(v => v <= 256);
      const sized = [];
      for (let i = 0; i < sizes.length; i++) {
        const c = resizeContain(src, sizes[i]);
        const png = await canvasToBlob(c, "PNG", 100, true);
        releaseCanvas(c);
        sized.push({ size: sizes[i], blob: png });
        outputs.push({ path: `${baseName(file.name)}/${sizes[i]}x${sizes[i]}/${baseName(file.name)}.png`, blob: png });
        onStep((i + 1) / sizes.length * 0.8);
      }
      if (s.icoKeepOriginal) {
        outputs.push({ path: `${baseName(file.name)}/original/${baseName(file.name)}.png`,
                       blob: await canvasToBlob(src, "PNG", 100, true) });
      }
      outputs.push({ path: `${baseName(file.name)}/${baseName(file.name)}.ico`, blob: await encodeICO(sized) });

    } else if (op === "convert" && s.format === "PDF") {
      outputs.push({ path: outputName(file.name, "PDF"), pdfSource: true,
                     blob: await canvasToBlob(src, "JPG", 92, false) });

    } else if (op === "convert") {
      outputs.push({ path: outputName(file.name, s.format),
                     blob: await canvasToBlob(src, s.format, s.quality, s.transparent !== false, s.maxCompress) });

    } else if (op === "resize") {
      let tw = s.w, th = s.h;
      if (!s.upscale) { tw = Math.min(s.w, src.width); th = Math.min(s.h, src.height); }
      const c = resizeCanvas(src, tw, th, s.fit || 0);
      outputs.push({ path: baseName(file.name) + "_resized." + (EXT[s.format] || "webp"),
                     blob: await canvasToBlob(c, s.format, 90, s.transparent) });
      releaseCanvas(c);

    } else if (op === "compress") {
      let c = src;
      if (s.format === "PNG" && s.reduceColors && s.maxColors) c = posterizeCanvas(src, s.maxColors);
      let blob;
      if (s.targetBytes > 0) {
        const r = await encodeToTargetSize(c, s.format, s.targetBytes, true,
          n => onStep(Math.min(0.9, n / 8)), s.maxCompress);
        blob = r.blob; quality = r.quality; met = r.met;
      } else {
        blob = await canvasToBlob(c, s.format, s.quality, true, s.maxCompress);
      }
      if (c !== src) releaseCanvas(c);
      outputs.push({ path: baseName(file.name) + "_compressed." + s.format.toLowerCase(), blob });

    } else if (op === "crop") {
      const c = cropRotate(src, s.crop, s.rotation, s.flipH, s.flipV);
      outputs.push({ path: baseName(file.name) + "_cropped.png",
                     blob: await canvasToBlob(c, "PNG", 100, true) });
      releaseCanvas(c);
    }

    releaseCanvas(src);
    const bytes = outputs.reduce((a, o) => a + o.blob.size, 0);
    return { outputs, bytes, quality, met };
  }

  return { ctx2d, makeCanvas, decodeToCanvas, sourceCanvas, releaseCanvas,
           preShrink, resizeContain, resizeCanvas, posterizeCanvas, encodeBMP, encodeICO,
           canvasToBlob, encodeToTargetSize, cropRotate, outputName, runOne,
           MAX_COMPRESS_FORMATS };
})();

if (typeof self !== "undefined" && !self.document) self.ENGINE = ENGINE;
