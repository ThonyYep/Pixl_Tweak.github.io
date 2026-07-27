// processor.jsx — orchestration around the worker.
//
// The pixel work lives in engine.js and runs inside worker.js. What stays here
// is everything that needs the DOM: triggering downloads, zipping, and jsPDF,
// which cannot run in a worker. Plus the fallback for browsers without
// OffscreenCanvas, where the same engine runs inline.

const CAN_OFFLOAD = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";

let _worker = null;
function worker() {
  if (!_worker) _worker = new Worker("worker.js");
  return _worker;
}

// Synchronous probe: Safari cannot encode WebP from a canvas and quietly hands
// back PNG, so the default output format has to be measured, not assumed.
function canEncode(mime) {
  const c = document.createElement("canvas");
  c.width = 1; c.height = 1;
  return c.toDataURL(mime).startsWith("data:" + mime);
}

async function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load " + (file.name || "image"))); };
    img.src = url;
  });
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
  downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), zipName);
}

// ── PDF: jsPDF needs the DOM, so the worker hands back JPEGs and the pages
//    get assembled here.
const blobToDataURL = blob => new Promise(res => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.readAsDataURL(blob);
});

async function buildPDF(jpegBlobs) {
  if (!window.jspdf) throw new Error("jsPDF not loaded");
  const { jsPDF } = window.jspdf;
  let pdf = null;
  for (const blob of jpegBlobs) {
    const img = await loadImage(blob);
    const w = img.naturalWidth, h = img.naturalHeight;
    const landscape = w > h;
    const pageW = landscape ? 297 : 210, pageH = landscape ? 210 : 297;
    if (!pdf) pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: [pageW, pageH] });
    else pdf.addPage([pageW, pageH], landscape ? "landscape" : "portrait");
    const scale = Math.min(pageW / w, pageH / h);
    const iw = w * scale, ih = h * scale;
    pdf.addImage(await blobToDataURL(blob), "JPEG", (pageW - iw) / 2, (pageH - ih) / 2, iw, ih);
  }
  return pdf ? pdf.output("blob") : null;
}

// ── Job runner ────────────────────────────────────────────────────────────
// Same shape whether it goes to the worker or runs inline, so the callers do
// not have to care which happened.

let _jobId = 0;
let _active = null;

function cancelJob() {
  if (!_active) return;
  _active.cancelled = true;
  if (CAN_OFFLOAD) worker().postMessage({ type: "cancel" });
}

function toPayload(files) {
  return files.map(f => ({ id: f.id, name: f.name, blob: f.fileObj || null,
                           w: f.w, h: f.h, palette: f.palette }));
}

// Collects per-file results, then does the DOM-side work: PDF assembly,
// zipping when there is more than one output, and the download itself.
async function finish(op, settings, results, errors, cancelled, onDone) {
  const sizes = [];
  let entries = [];

  const pdfSources = results.flatMap(r => r.outputs.filter(o => o.pdfSource));
  if (pdfSources.length && settings.mergePDF && results.length > 1) {
    const merged = await buildPDF(pdfSources.map(o => o.blob));
    if (merged) { downloadBlob(merged, "merged.pdf"); sizes.push({ id: null, bytes: merged.size }); }
  } else {
    for (const r of results) {
      let outs = r.outputs;
      if (outs.some(o => o.pdfSource)) {
        const pdf = await buildPDF(outs.map(o => o.blob));
        outs = [{ path: outs[0].path, blob: pdf }];
      }
      entries.push(...outs);
      sizes.push({ id: r.fileId, bytes: outs.reduce((a, o) => a + o.blob.size, 0),
                   quality: r.quality, met: r.met, blob: outs[0].blob });
    }
  }

  if (entries.length === 1) {
    downloadBlob(entries[0].blob, entries[0].path);
  } else if (entries.length > 1) {
    const single = results.length === 1;
    await downloadZip(entries, single
      ? results[0].name.replace(/\.[^/.]+$/, "") + ".zip"
      : ZIP_NAME[op] || "pixl-tweak-export.zip");
  }
  onDone(errors.length === 0 && !cancelled, errors, sizes, cancelled);
}

const ZIP_NAME = { convert: "pixl-tweak-export.zip", resize: "pixl-tweak-resized.zip",
                   compress: "pixl-tweak-compressed.zip", crop: "pixl-tweak-cropped.zip" };

function runJob(op, files, settings, onProgress, onDone) {
  const jobId = ++_jobId;
  const state = { cancelled: false };
  _active = state;
  const results = [], errors = [];

  const report = (fileId, pct, st) => { if (!state.cancelled) onProgress(fileId, pct, st); };

  if (!CAN_OFFLOAD) {
    // No worker: same engine, same order, just on this thread.
    (async () => {
      for (const f of toPayload(files)) {
        if (state.cancelled) break;
        report(f.id, 5);
        try {
          const r = await ENGINE.runOne(f, op, settings, frac => report(f.id, Math.min(95, 5 + frac * 90)));
          results.push({ fileId: f.id, name: f.name, ...r });
          report(f.id, 100);
        } catch (err) {
          errors.push({ id: f.id, name: f.name, ...classifyError(err) });
          report(f.id, 100, "error");
        }
      }
      await finish(op, settings, results, errors, state.cancelled, onDone);
      _active = null;
    })();
    return;
  }

  const w = worker();
  const onMsg = async (e) => {
    const m = e.data;
    if (m.jobId !== jobId) return;
    if (m.type === "progress") report(m.fileId, m.pct, m.state);
    else if (m.type === "result") results.push(m);
    else if (m.type === "failed") errors.push({ id: m.fileId, name: m.name, fmt: m.fmt, tooBig: m.tooBig });
    else if (m.type === "done") {
      w.removeEventListener("message", onMsg);
      await finish(op, settings, results, errors, m.cancelled, onDone);
      _active = null;
    }
  };
  w.addEventListener("message", onMsg);
  w.postMessage({ type: "run", jobId, op, files: toPayload(files), settings });
}

function classifyError(err) {
  const msg = (err && err.message) || "";
  const fmt = /^UNSUPPORTED_OUTPUT:(\w+)/.exec(msg);
  const big = /^CANVAS_TOO_LARGE:(\S+)/.exec(msg);
  return { fmt: fmt ? fmt[1] : null, tooBig: big ? big[1] : null };
}

const processConvert  = (f, s, p, d) => runJob("convert",  f, s, p, d);
const processResize   = (f, s, p, d) => runJob("resize",   f, s, p, d);
const processCompress = (f, s, p, d) => runJob("compress", f, s, p, d);
const processCrop     = (f, s, p, d) => runJob("crop",     f, s, p, d);

// Shared React hook — exposes an object URL for a file's fileObj
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
  // engine, re-exported so callers and tests reach one implementation
  canvasToBlob:       ENGINE.canvasToBlob,
  encodeToTargetSize: ENGINE.encodeToTargetSize,
  resizeCanvas:       ENGINE.resizeCanvas,
  resizeContain:      ENGINE.resizeContain,
  preShrink:          ENGINE.preShrink,
  encodeBMP:          ENGINE.encodeBMP,
  encodeICO:          ENGINE.encodeICO,
  getSourceCanvas:    f => ENGINE.sourceCanvas({ blob: f.fileObj || f.blob, w: f.w, h: f.h, palette: f.palette }),
  getOutputName:      ENGINE.outputName,
  // main thread only
  canEncode, loadImage, downloadBlob, downloadZip, buildPDF,
  offloaded: CAN_OFFLOAD,
  cancelJob,
  processConvert, processResize, processCompress, processCrop,
};
