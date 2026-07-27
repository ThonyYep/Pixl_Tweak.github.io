// worker.js — runs the pixel pipeline off the main thread.
//
// Everything heavy lives in engine.js, which is DOM-free precisely so it can
// be loaded here unchanged. This file is only the message plumbing: one job at
// a time, progress per file, and a cancel flag checked between files and
// between encode steps.

importScripts("engine.js");

// Per job, not global. A single shared flag meant any new run reset a pending
// cancel, and one cancel stopped every job in flight.
const cancelledJobs = new Set();

// Errors cross the postMessage boundary as codes, not Error objects, because
// only the message survives structured cloning intact.
function classify(err) {
  const msg = (err && err.message) || "";
  const fmt = /^UNSUPPORTED_OUTPUT:(\w+)/.exec(msg);
  const big = /^CANVAS_TOO_LARGE:(\S+)/.exec(msg);
  return { fmt: fmt ? fmt[1] : null, tooBig: big ? big[1] : null };
}

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === "cancel") { cancelledJobs.add(msg.jobId); return; }
  if (msg.type !== "run") return;

  const { jobId, op, files, settings } = msg;
  const stopped = () => cancelledJobs.has(jobId);

  // The whole loop sits in a try so "done" is posted no matter what. Anything
  // thrown out here — a malformed payload, a postMessage that will not clone —
  // would otherwise leave the main thread waiting on a job that is over.
  try {
  for (let i = 0; i < files.length; i++) {
    if (stopped()) break;
    const file = files[i];
    postMessage({ jobId, type: "progress", fileId: file.id, pct: 5 });
    try {
      const res = await ENGINE.runOne(file, op, settings, frac => {
        postMessage({ jobId, type: "progress", fileId: file.id,
                      pct: Math.min(95, 5 + Math.round(frac * 90)) });
      });
      if (stopped()) break;
      postMessage({
        jobId, type: "result", fileId: file.id, name: file.name,
        outputs: res.outputs, bytes: res.bytes, quality: res.quality, met: res.met,
      });
      postMessage({ jobId, type: "progress", fileId: file.id, pct: 100 });
    } catch (err) {
      postMessage({ jobId, type: "failed", fileId: file.id, name: file.name,
                    ...classify(err), detail: String(err && err.message || err) });
      postMessage({ jobId, type: "progress", fileId: file.id, pct: 100, state: "error" });
    }
  }
  } catch (err) {
    postMessage({ jobId, type: "failed", fileId: null, name: null,
                  fmt: null, tooBig: null, detail: String(err && err.message || err) });
  }

  const wasCancelled = stopped();
  cancelledJobs.delete(jobId);
  postMessage({ jobId, type: "done", cancelled: wasCancelled });
};
