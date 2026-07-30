// processor.jsx — orchestration around the worker.
//
// The pixel work lives in engine.js and runs inside worker.js. What stays here
// is everything that needs the DOM: triggering downloads, zipping, and jsPDF,
// which cannot run in a worker. Plus the fallback for browsers without
// OffscreenCanvas, where the same engine runs inline.

// engine.js owns this; worker.js reads the same one.
const classifyError = ENGINE.classifyError;

const CAN_OFFLOAD = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";

let _worker = null;
let _workerBroken = false;

// Returns null rather than throwing. A worker can fail to start for reasons
// that have nothing to do with support — a CSP that forbids workers, for one —
// and a throw in here used to leave the job hanging with no way to finish.
function worker() {
  if (_workerBroken) return null;
  if (!_worker) {
    try {
      _worker = new Worker("worker.js");
      // A worker that dies mid-job never posts "done", so every job waiting on
      // it has to be told, or they wait forever.
      _worker.addEventListener("error", (err) => {
        console.error("worker died:", err && err.message);
        _workerBroken = true;
        for (const state of [..._inflight.values()]) if (state.abort) state.abort();
      });
    } catch (err) {
      console.error("worker unavailable, falling back to the main thread:", err);
      _workerBroken = true;
      return null;
    }
  }
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

// Returns the archive's own size. The summary reports what you downloaded, not
// the sum of what is inside it — five PDFs adding up to 173 KB arrive as a
// 113 KB zip, and 173 was never a number the user paid for.
async function downloadZip(entries, zipName) {
  const zip = new JSZip();
  for (const { path, blob } of entries) zip.file(path, blob);
  const archive = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadBlob(archive, zipName);
  return archive.size;
}

// ── PDF: jsPDF needs the DOM, so the worker hands back JPEGs and the pages
//    get assembled here.
// Every branch settles. Without onerror this was the one promise in the
// codebase that could hang: a FileReader failure on the PDF path left the job
// waiting forever, and a hang is not something finish()'s try/catch can see.
const blobToDataURL = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload  = () => resolve(r.result);
  r.onerror = () => reject(r.error || new Error("FileReader failed"));
  r.onabort = () => reject(new Error("FileReader aborted"));
  try { r.readAsDataURL(blob); } catch (err) { reject(err); }
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
// A Map, not a single slot: a finished job used to null the slot and turn a
// later cancel into a silent no-op while another job was still running.
const _inflight = new Map();

function stop(jobId, discard) {
  const state = _inflight.get(jobId);
  if (!state) return;
  state.cancelled = true;
  state.discard = discard;
  // worker() returns null once the worker has died, and this guarded only on
  // CAN_OFFLOAD, so cancelling after a worker death threw on null.postMessage.
  // The throw escaped through supersede(), which runs at the top of every
  // runJob — so starting a second tool while a job was in flight died before
  // the new job was created, and the button did nothing at all.
  //
  // There is nothing to cancel in that case anyway: the job already fell back
  // to this thread, where state.cancelled above is what stops it.
  const w = CAN_OFFLOAD ? worker() : null;
  if (w) w.postMessage({ type: "cancel", jobId });
}

// What the Cancel buttons call: stop everything still running, and keep the
// files that already finished — the user asked to stop, not to undo.
function cancelJob() {
  for (const jobId of _inflight.keys()) stop(jobId, false);
}

// Starting a tool supersedes whatever the last one was doing. Its partial
// output is dropped rather than downloaded, because nobody asked for it.
function supersede() {
  for (const jobId of _inflight.keys()) stop(jobId, true);
}

function toPayload(files) {
  return files.map(f => ({ id: f.id, name: f.name, blob: f.fileObj || null,
                           w: f.w, h: f.h, palette: f.palette }));
}

// Collects per-file results, then does the DOM-side work: PDF assembly,
// zipping when there is more than one output, and the download itself.
async function finish(op, settings, results, errors, cancelled, onDone) {
  const sizes = [];
  const entries = [];
  const failures = errors.slice();
  // Set only when the outputs were zipped: the bytes that actually landed.
  let packagedBytes = null;

  // Everything in here can throw — JSZip or jsPDF missing, a zip too big to
  // build. If it does, the caller still has to hear back: an onDone that never
  // fires leaves the UI spinning on a job that is already over.
  try {
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
      packagedBytes = await downloadZip(entries, single
        ? results[0].name.replace(/\.[^/.]+$/, "") + ".zip"
        : ZIP_NAME[op] || "pixl-tweak-export.zip");
    }
  } catch (err) {
    console.error("packaging the results failed:", err);
    failures.push({ id: null, name: null, fmt: null, tooBig: null, packaging: true });
  }

  onDone(failures.length === 0 && !cancelled, failures, sizes, cancelled, packagedBytes);
}

const ZIP_NAME = { convert: "pixl-tweak-export.zip", resize: "pixl-tweak-resized.zip",
                   compress: "pixl-tweak-compressed.zip", crop: "pixl-tweak-cropped.zip" };

function runJob(op, files, settings, onProgress, onDone) {
  supersede();                       // one tool at a time
  const jobId = ++_jobId;
  const state = { cancelled: false, discard: false };
  _inflight.set(jobId, state);
  const results = [], errors = [];

  const report = (fileId, pct, st) => { if (!state.cancelled) onProgress(fileId, pct, st); };

  // A superseded job hands back nothing: no downloads, no callback. The user
  // moved on, so its half-finished output is not something they asked for.
  const settle = async () => {
    _inflight.delete(jobId);
    if (state.discard) return;
    await finish(op, settings, results, errors, state.cancelled, onDone);
  };

  const runInline = () => {
    // Same engine, same order, just on this thread.
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
      await settle();
    })();
  };

  const w = CAN_OFFLOAD ? worker() : null;
  if (!w) { runInline(); return; }

  // Called if the worker dies before it reports back — a failed script load is
  // the likely one. If it produced nothing there is nothing to lose, so just
  // do the job here instead. If it was partway through, report rather than
  // redo the finished files.
  state.abort = () => {
    w.removeEventListener("message", onMsg);
    if (results.length === 0) { runInline(); return; }
    errors.push({ id: null, name: null, fmt: null, tooBig: null, packaging: true });
    settle();
  };

  const onMsg = async (e) => {
    const m = e.data;
    if (m.jobId !== jobId) return;
    if (m.type === "progress") report(m.fileId, m.pct, m.state);
    else if (m.type === "result") results.push(m);
    else if (m.type === "failed") errors.push({ id: m.fileId, name: m.name,
      // spread, not a hand-picked pair: naming the fields here is how a new
      // classification silently stopped crossing the worker boundary.
      ...classifyError({ message: m.detail }) });
    else if (m.type === "done") {
      w.removeEventListener("message", onMsg);
      state.cancelled = state.cancelled || m.cancelled;
      await settle();
    }
  };
  w.addEventListener("message", onMsg);
  w.postMessage({ type: "run", jobId, op, files: toPayload(files), settings });
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

// downloadBlob, downloadZip and buildPDF are deliberately not here: finish()
// is their only caller and exporting them was surface nothing used.
window.Processor = {
  // engine, re-exported so callers and tests reach one implementation
  canvasToBlob:       ENGINE.canvasToBlob,
  encodeToTargetSize: ENGINE.encodeToTargetSize,
  hasQualityKnob:     ENGINE.hasQualityKnob,
  classifyError:      ENGINE.classifyError,
  ICO_DEFAULT_SIZES:  ENGINE.ICO_DEFAULT_SIZES,
  resizeCanvas:       ENGINE.resizeCanvas,
  resizeTargetDims:   ENGINE.resizeTargetDims,
  posterizeCanvas:    ENGINE.posterizeCanvas,
  preShrink:          ENGINE.preShrink,
  encodeBMP:          ENGINE.encodeBMP,
  encodeICO:          ENGINE.encodeICO,
  getSourceCanvas:    f => ENGINE.sourceCanvas({ blob: f.fileObj || f.blob, w: f.w, h: f.h, palette: f.palette }),
  getOutputName:      ENGINE.outputName,
  // main thread only
  canEncode, loadImage,
  cancelJob,
  processConvert, processResize, processCompress, processCrop,
};
