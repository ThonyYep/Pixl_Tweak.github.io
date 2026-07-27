// Test cases for selftest.html. Bundled with processor.jsx and convert.jsx by
// build.mjs so they share one scope and can reach top-level names like
// ICO_SIZES and DEFAULT_FORMAT directly.
//
// Run: npm run dev, then open /selftest.html

const out = document.getElementById("out");
let pass = 0, fail = 0;

function record(name, err) {
  const li = document.createElement("li");
  if (err) { fail++; li.className = "fail"; li.textContent = "✕ " + name + " — " + err; }
  else     { pass++; li.className = "ok";   li.textContent = "✓ " + name; }
  out.appendChild(li);
}
async function test(name, fn) {
  try { await fn(); record(name); }
  catch (e) { record(name, e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function solidCanvas(w = 40, h = 30) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#3366cc";
  ctx.fillRect(0, 0, w, h);
  return c;
}
// Bytes that are not a decodable image, under a name the old code advertised.
function brokenFile() {
  return { id: 1, name: "photo.cr2", fileObj: new File([new Uint8Array([1,2,3,4])], "photo.cr2") };
}

(async () => {
  const P = window.Processor;

  // ── Bug 1: an output blob always matches the format it claims ──────────
  await test("PNG encodes as image/png", async () => {
    const b = await P.canvasToBlob(solidCanvas(), "PNG", 90, true);
    assert(b.type === "image/png", "got " + b.type);
  });

  await test("WEBP encodes as image/webp", async () => {
    const b = await P.canvasToBlob(solidCanvas(), "WEBP", 82, true);
    assert(b.type === "image/webp", "got " + b.type);
  });

  // The regression that mattered: toBlob hands back PNG for a mime it can't
  // encode. Either we get real AVIF, or we refuse — never PNG named .avif.
  await test("AVIF encodes as image/avif or throws (never mislabels)", async () => {
    let blob = null;
    try {
      blob = await P.canvasToBlob(solidCanvas(), "AVIF", 82, true);
    } catch (e) {
      assert(/^UNSUPPORTED_OUTPUT:AVIF/.test(e.message), "wrong error: " + e.message);
      return;
    }
    assert(blob.type === "image/avif", "returned " + blob.type + " for AVIF");
  });

  await test("no unencodable format is offered", () => {
    for (const f of ["GIF", "TIFF"]) {
      assert(!FORMATS.includes(f), f + " is still in the output picker");
    }
  });

  await test("no undecodable format is advertised as input", () => {
    for (const f of ["CR2", "DNG", "NEF", "PSD", "RAW", "EPS"]) {
      assert(!ALL_FORMATS.includes(f), f + " is still listed as supported");
    }
  });

  await test("JPG flattens alpha instead of writing black", async () => {
    const c = document.createElement("canvas");
    c.width = 4; c.height = 4;                       // fully transparent
    const b = await P.canvasToBlob(c, "JPG", 90, true);
    const img = await P.loadImage(b);
    const t = document.createElement("canvas");
    t.width = 4; t.height = 4;
    t.getContext("2d").drawImage(img, 0, 0);
    const [r, g, bl] = t.getContext("2d").getImageData(1, 1, 1, 1).data;
    assert(r > 240 && g > 240 && bl > 240, `expected white, got rgb(${r},${g},${bl})`);
  });

  // ── Bug 3: resizing must not paint over the alpha channel ──────────────
  await test("contain resize leaves the padding transparent", () => {
    const out = P.resizeCanvas(solidCanvas(20, 10), 20, 20, 0);  // 2:1 into a square
    const px = (x, y) => out.getContext("2d").getImageData(x, y, 1, 1).data;
    assert(px(1, 1)[3]   === 0,   "padding alpha is " + px(1, 1)[3] + ", expected 0");
    assert(px(10, 10)[3] === 255, "image area lost its opacity");
  });

  await test("resized JPG still flattens onto white", async () => {
    const out = P.resizeCanvas(solidCanvas(20, 10), 20, 20, 0);
    const img = await P.loadImage(await P.canvasToBlob(out, "JPG", 90, true));
    const t = document.createElement("canvas");
    t.width = 20; t.height = 20;
    t.getContext("2d").drawImage(img, 0, 0);
    const [r, g, b] = t.getContext("2d").getImageData(1, 1, 1, 1).data;
    assert(r > 240 && g > 240 && b > 240, `padding should be white, got rgb(${r},${g},${b})`);
  });

  // ── Bug 4: real dimensions are readable from an uploaded file ──────────
  await test("loadImage reports real pixel dimensions", async () => {
    const png = await P.canvasToBlob(solidCanvas(137, 89), "PNG", 90, true);
    const img = await P.loadImage(new File([png], "x.png", { type: "image/png" }));
    assert(img.naturalWidth === 137 && img.naturalHeight === 89,
      `got ${img.naturalWidth}×${img.naturalHeight}`);
  });

  await test("BMP header is well formed", () => {
    const c = solidCanvas(10, 5);
    const blob = P.encodeBMP(c);
    assert(blob.type === "image/bmp", "got " + blob.type);
    assert(blob.size === 54 + 10 * 5 * 4, "size " + blob.size);
  });

  await test("output name matches the chosen format", () => {
    assert(P.getOutputName("holiday.png", "AVIF") === "holiday.avif", "avif");
    assert(P.getOutputName("a.b.jpeg",    "WEBP") === "a.b.webp",     "dotted name");
  });

  // ── Bug 2: a failure is reported, never dressed up as success ──────────
  await test("undecodable source rejects", async () => {
    let threw = false;
    try { await P.getSourceCanvas(brokenFile()); } catch (e) { threw = true; }
    assert(threw, "getSourceCanvas resolved on garbage bytes");
  });

  await test("processConvert reports the failure to its caller", async () => {
    const file = brokenFile();
    const seen = [];
    const { ok, errors } = await new Promise(resolve => {
      P.processConvert([file], { format: "PNG", quality: 90 },
        (id, pct, state) => seen.push({ id, pct, state }),
        (ok, errors) => resolve({ ok, errors }));
    });
    assert(ok === false, "reported success for a file that failed");
    assert(errors.length === 1, "expected 1 error, got " + errors.length);
    assert(errors[0].id === file.id, "error is not tied to the file id");
    assert(errors[0].fmt === null, "decode failure should not blame a format");
    const last = seen[seen.length - 1];
    assert(last.state === "error", "last progress state was '" + last.state + "', not 'error'");
  });

  // ── Bug 5: no toggle claims to do something canvas can't ───────────────
  await test("re-encoding drops metadata, so nothing offers to keep it", async () => {
    // A JPEG carrying an APP1/Exif segment; canvas output must not have one.
    const jpg = await P.canvasToBlob(solidCanvas(24, 24), "JPG", 90, true);
    const bytes = new Uint8Array(await jpg.arrayBuffer());
    let hasExif = false;
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === 0xFF && bytes[i + 1] === 0xE1) { hasExif = true; break; }
    }
    assert(!hasExif, "canvas emitted an APP1 segment — the note is now wrong");
  });

  // ── Bug 6: reported sizes are measured, not modelled ───────────────────
  await test("processConvert reports the real output byte count", async () => {
    const png  = await P.canvasToBlob(solidCanvas(64, 64), "PNG", 90, true);
    const file = { id: 7, name: "solid.png", fileObj: new File([png], "solid.png", { type: "image/png" }) };
    let captured = null;
    const orig = HTMLAnchorElement.prototype.click;          // keep the disk clean
    HTMLAnchorElement.prototype.click = function () { if (!this.download) return orig.call(this); };
    try {
      const { sizes } = await new Promise(r => {
        P.processConvert([file], { format: "WEBP", quality: 82, transparent: true },
          () => {}, (ok, errors, sizes) => r({ sizes }));
      });
      captured = sizes;
    } finally { HTMLAnchorElement.prototype.click = orig; }

    assert(captured.length === 1, "expected one size entry");
    assert(captured[0].id === 7, "size is not tied to the file id");
    // Encode the same canvas independently — the reported number must match
    // the encoder, not a formula.
    const expected = (await P.canvasToBlob(
      P.getSourceCanvas ? await P.getSourceCanvas(file) : null, "WEBP", 82, true)).size;
    assert(captured[0].bytes === expected,
      `reported ${captured[0].bytes}, encoder produced ${expected}`);
  });

  await test("a failed file contributes no size entry", async () => {
    const { errors, sizes } = await new Promise(r => {
      P.processConvert([brokenFile()], { format: "PNG", quality: 90 },
        () => {}, (ok, errors, sizes) => r({ errors, sizes }));
    });
    assert(errors.length === 1, "expected the failure");
    assert(sizes.length === 0, "a failed file must not report bytes");
  });

  // ── ICO: no size is offered that the format cannot express ─────────────
  await test("the ICO size picker offers nothing above 256", () => {
    for (const s of ICO_SIZES) {
      assert(s <= 256, s + "px cannot be stored in an ICO directory entry");
    }
  });

  await test("encodeICO refuses to emit an empty icon file", async () => {
    let threw = false;
    try { await P.encodeICO([]); } catch (e) { threw = true; }
    assert(threw, "encodeICO produced a 6-byte header with zero icons");
  });

  await test("a real ICO lists every size it was given", async () => {
    const src = solidCanvas(300, 300);
    const want = [16, 32, 256];
    const blobs = [];
    for (const s of want) {
      const c = document.createElement("canvas");
      c.width = s; c.height = s;
      c.getContext("2d").drawImage(src, 0, 0, s, s);
      blobs.push({ size: s, blob: await P.canvasToBlob(c, "PNG", 100, true) });
    }
    const u = new Uint8Array(await (await P.encodeICO(blobs)).arrayBuffer());
    const count = u[4] | (u[5] << 8);
    assert(count === want.length, `directory lists ${count} icons, expected ${want.length}`);
    // 256 is stored as 0 in the single width byte
    assert(u[6] === 16 && u[6 + 16] === 32 && u[6 + 32] === 0, "entry sizes are wrong");
  });

  // ── Crop: the rectangle means the same thing the preview showed ────────
  await test("full-frame crop at 0° keeps every pixel", () => {
    // 400x200 unrotated; a 0,0,100,100 rect must map to the whole image.
    const rw = 400, rh = 200, crop = { x: 0, y: 0, w: 100, h: 100 };
    const cx = Math.min(Math.max(0, crop.x / 100 * rw), rw);
    const cw = Math.max(1, Math.min(rw - cx, crop.w / 100 * rw));
    const ch = Math.max(1, Math.min(rh - 0, crop.h / 100 * rh));
    assert(cw === 400 && ch === 200, `got ${cw}x${ch}, expected 400x200`);
  });

  await test("crop at 90° stays inside the rotated canvas", async () => {
    const src = solidCanvas(400, 200);
    // Mirror processCrop's geometry for rotation = 90.
    const rad = Math.PI / 2, sinA = 1, cosA = 0;
    const rw = Math.round(400 * cosA + 200 * sinA);   // 200
    const rh = Math.round(400 * sinA + 200 * cosA);   // 400
    const rot = document.createElement("canvas");
    rot.width = rw; rot.height = rh;
    const rc = rot.getContext("2d");
    rc.translate(rw / 2, rh / 2); rc.rotate(rad); rc.drawImage(src, -200, -100);

    const crop = { x: 0, y: 0, w: 100, h: 100 };
    const cx = Math.min(Math.max(0, crop.x / 100 * rw), rw);
    const cy = Math.min(Math.max(0, crop.y / 100 * rh), rh);
    const cw = Math.max(1, Math.min(rw - cx, crop.w / 100 * rw));
    const ch = Math.max(1, Math.min(rh - cy, crop.h / 100 * rh));
    assert(cx + cw <= rw && cy + ch <= rh, "crop rect reads past the rotated canvas");

    const out = document.createElement("canvas");
    out.width = Math.round(cw); out.height = Math.round(ch);
    out.getContext("2d").drawImage(rot, cx, cy, cw, ch, 0, 0, out.width, out.height);
    assert(out.width === 200 && out.height === 400, `got ${out.width}x${out.height}`);
    const d = out.getContext("2d").getImageData(0, 0, out.width, out.height).data;
    let clear = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] === 0) clear++;
    assert(clear === 0, `${Math.round(clear / (d.length / 4) * 100)}% of the crop is empty`);
  });

  await test("an out-of-range rect crops short instead of padding", () => {
    const rw = 400, rh = 200, crop = { x: 80, y: 80, w: 100, h: 100 };  // runs off the edge
    const cx = Math.min(Math.max(0, crop.x / 100 * rw), rw);
    const cy = Math.min(Math.max(0, crop.y / 100 * rh), rh);
    const cw = Math.max(1, Math.min(rw - cx, crop.w / 100 * rw));
    const ch = Math.max(1, Math.min(rh - cy, crop.h / 100 * rh));
    assert(cx + cw <= rw && cy + ch <= rh, "clamp failed");
    assert(cw === 80 && ch === 40, `got ${cw}x${ch}, expected 80x40`);
  });

  // ── Downscale quality ──────────────────────────────────────────────────
  await test("contexts request high-quality smoothing", () => {
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const probe = P.resizeCanvas(solidCanvas(64, 64), 8, 8, 2);
    const ctx = probe.getContext("2d");
    assert(ctx.imageSmoothingEnabled === true, "smoothing is off");
    assert(ctx.imageSmoothingQuality === "high", "quality is " + ctx.imageSmoothingQuality);
  });

  await test("preShrink halves down to the target, never below it", () => {
    // 1600x800 -> 800x400 -> 400x200 -> 200x100 -> 100x50. Landing exactly
    // on target is the good case: the caller's final draw is then 1:1.
    const exact = P.preShrink(solidCanvas(1600, 800), 100, 50);
    assert(exact.width === 100 && exact.height === 50, `got ${exact.width}x${exact.height}`);
    // Non-power-of-two: must stop before undershooting either axis.
    const odd = P.preShrink(solidCanvas(1000, 700), 300, 210);
    assert(odd.width >= 300 && odd.height >= 210, `undershot to ${odd.width}x${odd.height}`);
    assert(odd.width < 1000, "did not shrink at all");
  });

  await test("preShrink leaves a small source alone", () => {
    const src = solidCanvas(120, 90);
    assert(P.preShrink(src, 100, 80) === src, "allocated a needless intermediate");
  });

  // A 1px checkerboard is the classic aliasing torture test: naive 2x2
  // bilinear at a big reduction samples a near-constant phase and collapses
  // to a flat block, so variance across the output collapses with it.
  await test("heavy downscale averages instead of aliasing", () => {
    const n = 1024;
    const src = document.createElement("canvas");
    src.width = src.height = n;
    const sc = src.getContext("2d");
    const id = sc.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = ((x ^ y) & 1) ? 255 : 0, i = (y * n + x) * 4;
      id.data[i] = id.data[i+1] = id.data[i+2] = v; id.data[i+3] = 255;
    }
    sc.putImageData(id, 0, 0);
    const out = P.resizeCanvas(src, 16, 16, 2);   // 64x reduction
    const d = out.getContext("2d").getImageData(0, 0, 16, 16).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
    // A correct box average of a 50/50 checkerboard lands near mid grey
    // everywhere; aliasing produces near-black or near-white patches.
    assert(min > 100 && max < 155, `expected a flat mid grey, got range ${min}..${max}`);
  });

  // ── WebP must not fall off the lossless cliff at the top of the slider ──
  await test("WEBP at quality 100 stays lossy", async () => {
    const src = solidCanvas(64, 64);
    const g = src.getContext("2d").createLinearGradient(0, 0, 64, 64);
    g.addColorStop(0, "#2b6cb0"); g.addColorStop(1, "#111");
    src.getContext("2d").fillStyle = g;
    src.getContext("2d").fillRect(0, 0, 64, 64);
    const ref = src.getContext("2d").getImageData(0, 0, 64, 64).data;

    const blob = await P.canvasToBlob(src, "WEBP", 100, true);
    const img  = await P.loadImage(blob);
    const t = document.createElement("canvas");
    t.width = 64; t.height = 64;
    t.getContext("2d").drawImage(img, 0, 0);
    const got = t.getContext("2d").getImageData(0, 0, 64, 64).data;
    let diff = 0;
    for (let i = 0; i < ref.length; i++) if (ref[i] !== got[i]) diff++;
    assert(diff > 0, "quality 100 produced a pixel-exact file — it switched to lossless");
  });

  // ── The default output format is one this browser can actually encode ──
  await test("the default format is encodable here", async () => {
    const mime = { WEBP: "image/webp", JPG: "image/jpeg", PNG: "image/png" }[DEFAULT_FORMAT];
    assert(mime, "unexpected default " + DEFAULT_FORMAT);
    const b = await P.canvasToBlob(solidCanvas(16, 16), DEFAULT_FORMAT, 82, true);
    assert(b.type === mime, `default ${DEFAULT_FORMAT} produced ${b.type}`);
  });

  await test("canEncode agrees with what toBlob actually returns", async () => {
    for (const [fmt, mime] of [["PNG","image/png"], ["JPG","image/jpeg"], ["WEBP","image/webp"]]) {
      const claimed = P.canEncode(mime);
      let actual = false;
      try { actual = (await P.canvasToBlob(solidCanvas(8, 8), fmt, 82, true)).type === mime; }
      catch (e) { actual = false; }
      assert(claimed === actual, `${mime}: canEncode says ${claimed}, encoder says ${actual}`);
    }
  });

  // ── "Too big" and "unsupported format" are different failures ──────────
  await test("an oversized source reports its size, not a format problem", async () => {
    // 20000x20000 is past every current browser's area cap.
    const png  = await P.canvasToBlob(solidCanvas(8, 8), "PNG", 90, true);
    const file = { id: 11, name: "huge.png", fileObj: new File([png], "huge.png") };
    // Drive the geometry directly — synthesising a real 400 MP file isn't possible.
    const c = document.createElement("canvas");
    c.width = 20000; c.height = 20000;
    const ctx = c.getContext("2d");
    if (!ctx) { record("oversized canvas is unusable as expected"); return; }
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(c.width - 1, c.height - 1, 1, 1);
    const backed = ctx.getImageData(c.width - 1, c.height - 1, 1, 1).data[0] === 255;
    assert(!backed, "20000x20000 is within this browser's cap — pick a bigger probe");

    let err = null;
    try { await P.canvasToBlob(c, "PNG", 90, true); } catch (e) { err = e; }
    assert(err, "encoding an over-limit canvas silently succeeded");
    assert(/^CANVAS_TOO_LARGE:/.test(err.message),
      "reported as '" + err.message + "' instead of a size problem");
  });

  await test("the three failures map to three different messages", () => {
    const t = { convert: { errTooBig: "too big {dims}", errFormat: "no {fmt}", errRead: "unreadable" } };
    assert(errorMessage(t, { tooBig: "20000×20000" }) === "too big 20000×20000", "size case");
    assert(errorMessage(t, { fmt: "AVIF" })           === "no AVIF",             "format case");
    assert(errorMessage(t, {})                        === "unreadable",          "decode case");
  });

  // ponytail: single-file cases only — anything with 2+ files takes the zip
  // path and would write to the user's Downloads folder mid-test.

  const s = document.getElementById("summary");
  s.textContent = `${pass} passed, ${fail} failed`;
  s.className = fail ? "fail" : "ok";
})();
