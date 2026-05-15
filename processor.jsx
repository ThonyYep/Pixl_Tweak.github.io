// processor.jsx — Image processing engine (Canvas API + JSZip + jsPDF)

async function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load " + file.name)); };
    img.src = url;
  });
}

function generateSampleCanvas(w, h, palette) {
  const canvas = document.createElement("canvas");
  canvas.width = w || 800; canvas.height = h || 600;
  const ctx = canvas.getContext("2d");
  const [a, b, c] = palette || ["#ff8a5b", "#ffd16e", "#7a4a8a"];
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, a); grad.addColorStop(1, b);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,248,236,0.7)";
  ctx.beginPath();
  ctx.arc(canvas.width * 0.3, canvas.height * 0.37, Math.min(canvas.width, canvas.height) * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c + "b0";
  ctx.beginPath();
  ctx.moveTo(0, canvas.height * 0.83);
  ctx.lineTo(canvas.width * 0.33, canvas.height * 0.53);
  ctx.lineTo(canvas.width * 0.57, canvas.height * 0.73);
  ctx.lineTo(canvas.width * 0.80, canvas.height * 0.47);
  ctx.lineTo(canvas.width, canvas.height * 0.67);
  ctx.lineTo(canvas.width, canvas.height);
  ctx.lineTo(0, canvas.height);
  ctx.closePath();
  ctx.fill();
  return canvas;
}

async function getSourceCanvas(file) {
  if (file.fileObj) {
    const img = await loadImage(file.fileObj);
    const canvas = document.createElement("canvas");
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
    return canvas;
  }
  return generateSampleCanvas(file.w || 800, file.h || 600, file.palette);
}

function copyToCanvas(src, w, h) {
  const sw = src.naturalWidth  || src.width;
  const sh = src.naturalHeight || src.height;
  const canvas = document.createElement("canvas");
  canvas.width  = w || sw;
  canvas.height = h || sh;
  canvas.getContext("2d").drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Fit image inside a square size×size preserving aspect ratio (transparent bg)
function resizeContain(src, size) {
  const sw = src.naturalWidth  || src.width;
  const sh = src.naturalHeight || src.height;
  const scale = Math.min(size / sw, size / sh);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  canvas.getContext("2d").drawImage(
    src,
    Math.round((size - dw) / 2),
    Math.round((size - dh) / 2),
    dw, dh
  );
  return canvas;
}

function resizeCanvas(src, targetW, targetH, fit) {
  // fit: 0=contain, 1=cover, 2=stretch
  const sw = src.naturalWidth  || src.width;
  const sh = src.naturalHeight || src.height;
  const canvas = document.createElement("canvas");
  canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetW, targetH);
  if (fit === 2) {
    ctx.drawImage(src, 0, 0, targetW, targetH);
  } else {
    const scaleW = targetW / sw;
    const scaleH = targetH / sh;
    const scale  = fit === 1 ? Math.max(scaleW, scaleH) : Math.min(scaleW, scaleH);
    const dw = sw * scale, dh = sh * scale;
    ctx.drawImage(src, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);
  }
  return canvas;
}

function posterizeCanvas(canvas, maxColors) {
  const levels = Math.ceil(Math.log2(Math.max(2, maxColors)));
  const step   = 256 / (1 << levels);
  const out = document.createElement("canvas");
  out.width = canvas.width; out.height = canvas.height;
  const ctx = out.getContext("2d");
  ctx.drawImage(canvas, 0, 0);
  const id = ctx.getImageData(0, 0, out.width, out.height);
  const d  = id.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = Math.round(d[i]   / step) * step;
    d[i+1] = Math.round(d[i+1] / step) * step;
    d[i+2] = Math.round(d[i+2] / step) * step;
  }
  ctx.putImageData(id, 0, 0);
  return out;
}

function encodeBMP(canvas) {
  const w = canvas.width, h = canvas.height;
  const pixels = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const pixelDataSize = w * h * 4;
  const fileSize = 54 + pixelDataSize;
  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);
  view.setUint16(0,  0x4D42, true);
  view.setUint32(2,  fileSize, true);
  view.setUint32(6,  0, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32( 18, w,  true);
  view.setInt32( 22, -h, true);  // negative = top-down
  view.setUint16(26, 1,  true);
  view.setUint16(28, 32, true);
  view.setUint32(30, 0,  true);
  view.setUint32(34, pixelDataSize, true);
  view.setInt32( 38, 2835, true);
  view.setInt32( 42, 2835, true);
  view.setUint32(46, 0, true);
  view.setUint32(50, 0, true);
  const u8 = new Uint8Array(buf);
  for (let i = 0, o = 54; i < pixels.length; i += 4, o += 4) {
    u8[o]   = pixels[i+2]; // B
    u8[o+1] = pixels[i+1]; // G
    u8[o+2] = pixels[i];   // R
    u8[o+3] = pixels[i+3]; // A
  }
  return new Blob([buf], { type: "image/bmp" });
}

async function canvasToPng(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

async function encodeICO(sizedPngBlobs) {
  // sizedPngBlobs: [{ size, blob }] — sizes must be <= 256
  const entries = await Promise.all(sizedPngBlobs.map(async ({ size, blob }) => ({
    size, data: new Uint8Array(await blob.arrayBuffer()),
  })));
  const n = entries.length;
  const headerSize = 6 + n * 16;
  const offsets = [];
  let pos = headerSize;
  for (const e of entries) { offsets.push(pos); pos += e.data.byteLength; }
  const buf  = new ArrayBuffer(pos);
  const view = new DataView(buf);
  const u8   = new Uint8Array(buf);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true); // ICO type
  view.setUint16(4, n, true);
  for (let i = 0; i < n; i++) {
    const { size, data } = entries[i];
    const b  = 6 + i * 16;
    const s  = size >= 256 ? 0 : size; // 0 = 256 in ICO spec
    view.setUint8( b,    s);
    view.setUint8( b+1,  s);
    view.setUint8( b+2,  0);
    view.setUint8( b+3,  0);
    view.setUint16(b+4,  1,  true);
    view.setUint16(b+6,  32, true);
    view.setUint32(b+8,  data.byteLength, true);
    view.setUint32(b+12, offsets[i], true);
    u8.set(data, offsets[i]);
  }
  return new Blob([buf], { type: "image/x-icon" });
}

async function encodePDF(canvas) {
  const { jsPDF } = window.jspdf;
  const w = canvas.width, h = canvas.height;
  const landscape = w > h;
  const pageW = landscape ? 297 : 210;
  const pageH = landscape ? 210 : 297;
  const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: [pageW, pageH] });
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const scale = Math.min(pageW / w, pageH / h);
  const iw = w * scale, ih = h * scale;
  pdf.addImage(dataUrl, "JPEG", (pageW - iw) / 2, (pageH - ih) / 2, iw, ih);
  return pdf.output("blob");
}

async function canvasToBlob(canvas, format, quality, transparent) {
  const q = (quality || 82) / 100;
  if (format === "BMP") return encodeBMP(canvas);
  const noAlpha = !transparent && (format === "JPG" || format === "GIF");
  let src = canvas;
  if (noAlpha) {
    const flat = document.createElement("canvas");
    flat.width = canvas.width; flat.height = canvas.height;
    const ctx = flat.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    src = flat;
  }
  const mimeMap = {
    PNG:  ["image/png",  1.0],
    JPG:  ["image/jpeg", q],
    WEBP: ["image/webp", q],
    AVIF: ["image/avif", q],
    GIF:  ["image/webp", q],
    TIFF: ["image/png",  1.0],
  };
  const [mime, qVal] = mimeMap[format] || ["image/png", 1.0];
  return new Promise(resolve => {
    src.toBlob(blob => {
      if (blob) { resolve(blob); return; }
      src.toBlob(resolve, "image/webp", q); // AVIF fallback
    }, mime, qVal);
  });
}

function getOutputName(originalName, format) {
  const base = originalName.replace(/\.[^/.]+$/, "");
  const extMap = { JPG:"jpg", PNG:"png", WEBP:"webp", AVIF:"avif", GIF:"gif", BMP:"bmp", TIFF:"tif", PDF:"pdf", ICO:"ico" };
  return base + "." + (extMap[format] || format.toLowerCase());
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

async function downloadZip(entries, zipName) {
  const zip = new JSZip();
  for (const { path, blob } of entries) zip.file(path, blob);
  const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadBlob(zipBlob, zipName);
}

async function encodeMergedPDF(canvases) {
  if (!window.jspdf) throw new Error("jsPDF not loaded");
  const { jsPDF } = window.jspdf;
  let pdf = null;
  for (const canvas of canvases) {
    const w = canvas.width, h = canvas.height;
    const landscape = w > h;
    const pageW = landscape ? 297 : 210;
    const pageH = landscape ? 210 : 297;
    if (!pdf) {
      pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: [pageW, pageH] });
    } else {
      pdf.addPage([pageW, pageH], landscape ? "landscape" : "portrait");
    }
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const scale   = Math.min(pageW / w, pageH / h);
    const iw = w * scale, ih = h * scale;
    pdf.addImage(dataUrl, "JPEG", (pageW - iw) / 2, (pageH - ih) / 2, iw, ih);
  }
  return pdf ? pdf.output("blob") : null;
}

async function processConvert(files, settings, onProgress, onDone) {
  const { format, quality, icoSizes, icoKeepOriginal, transparent, mergePDF } = settings;
  const isICO      = format === "ICO";
  const isPDF      = format === "PDF";
  const doMergePDF = isPDF && mergePDF && files.length > 1;
  const isMulti    = files.length > 1 || isICO;
  const zipEntries = [];
  let ok = true;

  // ── Merge-PDF path: collect all canvases then emit one file ──────────────
  if (doMergePDF) {
    const canvases = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      onProgress(file.id, 10);
      try {
        const canvas = await getSourceCanvas(file);
        canvases.push(canvas);
        onProgress(file.id, 80);
      } catch (err) {
        console.error("processConvert merge error:", file.name, err);
        ok = false;
        onProgress(file.id, 100);
      }
    }
    try {
      const mergedBlob = await encodeMergedPDF(canvases);
      if (mergedBlob) downloadBlob(mergedBlob, "merged.pdf");
    } catch (err) {
      console.error("encodeMergedPDF error:", err);
      ok = false;
    }
    files.forEach(f => onProgress(f.id, 100));
    onDone(ok);
    return;
  }

  // ── Normal per-file path ─────────────────────────────────────────────────
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress(file.id, 5);
    try {
      const canvas = await getSourceCanvas(file);
      onProgress(file.id, 35);
      const baseName = file.name.replace(/\.[^/.]+$/, "");

      if (isICO) {
        const sizes    = (icoSizes && icoSizes.length > 0 ? icoSizes : [16,32,48,256]).filter(s => s <= 256);
        const sizedPngs = [];
        for (let j = 0; j < sizes.length; j++) {
          const s   = sizes[j];
          const c   = resizeContain(canvas, s);
          const png = await canvasToPng(c);
          sizedPngs.push({ size: s, blob: png });
          zipEntries.push({ path: `${baseName}/${s}x${s}/${baseName}.png`, blob: png });
          onProgress(file.id, 35 + Math.round((j + 1) / sizes.length * 45));
        }
        if (icoKeepOriginal) {
          const origPng = await canvasToPng(canvas);
          zipEntries.push({ path: `${baseName}/original/${baseName}.png`, blob: origPng });
        }
        const icoBlob = await encodeICO(sizedPngs);
        zipEntries.push({ path: `${baseName}/${baseName}.ico`, blob: icoBlob });

      } else if (isPDF) {
        if (!window.jspdf) throw new Error("jsPDF not loaded");
        const pdfBlob = await encodePDF(canvas);
        const outName = getOutputName(file.name, "PDF");
        if (isMulti) zipEntries.push({ path: outName, blob: pdfBlob });
        else downloadBlob(pdfBlob, outName);
        onProgress(file.id, 85);

      } else {
        const blob    = await canvasToBlob(canvas, format, quality, transparent !== false);
        const outName = getOutputName(file.name, format);
        if (isMulti) zipEntries.push({ path: outName, blob });
        else downloadBlob(blob, outName);
        onProgress(file.id, 90);
      }

      onProgress(file.id, 100);
    } catch (err) {
      console.error("processConvert error:", file.name, err);
      ok = false;
      onProgress(file.id, 100);
    }
  }

  if (zipEntries.length > 0) {
    const zipName = files.length === 1
      ? files[0].name.replace(/\.[^/.]+$/, "") + ".zip"
      : "pixl-tweak-export.zip";
    await downloadZip(zipEntries, zipName);
  }
  onDone(ok);
}

async function processResize(files, resizeSettings, onProgress, onDone) {
  const { w, h, fit, upscale, format = "WEBP", transparent = true } = resizeSettings;
  const extMap  = { JPG: "jpg", PNG: "png", WEBP: "webp" };
  const ext     = extMap[format] || "webp";
  const isMulti = files.length > 1;
  const zipEntries = [];

  for (const file of files) {
    onProgress(file.id, 10);
    try {
      const src = await getSourceCanvas(file);
      const sw  = src.naturalWidth || src.width;
      const sh  = src.naturalHeight || src.height;
      let tw = w, th = h;
      if (!upscale) { tw = Math.min(w, sw); th = Math.min(h, sh); }
      const canvas  = resizeCanvas(src, tw, th, fit || 0);
      const blob    = await canvasToBlob(canvas, format, 90, transparent);
      const outName = file.name.replace(/\.[^/.]+$/, "") + "_resized." + ext;
      onProgress(file.id, 85);
      if (isMulti) zipEntries.push({ path: outName, blob });
      else downloadBlob(blob, outName);
      onProgress(file.id, 100);
    } catch (err) {
      console.error("processResize error:", err);
      onProgress(file.id, 100);
    }
  }
  if (zipEntries.length > 0) await downloadZip(zipEntries, "pixl-tweak-resized.zip");
  onDone(true);
}

async function processCompress(files, compressSettings, onProgress, onDone) {
  const { format, quality, reduceColors, maxColors } = compressSettings;
  const isMulti    = files.length > 1;
  const zipEntries = [];

  for (const file of files) {
    onProgress(file.id, 10);
    try {
      let canvas = await getSourceCanvas(file);
      onProgress(file.id, 50);
      if (format === "PNG" && reduceColors && maxColors) {
        canvas = posterizeCanvas(canvas, maxColors);
      }
      const blob    = await canvasToBlob(canvas, format, quality, true);
      const outName = file.name.replace(/\.[^/.]+$/, "") + "_compressed." + format.toLowerCase();
      onProgress(file.id, 90);
      if (isMulti) zipEntries.push({ path: outName, blob });
      else downloadBlob(blob, outName);
      onProgress(file.id, 100);
    } catch (err) {
      console.error("processCompress error:", err);
      onProgress(file.id, 100);
    }
  }
  if (zipEntries.length > 0) await downloadZip(zipEntries, "pixl-tweak-compressed.zip");
  onDone(true);
}

async function processCrop(files, cropSettings, onProgress, onDone) {
  const { crop, rotation, flipH, flipV } = cropSettings;
  const isMulti    = files.length > 1;
  const zipEntries = [];

  for (const file of files) {
    onProgress(file.id, 10);
    try {
      const src = await getSourceCanvas(file);
      const sw  = src.naturalWidth || src.width;
      const sh  = src.naturalHeight || src.height;
      onProgress(file.id, 40);

      // Apply rotation + flip first
      const radians = rotation * Math.PI / 180;
      const sinA    = Math.abs(Math.sin(radians));
      const cosA    = Math.abs(Math.cos(radians));
      const rw      = Math.round(sw * cosA + sh * sinA);
      const rh      = Math.round(sw * sinA + sh * cosA);
      const rot     = document.createElement("canvas");
      rot.width = rw; rot.height = rh;
      const rctx = rot.getContext("2d");
      rctx.translate(rw / 2, rh / 2);
      rctx.rotate(radians);
      rctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      rctx.drawImage(src, -sw / 2, -sh / 2);

      // Crop rectangle in pixels (% of original unrotated dimensions)
      const cx  = (crop.x / 100) * sw;
      const cy  = (crop.y / 100) * sh;
      const cw  = (crop.w / 100) * sw;
      const ch  = (crop.h / 100) * sh;
      const ox  = (rw - sw) / 2;
      const oy  = (rh - sh) / 2;

      const out  = document.createElement("canvas");
      out.width  = Math.round(cw); out.height = Math.round(ch);
      out.getContext("2d").drawImage(rot, cx + ox, cy + oy, cw, ch, 0, 0, cw, ch);

      onProgress(file.id, 80);

      const blob    = await canvasToBlob(out, "PNG", 100, true);
      const outName = file.name.replace(/\.[^/.]+$/, "") + "_cropped.png";
      if (isMulti) zipEntries.push({ path: outName, blob });
      else downloadBlob(blob, outName);
      onProgress(file.id, 100);
    } catch (err) {
      console.error("processCrop error:", err);
      onProgress(file.id, 100);
    }
  }
  if (zipEntries.length > 0) await downloadZip(zipEntries, "pixl-tweak-cropped.zip");
  onDone(true);
}

// Shared React hook — exposes object URL for a file's fileObj
function useFileUrl(file) {
  const [url, setUrl] = React.useState(null);
  React.useEffect(() => {
    if (!file?.fileObj) { setUrl(null); return; }
    const u = URL.createObjectURL(file.fileObj);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file?.id]);
  return url;
}
window.useFileUrl = useFileUrl;

window.Processor = {
  loadImage,
  generateSampleCanvas,
  getSourceCanvas,
  resizeCanvas,
  encodeBMP,
  encodeICO,
  encodePDF,
  encodeMergedPDF,
  downloadBlob,
  downloadZip,
  processConvert,
  processResize,
  processCompress,
  processCrop,
};
