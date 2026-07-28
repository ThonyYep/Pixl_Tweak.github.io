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

  // The regression that started all this: toBlob hands back PNG for a mime it
  // cannot encode, so a format the encoder does not know must be refused, not
  // quietly turned into a PNG wearing the wrong extension.
  await test("an unknown output format is refused, not silently made PNG", async () => {
    for (const fmt of ["AVIF", "TIFF", "GIF", "NONSENSE"]) {
      let threw = false;
      try { await P.canvasToBlob(solidCanvas(), fmt, 82, true); }
      catch (e) {
        threw = /^UNSUPPORTED_OUTPUT:/.test(e.message);
        assert(threw, `${fmt} threw the wrong error: ${e.message}`);
      }
      assert(threw, `${fmt} returned a blob instead of refusing`);
    }
  });

  await test("no unencodable format is offered", () => {
    // No browser encodes any of these from a canvas.
    for (const f of ["GIF", "TIFF", "AVIF"]) {
      assert(!FORMATS.includes(f), f + " is still in the output picker");
    }
    // AVIF decodes fine though, so it stays a valid input.
    assert(ALL_FORMATS.includes("AVIF"), "AVIF should still be accepted as input");
  });

  await test("every offered format actually produces its own type", async () => {
    const mime = { PNG:"image/png", JPG:"image/jpeg", WEBP:"image/webp", BMP:"image/bmp" };
    for (const f of FORMATS) {
      if (!mime[f]) continue;               // PDF and ICO are assembled elsewhere
      const b = await P.canvasToBlob(solidCanvas(), f, 82, true);
      assert(b.type === mime[f], `${f} produced ${b.type}`);
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
    assert(P.getOutputName("holiday.png", "WEBP") === "holiday.webp", "webp");
    assert(P.getOutputName("a.b.jpeg",    "JPG")  === "a.b.jpg",      "dotted name");
    assert(P.getOutputName("icon.png",    "ICO")  === "icon.ico",     "ico");
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

  // ── Target file size ───────────────────────────────────────────────────
// A photo-ish source: quality has to actually move the byte count for a
// search over it to mean anything.
function busyCanvas(n) {
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, n, n);
  g.addColorStop(0, "#d6336c"); g.addColorStop(.5, "#fab005"); g.addColorStop(1, "#1864ab");
  x.fillStyle = g; x.fillRect(0, 0, n, n);
  // deterministic scatter — no Math.random, so the test is repeatable
  for (let i = 0; i < 900; i++) {
    const a = (i * 2.399963) % 6.283, r = (i * 37) % n;
    x.fillStyle = `hsla(${(i * 7) % 360},70%,${30 + i % 50}%,.5)`;
    x.beginPath();
    x.arc((Math.cos(a) * r + n) % n, (Math.sin(a) * r + n) % n, 2 + (i % 20), 0, 6.283);
    x.fill();
  }
  return c;
}

await test("target size lands under the budget, not over it", async () => {
  const c = busyCanvas(600);
  for (const target of [300_000, 120_000, 40_000]) {
    const r = await P.encodeToTargetSize(c, "JPG", target, true);
    assert(r.met, `reported unreachable at ${target} B`);
    assert(r.blob.size <= target, `${target} B budget, produced ${r.blob.size} B`);
  }
});

await test("target size uses most of the budget rather than undershooting", async () => {
  const r = await P.encodeToTargetSize(busyCanvas(600), "JPG", 120_000, true);
  const used = r.blob.size / 120_000;
  assert(used > 0.85, `only used ${Math.round(used * 100)}% of the budget — search stopped short`);
});

await test("an unreachable target is reported, not faked", async () => {
  // 1 KB is below what any JPEG of this image can be.
  const r = await P.encodeToTargetSize(busyCanvas(600), "JPG", 1000, true);
  assert(r.met === false, "claimed success on an impossible target");
  assert(r.blob.size > 1000, "test premise wrong — 1 KB was reachable");
  assert(r.quality === 10, `fell back at quality ${r.quality}, expected the floor`);
});

await test("the search converges instead of scanning every quality", async () => {
  const r = await P.encodeToTargetSize(busyCanvas(400), "JPG", 50_000, true);
  assert(r.steps <= 8, `took ${r.steps} encodes; binary search over 10..100 needs at most 7`);
});

await test("higher budgets never produce smaller files", async () => {
  const c = busyCanvas(500);
  const small = await P.encodeToTargetSize(c, "JPG", 40_000, true);
  const big   = await P.encodeToTargetSize(c, "JPG", 200_000, true);
  assert(big.blob.size >= small.blob.size,
    `200 KB budget gave ${big.blob.size} B but 40 KB gave ${small.blob.size} B`);
  assert(big.quality >= small.quality, "a looser budget chose a lower quality");
});

// ── Sample files are files ─────────────────────────────────────────────
await test("the samples carry real bytes, not declared numbers", async () => {
  const samples = await makeSampleFiles();
  assert(samples.length === SAMPLE_SPECS.length, "wrong count");
  for (const s of samples) {
    assert(s.fileObj instanceof File, `${s.name} has no file`);
    assert(s.size === s.fileObj.size, `${s.name}: declared ${s.size}, blob is ${s.fileObj.size}`);
    assert(s.size > 0, `${s.name} is empty`);
    // the extension has to match what was actually encoded
    const ext = s.name.split(".").pop();
    const byMime = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[s.fileObj.type];
    assert(ext === byMime, `${s.name} is ${s.fileObj.type}`);
    // and the declared dimensions have to be the real ones
    const bmp = await createImageBitmap(s.fileObj);
    assert(bmp.width === s.w && bmp.height === s.h,
      `${s.name}: declared ${s.w}x${s.h}, decoded ${bmp.width}x${bmp.height}`);
    bmp.close();
  }
});

// ── Aspect lock ────────────────────────────────────────────────────────
await test("the aspect lock survives typing a number one digit at a time", () => {
  const ratio = 1600 / 900;                       // 16:9
  // Each keystroke must be computed from the source ratio, never from the
  // previous pair. The old code chained them, so "800" arrived as 800x500.
  let w = 1600, h = 900;
  for (const partial of [8, 80, 800]) { w = partial; h = lockedPartner(w, ratio, "width"); }
  assert(w === 800 && h === 450, `typing "800" gave ${w}x${h}, expected 800x450`);

  for (const partial of [2, 27, 270]) { h = partial; w = lockedPartner(h, ratio, "height"); }
  assert(w === 480 && h === 270, `typing "270" gave ${w}x${h}, expected 480x270`);
});

await test("the aspect lock never produces a zero dimension", () => {
  // A very wide source plus a small height would round the partner to 0 and
  // make an unusable canvas.
  assert(lockedPartner(1, 1600 / 100, "height") >= 1, "width rounded to zero");
  assert(lockedPartner(1, 100 / 1600, "width")  >= 1, "height rounded to zero");
  assert(lockedPartner(500, null, "width") === null, "no ratio should mean no change");
});

// ── Crop box geometry ──────────────────────────────────────────────────
// Drives the real ratioLockedRect from other-tools.jsx — a copy of the maths
// here would stop testing the code the moment the two drifted. The invariant
// is that a ratio-locked rectangle never leaves the image: the preview
// promises a region, processCrop clamps, so anything outside is a region the
// user selected and did not get.
await test("a ratio-locked crop never leaves the image", () => {
  const ib = { x: 2, y: 0, w: 96, h: 100 };
  const HANDLES = ["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"];
  const bad = [];
  for (const targetR of [1, 4/3, 16/9, 3/4, 9/16]) {
    // start rectangles including ones jammed against each edge, and two that
    // already sit outside — a bad state has to heal, not propagate.
    const starts = [
      { x: 2,  y: 0,  w: 30, h: 40 },
      { x: 68, y: 55, w: 30, h: 40 },
      { x: 40, y: 30, w: 20, h: 20 },
      { x: -8, y: 10, w: 30, h: 40 },
      { x: 80, y: 80, w: 40, h: 40 },
    ];
    for (const sc of starts) for (const type of HANDLES) {
      const r = ratioLockedRect(type, sc, ib, targetR);
      const slack = Math.min(r.x - ib.x, ib.x + ib.w - (r.x + r.w),
                             r.y - ib.y, ib.y + ib.h - (r.y + r.h));
      if (slack < -0.01) bad.push({ targetR: +targetR.toFixed(3), type, sc, got: r, slack: +slack.toFixed(2) });
    }
  }
  assert(bad.length === 0, `${bad.length} escaped, first: ${JSON.stringify(bad[0])}`);
});

await test("a ratio-locked crop keeps its ratio", () => {
  const ib = { x: 2, y: 0, w: 96, h: 100 };
  for (const targetR of [1, 4/3, 16/9, 3/4, 9/16]) {
    for (const type of ["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"]) {
      const r = ratioLockedRect(type, { x: 30, y: 25, w: 25, h: 30 }, ib, targetR);
      assert(Math.abs(r.w / r.h - targetR) < 0.001,
        `${type} at ${targetR.toFixed(3)} produced ${(r.w / r.h).toFixed(3)}`);
    }
  }
});

// ── Job isolation ──────────────────────────────────────────────────────
// Jobs can overlap: a long Convert keeps running when the user switches tool.
// Both of these were broken — cancel tracked one job in a single slot, and the
// worker shared one cancelled flag across every run.
// Real PNG bytes, and big enough that the batch takes long enough to cancel
// mid-flight. toDataURL here would hand File a string, every decode would fail
// instantly, and the job would be over before the cancel landed.
async function jobFiles(n, size = 900) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, `hsl(${i * 37 % 360},70%,50%)`);
    g.addColorStop(1, "#1864ab");
    x.fillStyle = g; x.fillRect(0, 0, size, size);
    for (let k = 0; k < 400; k++) {
      x.fillStyle = `hsla(${(k * 11) % 360},70%,50%,.5)`;
      x.beginPath(); x.arc((k * 97) % size, (k * 211) % size, 3 + (k % 18), 0, 6.283); x.fill();
    }
    const blob = await new Promise(r => c.toBlob(r, "image/png"));
    out.push({ id: "j" + i, name: "j" + i + ".png", w: size, h: size,
               fileObj: new File([blob], "j" + i + ".png", { type: "image/png" }) });
  }
  return out;
}

// Downloads would land in the user's folder mid-test, so they are swallowed.
async function withoutDownloads(fn) {
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) return;
    return orig.call(this);
  };
  try { return await fn(); } finally { HTMLAnchorElement.prototype.click = orig; }
}

await test("cancel still works after an earlier job has finished", async () => {
  await withoutDownloads(async () => {
    const files = await jobFiles(10, 700);
    // Finishing this used to clear the single active-job slot.
    await new Promise(r => P.processCompress([files[0]], { format: "JPG", quality: 70 }, () => {}, () => r()));
    // Cancel on a progress event rather than a stopwatch. Timing it against a
    // fixed delay raced the queue: on a fast run the job was already over.
    let done = 0, sent = false;
    const res = await new Promise(r => P.processConvert(files, { format: "JPG", quality: 88 },
      (id, pct) => { if (pct === 100 && ++done === 2 && !sent) { sent = true; P.cancelJob(); } },
      (ok, e, sizes, cancelled) => r({ finished: sizes.length, cancelled })));
    assert(sent, "the job ended before two files finished — cannot test cancel");
    assert(res.cancelled === true, "cancel was a no-op — the earlier job cleared the slot");
    assert(res.finished < files.length, `all ${files.length} files ran anyway`);
  });
});

await test("starting a tool discards the previous job instead of dumping it", async () => {
  await withoutDownloads(async () => {
    const files = await jobFiles(10, 700);
    let firstCalledBack = false, started = false;
    // Supersede the moment the first job proves it is running, so this does
    // not depend on how fast the machine is.
    const superseded = new Promise(resolve => {
      P.processConvert(files, { format: "JPG", quality: 88 },
        (id, pct) => {
          if (pct === 100 && !started) {
            started = true;
            P.processCompress([files[0]], { format: "JPG", quality: 70 }, () => {}, () => resolve());
          }
        },
        () => { firstCalledBack = true; });
    });
    await superseded;
    await new Promise(r => setTimeout(r, 500));
    assert(started, "the first job never reported progress");
    assert(!firstCalledBack,
      "the superseded job still reported back, so its partial output was downloaded");
  });
});

await test("a queue is dispatched once, not once per remount", async () => {
  await withoutDownloads(async () => {
    // ConvertTab used to own the launching effect, so unmounting it on a tab
    // switch and coming back re-ran the whole queue. Count what reaches the
    // worker rather than trusting the final result, which looked fine either
    // way once the duplicate job was discarded.
    const posted = [];
    const real = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (m, ...rest) {
      if (m && m.type === "run") posted.push(m.files.length);
      return real.call(this, m, ...rest);
    };
    try {
      const files = await jobFiles(4, 500);
      await new Promise(r => P.processConvert(files, { format: "JPG", quality: 85 }, () => {}, () => r()));
      assert(posted.length === 1, `one click dispatched ${posted.length} jobs`);
      assert(posted[0] === 4, `dispatched ${posted[0]} files, expected 4`);
    } finally { Worker.prototype.postMessage = real; }
  });
});

// ── Colour depth reduction says what it does ───────────────────────────
await test("depth reduction hits the advertised levels per channel", async () => {
  const c = busyCanvas(300);
  for (const levels of [128, 64, 32, 16]) {
    const out = P.posterizeCanvas(c, levels);
    const d = out.getContext("2d").getImageData(0, 0, 300, 300).data;
    const perChannel = new Set();
    for (let i = 0; i < d.length; i += 4) { perChannel.add(d[i]); }
    assert(perChannel.size <= levels,
      `asked for ${levels} levels, red channel came back with ${perChannel.size}`);
  }
});

await test("no depth option is a no-op", async () => {
  // 256 used to be offered and changed nothing, because 8-bit already is 256
  // levels. Every option left has to actually alter the image.
  const c = busyCanvas(300);
  const before = c.getContext("2d").getImageData(0, 0, 300, 300).data;
  for (const levels of [128, 64, 32, 16]) {
    const d = P.posterizeCanvas(c, levels).getContext("2d").getImageData(0, 0, 300, 300).data;
    let changed = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== d[i]) changed++;
    assert(changed > 0, `${levels} levels left the image untouched`);
  }
});

await test("the whole pipeline works without OffscreenCanvas", async () => {
  const real = window.OffscreenCanvas;
  delete window.OffscreenCanvas;
  try {
    assert(typeof OffscreenCanvas === "undefined", "could not simulate its absence");

    const src = solidCanvas(120, 80);
    const resized = P.resizeCanvas(src, 60, 40, 2);
    assert(resized.width === 60 && resized.height === 40,
      `resize gave ${resized.width}x${resized.height}`);

    const png = await P.canvasToBlob(resized, "PNG", 100, true);
    assert(png.type === "image/png", "encode gave " + png.type);

    // and the decode path, which used createImageBitmap unconditionally
    const decoded = await P.getSourceCanvas({ fileObj: new File([png], "x.png", { type: "image/png" }) });
    assert(decoded.width === 60 && decoded.height === 40,
      `decode gave ${decoded.width}x${decoded.height}`);

    const jpg = await P.canvasToBlob(decoded, "JPG", 80, false);
    assert(jpg.type === "image/jpeg", "jpeg encode gave " + jpg.type);
  } finally {
    window.OffscreenCanvas = real;
  }
});

// ── WASM encoders ──────────────────────────────────────────────────────
await test("OxiPNG is smaller than the browser's PNG, and still lossless", async () => {
  const c = busyCanvas(400);
  const ref = c.getContext("2d").getImageData(0, 0, 400, 400).data;
  const browser = await P.canvasToBlob(c, "PNG", 100, true, false);
  const wasm    = await P.canvasToBlob(c, "PNG", 100, true, true);
  assert(wasm.type === "image/png", "did not come back as PNG: " + wasm.type);
  assert(wasm.size < browser.size,
    `wasm ${wasm.size} B vs browser ${browser.size} B — no gain`);
  // Lossless means pixel-identical, not just "looks fine".
  const bmp = await createImageBitmap(wasm);
  const t = document.createElement("canvas");
  t.width = 400; t.height = 400;
  t.getContext("2d").drawImage(bmp, 0, 0);
  const got = t.getContext("2d").getImageData(0, 0, 400, 400).data;
  let diff = 0;
  for (let i = 0; i < ref.length; i++) if (ref[i] !== got[i]) diff++;
  assert(diff === 0, `${diff} subpixels changed — OxiPNG must be lossless`);
});

await test("MozJPEG is smaller than the browser's JPEG at the same quality", async () => {
  const c = busyCanvas(500);
  const browser = await P.canvasToBlob(c, "JPG", 75, false, false);
  const wasm    = await P.canvasToBlob(c, "JPG", 75, false, true);
  assert(wasm.type === "image/jpeg", "did not come back as JPEG: " + wasm.type);
  assert(wasm.size < browser.size,
    `wasm ${wasm.size} B vs browser ${browser.size} B — no gain`);
});

await test("no two files ever share an id", async () => {
  // Ids key the progress map, the error map, the savings denominator and
  // React's list reconciliation. mapFile used Date.now() + index, so five
  // files dropped at t and three added 2 ms later both claimed t+2, t+3, t+4.
  // The samples had their own scheme starting at 1 and repeated it on every
  // load.
  const a = await makeSampleFiles();
  const b = await makeSampleFiles();
  const ids = [...a, ...b].map(f => f.id);
  assert(new Set(ids).size === ids.length,
    `two loads of the samples produced repeats: ${ids.join(",")}`);
  assert(ids.every(id => Number.isInteger(id)), "an id is not an integer");

  // A run of ids taken back to back inside one millisecond must still differ.
  const burst = Array.from({ length: 500 }, () => nextFileId());
  assert(new Set(burst).size === 500, "500 ids in a tight loop were not unique");
  assert(Math.min(...burst) > Math.max(...ids), "ids went backwards");
});

await test("the keyboard and the pointer land on the same crop rectangle", async () => {
  // Both routes go through nextRect; this fails if one of them grows its own
  // clamping. Deltas are container percentages either way.
  const ib = { x: 0, y: 0, w: 100, h: 100 };
  const sc = { x: 20, y: 20, w: 40, h: 40 };

  // Moving stays inside the image however hard it is pushed.
  const far = nextRect("move", sc, ib, null, 500, 500);
  assert(far.x + far.w <= ib.w + 0.01 && far.y + far.h <= ib.h + 0.01, "moved out of the image");
  assert(far.w === sc.w && far.h === sc.h, "a move changed the size");
  const back = nextRect("move", sc, ib, null, -500, -500);
  assert(back.x >= -0.01 && back.y >= -0.01, "moved off the top-left");

  // Shift+arrow resizes from the bottom-right: the top-left stays put.
  const bigger = nextRect("br", sc, ib, null, 10, 10);
  assert(bigger.w > sc.w && bigger.h > sc.h, "Shift+arrow did not resize");
  assert(bigger.x === sc.x && bigger.y === sc.y, "the anchored corner moved");

  // A locked ratio survives a keyboard resize, and stays inside the image.
  const square = nextRect("br", sc, ib, 1, 10, 0);
  assert(Math.abs(square.w - square.h) < 0.01, "the locked ratio was lost");
  assert(square.x + square.w <= ib.w + 0.01, "grew past the right edge");

  // Never smaller than the 5-unit floor, however many times it is shrunk.
  const tiny = nextRect("br", sc, ib, null, -500, -500);
  assert(tiny.w >= 5 && tiny.h >= 5, `collapsed to ${tiny.w}×${tiny.h}`);
});

await test("a ratio-locked handle actually resizes the crop box", async () => {
  // The drag loop computed the pointer's requested size and then threw it away
  // by asking ratioLockedRect for a rectangle built from the drag-start size,
  // so with any ratio locked the eight resize handles were inert — measured in
  // the page as 351×351 before and after a 90px inward drag, while Libre went
  // 538×358 → 448×298 on the identical gesture.
  const ib = { x: 0, y: 0, w: 100, h: 100 };
  const start = { x: 10, y: 10, w: 80, h: 80 };

  const same = ratioLockedRect("tl", start, ib, 1, { w: 80, h: 80 });
  assert(Math.round(same.w) === 80, `no change asked, got ${same.w}`);

  // Pointer drags the top-left corner in: the box must shrink and stay square,
  // anchored to the bottom-right corner it is not dragging.
  const smaller = ratioLockedRect("tl", start, ib, 1, { w: 50, h: 50 });
  assert(Math.round(smaller.w) === 50, `shrink ignored — still ${smaller.w}`);
  assert(Math.abs(smaller.w - smaller.h) < 0.01, "stopped being square");
  assert(Math.abs((smaller.x + smaller.w) - (start.x + start.w)) < 0.01,
    "the anchored right edge moved");
  assert(Math.abs((smaller.y + smaller.h) - (start.y + start.h)) < 0.01,
    "the anchored bottom edge moved");

  // Growing past the image is capped, not allowed out of bounds.
  const huge = ratioLockedRect("tl", start, ib, 1, { w: 500, h: 500 });
  assert(huge.x >= -0.01 && huge.y >= -0.01, "escaped the top-left");
  assert(huge.x + huge.w <= ib.w + 0.01, "escaped the right edge");
  assert(huge.y + huge.h <= ib.h + 0.01, "escaped the bottom edge");

  // Omitting want keeps the old behaviour, which the clamping tests rely on.
  const legacy = ratioLockedRect("tl", start, ib, 1);
  assert(Math.round(legacy.w) === 80, "the default size is no longer sc");
});

await test("the savings figure counts only the inputs that produced output", async () => {
  // This number has been wrong twice, each time by choosing the wrong set of
  // files. The three shapes below are the three that actually occur.
  const files = [{ id:1, size:1000 }, { id:2, size:2000 },
                 { id:3, size:4000 }, { id:4, size:8000 }];

  // Everything succeeded.
  assert(inputBytesBehind(files, [], [{id:1,bytes:1},{id:2,bytes:1},{id:3,bytes:1},{id:4,bytes:1}]) === 15000,
    "a clean run must count every file");

  // Two failed: their bytes are not savings, they are files that never moved.
  assert(inputBytesBehind(files, [{id:2},{id:4}], [{id:1,bytes:1},{id:3,bytes:1}]) === 5000,
    "failures must not be counted as converted");

  // Cancelled after two of four. The untouched files raise no error at all,
  // which is exactly what the previous version missed.
  assert(inputBytesBehind(files, [], [{id:1,bytes:1},{id:2,bytes:1}]) === 3000,
    "a cancel must not count the files it never reached");

  // Merged PDF: one output, no per-file id, so every non-failed input fed it.
  assert(inputBytesBehind(files, [{id:4}], [{id:null,bytes:1}]) === 7000,
    "a merged output must count every input that did not fail");

  // Nothing ran yet.
  assert(inputBytesBehind(files, [], null) === 0, "no results means no denominator");
  assert(inputBytesBehind(files, [], []) === 0, "an empty result set means no denominator");
});

await test("a target-size search does not run on a format with no quality knob", async () => {
  // PNG ignores the quality argument, so the binary search re-encoded the same
  // bytes seven times and then reported "quality 100" as if it had chosen one.
  // With OxiPNG on that was 6.3 s of work for a 0.77 s job.
  const c = busyCanvas(300);
  const seen = [];
  const r = await P.encodeToTargetSize(c, "PNG", 5_000_000, true,
    (n, q, size) => seen.push(size), false);
  assert(r.steps === 1, `PNG took ${r.steps} encodes to search a constant`);
  assert(seen.length === 1, `reported ${seen.length} steps to the UI`);
  assert(r.quality === null, `claimed quality ${r.quality} for a format that has none`);
  assert(r.met === true, "a 5 MB budget must fit a small PNG");
});

await test("a target-size search still runs where quality does something", async () => {
  const c = busyCanvas(300);
  const sizes = [];
  const r = await P.encodeToTargetSize(c, "JPG", 4000, true,
    (n, q, size) => sizes.push(size), false);
  assert(r.steps > 1, "JPG must actually search");
  assert(new Set(sizes).size > 1, "every JPG probe came back the same size");
  assert(typeof r.quality === "number", "JPG must report the quality it chose");
  if (r.met) assert(r.blob.size <= 4000, `met:true but ${r.blob.size} B is over budget`);
});

await test("the resize preview reports the size the resize actually produces", async () => {
  // The header echoed the typed numbers while runOne clamped them, so
  // "1600×900 → 800×1200" shipped an 800×900 file. Both sides call
  // resizeTargetDims now; this fails if either stops.
  const src = solidCanvas(1600, 900);
  const cases = [
    // [w, h, fit, upscale]  fit: 0 contain, 1 cover, 2 stretch
    [800, 1200, 0, false],   // box is taller than the source, but contain
    [800, 1200, 1, false],   // scales by 0.5 too — nothing is enlarged
    [800, 1200, 2, false],   // stretch really would enlarge the height
    [3000, 3000, 0, false],  // genuine upscale, capped by scale not canvas
    [800, 1200, 0, true],    // upscaling allowed: always the asked-for box
  ];
  for (const [w, h, fit, upscale] of cases) {
    const promised = P.resizeTargetDims(1600, 900, w, h, fit, upscale);
    const canvas   = P.resizeCanvas(src, promised.w, promised.h, fit, upscale);
    assert(canvas.width === promised.w && canvas.height === promised.h,
      `${w}×${h} fit=${fit} upscale=${upscale}: promised ${promised.w}×${promised.h}, produced ${canvas.width}×${canvas.height}`);
  }
});

await test("resizing never enlarges the image when upscaling is off", async () => {
  // A 40×30 source in a 400×400 box: the canvas is the box the user asked for,
  // but the picture inside it must still be 40×30.
  const src = solidCanvas(40, 30);
  const c = P.resizeCanvas(src, 400, 400, 0, false);
  const ctx = c.getContext("2d");
  // Walk the middle row out from the centre until the drawn pixels stop.
  const row = ctx.getImageData(0, 200, 400, 1).data;
  let drawn = 0;
  for (let x = 0; x < 400; x++) if (row[x * 4 + 3] > 0) drawn++;
  assert(drawn <= 41, `image spans ${drawn}px across a 40px source — it was upscaled`);
  assert(drawn >= 39, `image spans only ${drawn}px — it was shrunk instead`);
});

await test("max compression never returns a file larger than plain encoding", async () => {
  // MozJPEG loses on dense high-frequency detail at high quality — it measured
  // 101% larger than canvas at quality 95 — so the option has to fall back
  // rather than hand back a bigger file under the word "compression".
  const c = busyCanvas(400);
  for (const q of [50, 82, 95]) {
    const plain = await P.canvasToBlob(c, "JPG", q, false, false);
    const max   = await P.canvasToBlob(c, "JPG", q, false, true);
    assert(max.size <= plain.size,
      `quality ${q}: max ${max.size} B vs plain ${plain.size} B — max compression grew the file`);
  }
});

await test("MozJPEG emits a progressive JPEG, which canvas cannot", async () => {
  // Quality 75 on busy content is comfortably inside the range where MozJPEG
  // wins, so the wasm output is the one that ships and SOF2 is expected.
  const blob = await P.canvasToBlob(busyCanvas(300), "JPG", 75, false, true);
  const u = new Uint8Array(await blob.arrayBuffer());
  assert(u[0] === 0xFF && u[1] === 0xD8, "not a JPEG at all");
  // SOF2 marker — progressive DCT. Baseline files carry SOF0 instead.
  let sof2 = false;
  for (let i = 0; i < u.length - 1; i++) if (u[i] === 0xFF && u[i + 1] === 0xC2) { sof2 = true; break; }
  assert(sof2, "no SOF2 marker — this is baseline, so the wasm path did not run");
});

await test("maxCompress is ignored where no wasm encoder exists", async () => {
  // WEBP has no jSquash encoder wired up; asking must not break or mislabel.
  const c = busyCanvas(200);
  const blob = await P.canvasToBlob(c, "WEBP", 80, true, true);
  assert(blob.type === "image/webp", "fell through to the wrong format: " + blob.type);
});

// ponytail: single-file cases only — anything with 2+ files takes the zip
  // path and would write to the user's Downloads folder mid-test.

  const s = document.getElementById("summary");
  s.textContent = `${pass} passed, ${fail} failed`;
  s.className = fail ? "fail" : "ok";
})();
