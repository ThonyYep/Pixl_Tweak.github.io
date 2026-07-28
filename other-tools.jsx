// other-tools.jsx — Resize, Compress, Crop tabs
// useFileUrl is defined in processor.jsx and available as window.useFileUrl

// ── Shared UI helpers ─────────────────────────────────────────────────────────

// These tabs have no per-file rows, so one line with the first reason and a
// count is enough — the console already has the full list.
function ErrorNote({ t, errors }) {
  if (!errors || errors.length === 0) return null;
  const reason = errorMessage(t, errors[0]);
  return (
    <div className="error-note">
      <Icon name="x" size={14} />
      <span>{reason}{errors.length > 1 ? ` (${errors.length})` : ""}</span>
    </div>
  );
}

// Before/after wipe. The control is a real <input type="range">, so dragging,
// focus and arrow keys come from the platform — Squoosh's equivalent handle is
// mouse-only. The thumb is collapsed to 1px so the track spans the full width
// and the drawn line lands exactly where the pointer is.
function CompareSlider({ before, after, label, beforeLabel, afterLabel }) {
  const [pos, setPos] = React.useState(50);
  return (
    <div className="wipe">
      <img src={before} alt="" className="wipe-img" />
      <div className="wipe-clip" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        <img src={after} alt="" className="wipe-img" />
      </div>
      <span className="wipe-tag left">{beforeLabel}</span>
      <span className="wipe-tag right">{afterLabel}</span>
      <input
        type="range" min="0" max="100" step="0.1" value={pos}
        className="wipe-range" aria-label={label}
        onChange={e => setPos(+e.target.value)} />
      <div className="wipe-line" style={{ left: pos + "%" }} aria-hidden>
        <span className="wipe-grip" />
      </div>
    </div>
  );
}

// The partner dimension when the aspect lock is on. Takes the ratio as an
// argument rather than reading the current fields, which is the whole point:
// deriving it from the fields meant each keystroke recomputed it from the
// previous one, so typing "800" into a 1600x900 walked 8x5 -> 80x50 -> 800x500.
function lockedPartner(value, ratio, editing) {
  if (!ratio) return null;
  return Math.max(1, Math.round(editing === "width" ? value / ratio : value * ratio));
}

// Where a ratio-locked crop rectangle lands when one handle is dragged.
//
// sc is the rectangle as it was when the drag started, ib the image bounds,
// both in container percentages; targetR is the wanted width/height in that
// same space. Every position is derived from an anchor — the edge the handle
// does not move — so the anchors have to come from sc, and they are clamped
// into the image first: an anchor even slightly outside was otherwise copied
// forward, and one bad rectangle stayed bad for the rest of the session.
//
// want is the size the pointer is asking for. It has to be separate from sc:
// taking the size from sc as well meant every mousemove recomputed the same
// rectangle from the same start dimensions, so with a ratio locked the resize
// handles did nothing at all — only Libre could resize.
//
// Lives out here so the test drives this function rather than a copy of it.
function ratioLockedRect(type, sc, ib, targetR, want) {
  const cx0 = v => Math.min(Math.max(v, ib.x), ib.x + ib.w);
  const cy0 = v => Math.min(Math.max(v, ib.y), ib.y + ib.h);
  const rA  = cx0(sc.x + sc.w),     bA  = cy0(sc.y + sc.h);
  const lA  = cx0(sc.x),            tA  = cy0(sc.y);
  const cxA = cx0(sc.x + sc.w / 2), cyA = cy0(sc.y + sc.h / 2);
  let { w, h } = want || sc, x, y;

  if (type === "tc" || type === "bc") {
    // Height leads, width follows the ratio, centred horizontally. The width
    // limit is the room around cxA, not the whole image: capping at ib.w let a
    // box near an edge grow straight out of the picture.
    const maxH  = type === "tc" ? bA - ib.y : ib.y + ib.h - tA;
    const maxWc = 2 * Math.min(cxA - ib.x, ib.x + ib.w - cxA);
    h = Math.max(5, Math.min(h, maxH, maxWc / targetR));
    w = h * targetR;
    x = cxA - w / 2;
    y = type === "tc" ? bA - h : tA;
  } else if (type === "ml" || type === "mr") {
    const maxW  = type === "ml" ? rA - ib.x : ib.x + ib.w - lA;
    const maxHc = 2 * Math.min(cyA - ib.y, ib.y + ib.h - cyA);
    w = Math.max(5, Math.min(w, maxW, maxHc * targetR));
    h = w / targetR;
    x = type === "ml" ? rA - w : lA;
    y = cyA - h / 2;
  } else {
    const maxW = (type === "tl" || type === "bl") ? rA - ib.x : ib.x + ib.w - lA;
    const maxH = (type === "tl" || type === "tr") ? bA - ib.y : ib.y + ib.h - tA;
    w = Math.max(5, Math.min(w, maxW, maxH * targetR));
    h = w / targetR;
    x = (type === "tl" || type === "bl") ? rA - w : lA;
    y = (type === "tl" || type === "tr") ? bA - h : tA;
  }

  // The 5-unit floor above can beat the room available, so nudge the finished
  // rectangle back inside. Moving it keeps the ratio; shrinking it would not.
  x = Math.min(Math.max(x, ib.x), ib.x + ib.w - w);
  y = Math.min(Math.max(y, ib.y), ib.y + ib.h - h);
  return { x, y, w, h };
}

// Where a crop rectangle lands after a nudge of dx/dy, both in container
// percentages. The pointer's dx/dy come from mouse travel, the keyboard's from
// an arrow key — one solver so the two input routes cannot clamp differently.
function nextRect(type, sc, ib, targetR, dx, dy) {
  let { x, y, w, h } = sc;

  if (type === "move") {
    return { x: Math.min(Math.max(x + dx, ib.x), ib.x + ib.w - w),
             y: Math.min(Math.max(y + dy, ib.y), ib.y + ib.h - h), w, h };
  }

  // ── Raw resize per handle ────────────────────────────────────────────────
  if (type==="tl"||type==="ml"||type==="bl") { const nw=Math.max(5,w-dx); x+=w-nw; w=nw; }
  if (type==="tr"||type==="mr"||type==="br") { w=Math.max(5,w+dx); }
  if (type==="tl"||type==="tc"||type==="tr") { const nh=Math.max(5,h-dy); y+=h-nh; h=nh; }
  if (type==="bl"||type==="bc"||type==="br") { h=Math.max(5,h+dy); }

  if (targetR) return ratioLockedRect(type, sc, ib, targetR, { w, h });

  // ── Free mode — clamp to image bounds ────────────────────────────────────
  if (x < ib.x)             { w -= ib.x - x;       x = ib.x; }
  if (y < ib.y)             { h -= ib.y - y;       y = ib.y; }
  if (x + w > ib.x + ib.w) { w  = ib.x + ib.w - x; }
  if (y + h > ib.y + ib.h) { h  = ib.y + ib.h - y; }
  return { x, y, w: Math.max(5, w), h: Math.max(5, h) };
}

function FilePill({ file, selected, onClick }) {
  const url = useFileUrl(file);
  return (
    <div onClick={onClick} title={file.name} style={{
      width:44, height:44, flexShrink:0, cursor:"pointer",
      borderRadius:8, overflow:"hidden",
      border: selected ? "2.5px solid var(--coral)" : "2px solid var(--line)",
      boxShadow: selected ? "0 0 0 3px rgba(106,163,255,.22)" : "none",
      background:"var(--surface-2)", transition:"border .15s,box-shadow .15s",
    }}>
      {url
        ? <img src={url} alt={file.name} style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }} />
        : <Thumb palette={file.palette} />}
    </div>
  );
}

function FileStrip({ files, selectedIdx, onSelect, onAdd, disabled }) {
  return (
    <div style={{ display:"flex", gap:6, paddingBottom:10, overflowX:"auto", alignItems:"center" }}>
      {files.map((f,i) => (
        <FilePill key={f.id} file={f} selected={i===selectedIdx} onClick={() => onSelect(i)} />
      ))}
      <button onClick={onAdd} disabled={disabled} title="Add images" style={{
        width:44, height:44, flexShrink:0, border:"1.5px dashed var(--line)",
        borderRadius:8, background:"transparent", cursor:"pointer", color:"var(--ink-3)",
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

function ClearAllButton({ onClear, label, disabled }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClear}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height:28, border:0, borderRadius:8, cursor:"pointer",
        display:"flex", alignItems:"center", gap:5,
        padding: hover ? "0 10px 0 8px" : "0 4px",
        background: hover ? "var(--coral-soft)" : "transparent",
        color: hover ? "var(--coral-ink)" : "var(--ink-3)",
        transition:"background .2s, color .2s, padding .2s", overflow:"hidden",
      }}>
      <Icon name="cancel-square" size={16} />
      <span style={{
        maxWidth: hover ? 160 : 0,
        opacity: hover ? 1 : 0,
        transition:"max-width .22s ease, opacity .18s ease",
        overflow:"hidden", fontSize:12, fontWeight:600, whiteSpace:"nowrap",
      }}>
        {label}
      </span>
    </button>
  );
}

function MiniDropZone({ onAdd, onDrop }) {
  const [hot, setHot] = React.useState(false);
  return (
    <div
      onClick={onAdd}
      onDragOver={e  => { e.preventDefault(); setHot(true);  }}
      onDragEnter={e => { e.preventDefault(); setHot(true);  }}
      onDragLeave={() => setHot(false)}
      onDrop={e => { e.preventDefault(); setHot(false); if (onDrop) onDrop(e.dataTransfer.files); }}
      style={{
        minHeight:220, cursor:"pointer",
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10,
        border:`2px dashed ${hot?"var(--coral)":"var(--line)"}`,
        borderRadius:"var(--radius-lg)",
        background: hot ? "rgba(106,163,255,.06)" : "var(--surface-2)",
        transition:"all .2s",
      }}>
      <Icon name="upload" size={28} />
      <span style={{ fontWeight:600, color:"var(--ink-2)", fontSize:14 }}>Drop images or click to browse</span>
      <span style={{ fontSize:12, color:"var(--ink-3)" }}>JPG · PNG · WEBP · and more</span>
    </div>
  );
}

// ── Resize Tab ────────────────────────────────────────────────────────────────

function FitButton({ label, tooltip, active, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      className={"preset " + (active ? "on" : "")} aria-pressed={active}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ flexDirection:"column", gap:0, alignItems:"center", justifyContent:"center", overflow:"hidden", width:"100%" }}>
      <span style={{ textAlign:"center", width:"100%" }}>{label}</span>
      <span style={{
        fontSize:10.5, fontWeight:400, textAlign:"center", lineHeight:1.35,
        maxHeight: hover ? 40 : 0,
        opacity: hover ? 1 : 0,
        marginTop: hover ? 3 : 0,
        overflow:"hidden",
        transition:"max-height .22s ease, opacity .18s ease, margin-top .22s ease",
        color: active ? "var(--coral-ink)" : "var(--ink-3)",
      }}>
        {tooltip}
      </span>
    </button>
  );
}

function ResizeTab({ t, files, onAddFiles, onDropFiles, onClearFiles }) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [w,           setW]           = React.useState(0);
  const [h,           setH]           = React.useState(0);
  const [lock,        setLock]        = React.useState(true);
  const [fit,         setFit]         = React.useState(0);
  const [upscale,     setUpscale]     = React.useState(false);
  const [format,      setFormat]      = React.useState(DEFAULT_FORMAT);
  const [transparent, setTransparent] = React.useState(true);
  const [processing,  setProcessing]  = React.useState(false);
  const [errors,      setErrors]      = React.useState([]);
  const idx          = Math.min(selectedIdx, Math.max(0, files.length - 1));
  const selectedFile = files[idx] || null;
  const fileUrl      = useFileUrl(selectedFile);

  // Read straight off the file. Held as its own state with a syncing effect,
  // this was a copy whose dependency list was narrower than the data it
  // copied — the kind of pair that drifts.
  const origDims = { w: selectedFile?.w || 0, h: selectedFile?.h || 0 };
  const measured = origDims.w > 0;
  // Derived, never mirrored: the same call runOne makes, so the preview cannot
  // drift from the file that comes out.
  const outDims = measured
    ? Processor.resizeTargetDims(origDims.w, origDims.h, w, h, fit, upscale)
    : { w, h };

  // Seed the output size once per file, when its size is actually known. App
  // decodes in the background, so on a big queue the fields used to sit at a
  // made-up 1280x720, accept a typed value, and then overwrite it when the
  // decode landed. The fields are disabled until then instead.
  const seeded = React.useRef(null);
  React.useEffect(() => {
    if (!measured) return;
    const stamp = `${selectedFile.id}:${origDims.w}x${origDims.h}`;
    if (seeded.current === stamp) return;
    seeded.current = stamp;
    setW(origDims.w); setH(origDims.h);
  }, [selectedFile?.id, origDims.w, origDims.h, measured]);

  // The source image's aspect ratio — fixed, so the lock stays honest however
  // the fields are edited.
  const ratio = origDims.h > 0 ? origDims.w / origDims.h : null;

  function handleApply() {
    setProcessing(true);
    setErrors([]);
    Processor.processResize(files, { w, h, fit, upscale, format, transparent },
      () => {}, (ok, errs) => { setErrors(errs || []); setProcessing(false); });
  }

  const fitTooltips = t.resize.fitTooltips || ["", "", ""];

  return (
    <div className="tool-stage">
      <div>
        <FileStrip files={files} selectedIdx={idx} onSelect={setSelectedIdx} onAdd={onAddFiles} disabled={processing} />

        {files.length === 0 ? (
          <MiniDropZone onAdd={onAddFiles} onDrop={onDropFiles} />
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <div style={{ display:"flex" }}>
              <ClearAllButton onClear={onClearFiles} label={t.convert.clearAll} disabled={processing} />
            </div>
            <div style={{
              position:"relative", overflow:"hidden",
              background:"var(--surface-1,white)", borderRadius:"var(--radius-lg,12px)",
              border:"1.5px solid var(--line)", width:"100%",
              display:"flex", alignItems:"center", justifyContent:"center",
              minHeight:220,
            }}>
              {fileUrl
                ? <img src={fileUrl} alt="" style={{ maxWidth:"100%", maxHeight:260, objectFit:"contain", display:"block", padding:10, boxSizing:"border-box" }} />
                : selectedFile && <div style={{ width:"100%", maxWidth:300 }}><Thumb palette={selectedFile.palette} /></div>}
            </div>
            <div style={{ fontSize:12, color:"var(--ink-3)", textAlign:"center", fontFamily:"JetBrains Mono,monospace" }}>
              {origDims.w > 0 ? `${origDims.w}×${origDims.h} px` : "—"}
              {" → "}
              {/* The engine's own answer, not the typed numbers. Echoing the
                  fields promised "1600×900 → 800×1200" for a run that produced
                  an 800×900 file. */}
              <span style={{ color:"var(--coral-ink,var(--coral))", fontWeight:600 }}>
                {w > 0 ? `${outDims.w}×${outDims.h} px` : "—"}</span>
            </div>
          </div>
        )}
      </div>

      <aside className="rail" style={{ position:"static" }}>
        <h3>{t.resize.heading}</h3>

        <div className="field">
          <label>{t.resize.width} & {t.resize.height}</label>
          <div className="dim-row">
            {/* The visible "Ancho"/"Alto" text sits in a <small>, so without
                these the fields announced as an unnamed "edit text, 800" and
                the lock read as a bare icon with no on/off state. */}
            <div className="num-input">
              <small>{t.resize.width}</small>
              <input type="text" inputMode="numeric" value={measured ? w : ""}
                     aria-label={t.resize.width}
                     disabled={!measured} placeholder="—" onChange={e => {
                const v = +e.target.value.replace(/\D/g, "") || 0; setW(v);
                if (lock && ratio) setH(lockedPartner(v, ratio, "width"));
              }} />
            </div>
            <button className={"link " + (lock?"on":"")} onClick={() => setLock(!lock)}
                    title={t.resize.lock} aria-label={t.resize.lock} aria-pressed={lock}>
              <Icon name={lock ? "lock" : "unlock"} size={16} />
            </button>
            <div className="num-input">
              <small>{t.resize.height}</small>
              <input type="text" inputMode="numeric" value={measured ? h : ""}
                     aria-label={t.resize.height}
                     disabled={!measured} placeholder="—" onChange={e => {
                const v = +e.target.value.replace(/\D/g, "") || 0; setH(v);
                if (lock && ratio) setW(lockedPartner(v, ratio, "height"));
              }} />
            </div>
          </div>
        </div>

        <div className="field">
          <label>{t.resize.fit}</label>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5 }}>
            {t.resize.fits.map((name, i) => (
              <FitButton key={i} label={name} tooltip={fitTooltips[i]} active={fit===i} onClick={() => setFit(i)} />
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t.resize.outputFormat}</label>
          <div className="preset-grid" style={{ gridTemplateColumns:"1fr 1fr 1fr" }}>
            {["JPG","PNG","WEBP"].map(fmt => (
              <button key={fmt} className={"preset " + (format===fmt?"on":"")} aria-pressed={format===fmt}
                onClick={() => setFormat(fmt)}>
                <span style={{ textAlign:"center", width:"100%", fontFamily:"JetBrains Mono,monospace" }}>{fmt}</span>
              </button>
            ))}
          </div>
        </div>

        {(format === "PNG" || format === "WEBP") && (
          <div className="field">
            <ToggleRow label={t.resize.transparent} on={transparent} onChange={setTransparent} />
          </div>
        )}

        <div className="field">
          <ToggleRow label={t.resize.upscale} on={upscale} onChange={setUpscale} />
        </div>

        {files.length > 1 && (
          <div style={{ fontSize:12, color:"var(--ink-3)", padding:"4px 0 2px" }}>
            {t.resize.appliesToAll.replace("{n}", files.length)}
          </div>
        )}

        <ErrorNote t={t} errors={errors} />

        <div className="actions">
          {processing
            ? <button className="btn ghost" style={{ justifyContent:"center" }}
                onClick={() => Processor.cancelJob()}>
                <Icon name="x" size={16} /> {t.convert.cancel}
              </button>
            : <button className="btn primary"
                disabled={files.length === 0}
                style={{ justifyContent:"center" }}
                onClick={handleApply}>
                <Icon name="sparkle" size={16} /> {t.resize.apply}
              </button>}
        </div>
      </aside>
    </div>
  );
}

// ── Compress Tab ──────────────────────────────────────────────────────────────

function CompressTab({ t, files, onAddFiles, onDropFiles, onClearFiles }) {
  const [selectedIdx,  setSelectedIdx]  = React.useState(0);
  const [quality,      setQuality]      = React.useState(72);
  const [format,       setFormat]       = React.useState("JPG");
  const [reduceColors, setReduceColors] = React.useState(false);
  const [maxColors,    setMaxColors]    = React.useState(null);
  const [processing,   setProcessing]   = React.useState(false);
  const [errors,       setErrors]       = React.useState([]);
  const [maxCompress,  setMaxCompress]  = React.useState(false);
  const [mode,         setMode]         = React.useState("quality");  // or "size"
  const [targetNum,    setTargetNum]    = React.useState(500);
  const [targetUnit,   setTargetUnit]   = React.useState("KB");
  const [result,       setResult]       = React.useState(null);

  const idx          = Math.min(selectedIdx, Math.max(0, files.length - 1));
  const selectedFile = files[idx] || null;
  const fileUrl      = useFileUrl(selectedFile);

  // PNG ignores the quality argument entirely, so there is no knob for a size
  // search to turn. Asked of the engine rather than restated here: the engine
  // is what actually skips the search, and a hardcoded list beside it is the
  // kind of pair that drifts.
  const sizeModeAvailable = Processor.hasQualityKnob(format);
  const inSizeMode = mode === "size" && sizeModeAvailable;
  const targetBytes = inSizeMode ? Math.max(1, targetNum) * (targetUnit === "MB" ? 1e6 : 1e3) : 0;

  // Which preset is lit is read off the quality, never stored beside it. As
  // separate state the two drifted immediately: "Web" was highlighted on load
  // while quality sat at 72, and moving the slider left the old chip lit.
  const PRESET_QUALITY = [60, 50, 88];
  const activePreset = PRESET_QUALITY.indexOf(quality);   // -1 lights "Custom"

  const totalBefore = selectedFile ? selectedFile.size : 0;
  // Measured on completion. Guessing it from a per-format factor, as this used
  // to, produced a number that was never checked against the real encoder.
  const totalAfter  = result ? result.bytes : null;
  const savings     = totalBefore > 0 && totalAfter != null
    ? Math.round((1 - totalAfter / totalBefore) * 100) : null;

  // Any settings change invalidates the last run; drop its preview URL too.
  React.useEffect(() => { setResult(null); },
    [selectedFile?.id, format, quality, reduceColors, maxColors, mode, targetNum, targetUnit, maxCompress]);
  React.useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  function handleStart() {
    if (!selectedFile) return;
    setProcessing(true);
    setErrors([]);
    setResult(null);
    Processor.processCompress([selectedFile],
      { format, quality, reduceColors, maxColors, targetBytes, maxCompress },
      () => {}, (ok, errs, sizes) => {
        setErrors(errs || []);
        const s = sizes && sizes[0];
        setResult(s ? { url: URL.createObjectURL(s.blob), bytes: s.bytes,
                        quality: s.quality, met: s.met } : null);
        setProcessing(false);
      });
  }

  return (
    <div className="tool-stage">
      <div>
        <FileStrip files={files} selectedIdx={idx} onSelect={setSelectedIdx} onAdd={onAddFiles} disabled={processing} />

        {files.length === 0 ? (
          <MiniDropZone onAdd={onAddFiles} onDrop={onDropFiles} />
        ) : (
          <>
            <div style={{ display:"flex", marginBottom:4 }}>
              <ClearAllButton onClear={onClearFiles} label={t.convert.clearAll} disabled={processing} />
            </div>
            <div style={{
              minHeight:200, marginBottom:14, position:"relative",
              display:"flex", alignItems:"center", justifyContent:"center",
              background:"var(--surface-1,white)", borderRadius:"var(--radius-lg,12px)",
              border:"1.5px solid var(--line)", padding:10, boxSizing:"border-box",
            }}>
              {fileUrl && result
                ? <CompareSlider before={fileUrl} after={result.url}
                    label={t.compress.compareHint}
                    beforeLabel={t.compress.before} afterLabel={t.compress.after} />
                : fileUrl
                ? <img src={fileUrl} alt="" style={{ maxWidth:"100%", maxHeight:220, objectFit:"contain", display:"block" }} />
                : selectedFile && <div style={{ width:"70%", maxWidth:320 }}><Thumb palette={selectedFile.palette} /></div>}
            </div>
            {result && (
              <div style={{ fontSize:12, color:"var(--ink-3)", textAlign:"center", marginTop:-8, marginBottom:10 }}>
                {result.met === false
                  ? t.compress.targetMissed
                      .replace("{target}", formatBytes(targetBytes))
                      .replace("{size}", formatBytes(result.bytes))
                  : inSizeMode
                  ? t.compress.targetMet
                      .replace("{size}", formatBytes(result.bytes))
                      .replace("{q}", result.quality)
                  : t.compress.compareHint}
              </div>
            )}
            <div className="compare">
              <div className="panel">
                <div className="lab">{t.compress.before}</div>
                <div className="num">{formatBytes(totalBefore)}</div>
                <div className="meta">1 {t.compress.filesSingular} · {t.compress.originalQuality}</div>
                <div className="barwrap"><div className="fill" style={{ width:"100%" }} /></div>
              </div>
              <div className="panel after">
                <div className="lab">{t.compress.after}</div>
                <div className="num">{totalAfter != null ? formatBytes(totalAfter) : "—"}</div>
                <div className="meta">
                  1 {t.compress.filesSingular} · {format} q{result ? result.quality : (inSizeMode ? "?" : quality)}
                </div>
                <div className="barwrap"><div className="fill" style={{
                  width: totalAfter != null ? Math.max(4, totalAfter / totalBefore * 100) + "%" : "0%" }} /></div>
              </div>
            </div>
          </>
        )}
      </div>

      <aside className="rail" style={{ position:"static" }}>
        <h3>{t.compress.heading}</h3>

        {/* Presets pick a quality, so they are meaningless in size mode where
            the search chooses it. Hidden rather than left inert. */}
        {!inSizeMode && (
          <div className="field">
            <label>{t.compress.target}</label>
            <div className="preset-grid">
              {t.compress.targets.map((name, i) => {
                const lit = i === (activePreset === -1 ? 3 : activePreset);
                return (
                  <button key={i} className={"preset " + (lit ? "on" : "")} aria-pressed={lit}
                    style={{ flexDirection:"column", gap:4, alignItems:"center", justifyContent:"center", padding:"8px 4px" }}
                    disabled={i === 3}
                    onClick={() => setQuality(PRESET_QUALITY[i])}>
                    <Icon name={["globe","mail","printer","star"][i]} size={16} />
                    <span style={{ textAlign:"center", width:"100%" }}>{name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="field">
          <label>{t.compress.outputFormat}</label>
          <div className="preset-grid" style={{ gridTemplateColumns:"1fr 1fr 1fr" }}>
            {["JPG","PNG","WEBP"].map(fmt => (
              <button key={fmt} className={"preset " + (format===fmt?"on":"")} aria-pressed={format===fmt}
                onClick={() => { setFormat(fmt); if (fmt !== "PNG") setReduceColors(false); }}>
                <span style={{ textAlign:"center", width:"100%", fontFamily:"JetBrains Mono,monospace" }}>{fmt}</span>
              </button>
            ))}
          </div>
        </div>

        {sizeModeAvailable && (
          <div className="field">
            <label>{t.compress.mode}</label>
            <div className="preset-grid" style={{ gridTemplateColumns:"1fr 1fr" }}>
              {[["quality", t.compress.modeQuality], ["size", t.compress.modeSize]].map(([id, name]) => (
                <button key={id} className={"preset " + (mode === id ? "on" : "")} aria-pressed={mode === id}
                  onClick={() => setMode(id)}>
                  <span style={{ textAlign:"center", width:"100%" }}>{name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {sizeModeAvailable && !inSizeMode && (
          <div className="field">
            <label>
              {t.compress.quality}
              <span style={{ float:"right", color:"var(--ink-3)", textTransform:"none", letterSpacing:0, fontWeight:500 }}>{quality}%</span>
            </label>
            <div className="slider-row">
              <input type="range" min="10" max="100" value={quality}
                     aria-label={t.compress.quality} onChange={e => setQuality(+e.target.value)} />
            </div>
          </div>
        )}

        {inSizeMode && (
          <div className="field">
            <label>{t.compress.targetSize}</label>
            <div style={{ display:"flex", gap:8 }}>
              <div className="num-input" style={{ flex:1 }}>
                <input type="text" inputMode="numeric" value={targetNum}
                  onChange={e => setTargetNum(Math.max(1, +e.target.value.replace(/\D/g, "") || 0))} />
              </div>
              <div className="preset-grid" style={{ gridTemplateColumns:"1fr 1fr", flex:"0 0 110px" }}>
                {["KB","MB"].map(u => (
                  <button key={u} className={"preset " + (targetUnit === u ? "on" : "")} aria-pressed={targetUnit === u}
                    onClick={() => setTargetUnit(u)}>
                    <span style={{ textAlign:"center", width:"100%", fontFamily:"JetBrains Mono,monospace" }}>{u}</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop:6, fontSize:11.5, color:"var(--ink-3)" }}>{t.compress.targetHint}</div>
          </div>
        )}

        {format === "PNG" && (
          <div className="field">
            <ToggleRow label={t.compress.reduceColors} on={reduceColors} onChange={setReduceColors} />
            <div style={{ fontSize:11.5, color:"var(--ink-3)", marginTop:4 }}>{t.compress.reduceColorsHint}</div>
            {reduceColors && (
              <div style={{ marginTop:12 }}>
                <label style={{ display:"block", fontSize:12, fontWeight:600, color:"var(--ink-2)", letterSpacing:".04em", textTransform:"uppercase", marginBottom:8 }}>
                  {t.compress.maxColors}
                </label>
                <div className="preset-grid" style={{ gridTemplateColumns:"repeat(4,1fr)" }}>
                  {/* 256 is gone: it means 256 levels per channel, which is
                      what 8-bit already is, so it changed nothing at all. */}
                  {[128,64,32,16].map(n => (
                    <button key={n} className={"preset " + (maxColors===n?"on":"")} aria-pressed={maxColors===n}
                      onClick={() => setMaxColors(maxColors===n ? null : n)}>
                      <span style={{ textAlign:"center", width:"100%", fontFamily:"JetBrains Mono,monospace", fontSize:11 }}>{n}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="summary">
          <div className="summary-top">
            <span className="lab">{t.compress.savings}</span>
            {savings != null && <span className="summary-pill">−{savings}%</span>}
          </div>
          <div className="summary-num">
            {savings != null ? savings : "—"}{savings != null && <span className="unit">%</span>}
          </div>
          <div className="summary-bar">
            <div className="summary-bar-fill" style={{ width: Math.max(0, savings || 0) + "%" }} />
          </div>
          <div className="summary-foot">
            <span>{formatBytes(totalBefore)}</span>
            {savings != null && <>
              <span className="arr">→</span>
              <span className="emph">{formatBytes(totalAfter)}</span>
              <span style={{ marginLeft:"auto" }}>{formatBytes(totalBefore - totalAfter)} {t.common.saved}</span>
            </>}
          </div>
        </div>

        <div className="field">
          <ToggleRow label={t.convert.maxCompress} on={maxCompress} onChange={setMaxCompress} />
          <div style={{ fontSize:11.5, color:"var(--ink-3)", paddingTop:6, lineHeight:1.45 }}>
            {t.convert.maxCompressHint}
          </div>
        </div>

        <ErrorNote t={t} errors={errors} />

        <div className="actions">
          {processing
            ? <button className="btn ghost" style={{ justifyContent:"center" }}
                onClick={() => Processor.cancelJob()}>
                <Icon name="x" size={16} /> {t.convert.cancel}
              </button>
            : <button className="btn primary"
                disabled={!selectedFile || (reduceColors && maxColors === null)}
                style={{ justifyContent:"center" }}
                onClick={handleStart}>
                <Icon name="sparkle" size={16} /> {t.compress.start}
              </button>}
        </div>
      </aside>
    </div>
  );
}

// ── Crop Canvas with draggable handles ────────────────────────────────────────

const ASPECT_NUMS = [null, 1, 4/3, 16/9, 3/4, 9/16];

function CropCanvas({ ratio, ratioLabel, imageDims, onCropChange, keyboardLabel }) {
  const containerRef  = React.useRef(null);
  const imgBoundsRef  = React.useRef({ x:0, y:0, w:100, h:100 }); // image position in % of container
  const [crop, setCrop] = React.useState({ x:0, y:0, w:100, h:100 });

  // The overlay works in container percentages because that is what it is
  // positioned with, but consumers want percentages of the image itself —
  // reporting container-relative numbers cropped a few percent off every edge.
  function updateCrop(c) {
    setCrop(c);
    if (!onCropChange) return;
    const b = imgBoundsRef.current;
    if (!b.w || !b.h) return;
    onCropChange({
      x: (c.x - b.x) / b.w * 100,
      y: (c.y - b.y) / b.h * 100,
      w: c.w / b.w * 100,
      h: c.h / b.h * 100,
    });
  }

  // Recompute image bounds and reset crop whenever imageDims or ratio changes
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const { width: cW, height: cH } = el.getBoundingClientRect();
      if (!cW || !cH) return;

      // Where does the image sit inside the container (objectFit:contain)?
      let bx = 0, by = 0, bw = 100, bh = 100;
      if (imageDims?.w && imageDims?.h) {
        const scale = Math.min(cW / imageDims.w, cH / imageDims.h);
        const dw = imageDims.w * scale, dh = imageDims.h * scale;
        bx = (cW - dw) / 2 / cW * 100;
        by = (cH - dh) / 2 / cH * 100;
        bw = dw / cW * 100;
        bh = dh / cH * 100;
      }
      imgBoundsRef.current = { x: bx, y: by, w: bw, h: bh };

      const asp = ASPECT_NUMS[ratio];
      if (!asp) {
        // Free — crop = full image bounds
        updateCrop({ x: bx, y: by, w: bw, h: bh });
      } else {
        // Aspect ratio — fit ratio within image bounds
        const cAsp = cW / cH;
        const targetR = asp / cAsp;        // desired w%/h% ratio
        let cw, ch;
        if (targetR >= bw / bh) { cw = bw * 0.98; ch = cw / targetR; }
        else                    { ch = bh * 0.98; cw = ch * targetR; }
        updateCrop({ x: bx + (bw - cw) / 2, y: by + (bh - ch) / 2, w: cw, h: ch });
      }
    });
  }, [imageDims?.w, imageDims?.h, ratio]);

  // Extract x/y from both mouse and touch events
  const getPoint = ev => {
    const src = ev.touches ? ev.touches[0] : ev;
    return { x: src.clientX, y: src.clientY };
  };

  const startDrag = (e, type) => {
    e.preventDefault(); e.stopPropagation();
    const el = containerRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const cAsp = rect.width / rect.height;
    const asp  = ASPECT_NUMS[ratio];
    const { x: ox, y: oy } = getPoint(e);
    const sc = { ...crop };

    const onMove = ev => {
      if (ev.cancelable) ev.preventDefault();
      const { x: px, y: py } = getPoint(ev);
      updateCrop(nextRect(type, sc, imgBoundsRef.current, asp ? asp / cAsp : null,
                          (px - ox) / rect.width  * 100,
                          (py - oy) / rect.height * 100));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend",  onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend",  onUp);
  };

  // The eight handles are pointer-only, which left framing — the one thing this
  // tool is for — impossible without a mouse. Arrows move the box, Shift+arrows
  // resize it from the bottom-right, the same corner the "br" handle drags.
  // Both go through nextRect, so the keyboard obeys the same bounds as a drag.
  const KEY_DELTA = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };

  function onKeyDown(e) {
    const d = KEY_DELTA[e.key];
    if (!d) return;
    const el = containerRef.current; if (!el) return;
    e.preventDefault();                 // otherwise the page scrolls instead
    const rect = el.getBoundingClientRect();
    const asp  = ASPECT_NUMS[ratio];
    const targetR = asp ? asp / (rect.width / rect.height) : null;
    const step = e.altKey ? 0.5 : 2;    // Alt for a finer nudge
    let [dx, dy] = [d[0] * step, d[1] * step];
    // With a ratio locked the corner solver takes its size from the width, so
    // a vertical key would otherwise do nothing. Convert it to the width
    // change that produces the same height change.
    if (e.shiftKey && targetR && dx === 0) { dx = dy * targetR; dy = 0; }
    updateCrop(nextRect(e.shiftKey ? "br" : "move", crop, imgBoundsRef.current, targetR, dx, dy));
  }

  const hs = { position:"absolute", width:10, height:10, background:"white", border:"1.5px solid rgba(0,0,0,.35)", borderRadius:2, zIndex:2 };
  const br = "var(--radius-lg,12px)";

  // Shared handler — fires on both mouse and touch
  const drag = (type) => (e) => { e.stopPropagation(); startDrag(e, type); };

  return (
    <div ref={containerRef} style={{ position:"absolute", inset:0, userSelect:"none", touchAction:"none" }}>

      {/* ── Dark overlay (clipped with rounded corners, no handles here) ── */}
      <div style={{ position:"absolute", inset:0, borderRadius:br, overflow:"hidden", pointerEvents:"none" }}>
        <div style={{ position:"absolute", top:0, left:0, right:0, height:`${crop.y}%`, background:"rgba(0,0,0,.52)" }} />
        <div style={{ position:"absolute", top:`${crop.y+crop.h}%`, left:0, right:0, bottom:0, background:"rgba(0,0,0,.52)" }} />
        <div style={{ position:"absolute", top:`${crop.y}%`, left:0, width:`${crop.x}%`, height:`${crop.h}%`, background:"rgba(0,0,0,.52)" }} />
        <div style={{ position:"absolute", top:`${crop.y}%`, left:`${crop.x+crop.w}%`, right:0, height:`${crop.h}%`, background:"rgba(0,0,0,.52)" }} />
      </div>

      {/* ── Crop selection box + handles (not clipped, handles can bleed) ── */}
      <div
        tabIndex={0}
        role="group"
        aria-label={keyboardLabel}
        className="crop-box"
        style={{ position:"absolute", left:`${crop.x}%`, top:`${crop.y}%`, width:`${crop.w}%`, height:`${crop.h}%`, border:"1.5px solid rgba(255,255,255,.9)", boxSizing:"border-box", cursor:"move" }}
        onKeyDown={onKeyDown}
        onMouseDown={e => startDrag(e,"move")} onTouchStart={e => startDrag(e,"move")}>
        {[33.33,66.66].map(p => (
          <React.Fragment key={p}>
            <div style={{ position:"absolute", left:`${p}%`, top:0, bottom:0, width:1, background:"rgba(255,255,255,.2)", pointerEvents:"none" }} />
            <div style={{ position:"absolute", top:`${p}%`, left:0, right:0, height:1, background:"rgba(255,255,255,.2)", pointerEvents:"none" }} />
          </React.Fragment>
        ))}
        <div style={{...hs, top:-5,   left:-5,               cursor:"nwse-resize"}} onMouseDown={drag("tl")} onTouchStart={drag("tl")} />
        <div style={{...hs, top:-5,   left:"calc(50% - 5px)",cursor:"ns-resize"}}   onMouseDown={drag("tc")} onTouchStart={drag("tc")} />
        <div style={{...hs, top:-5,   right:-5,              cursor:"nesw-resize"}} onMouseDown={drag("tr")} onTouchStart={drag("tr")} />
        <div style={{...hs, top:"calc(50% - 5px)", left:-5,  cursor:"ew-resize"}}   onMouseDown={drag("ml")} onTouchStart={drag("ml")} />
        <div style={{...hs, top:"calc(50% - 5px)", right:-5, cursor:"ew-resize"}}   onMouseDown={drag("mr")} onTouchStart={drag("mr")} />
        <div style={{...hs, bottom:-5,left:-5,               cursor:"nesw-resize"}} onMouseDown={drag("bl")} onTouchStart={drag("bl")} />
        <div style={{...hs, bottom:-5,left:"calc(50% - 5px)",cursor:"ns-resize"}}   onMouseDown={drag("bc")} onTouchStart={drag("bc")} />
        <div style={{...hs, bottom:-5,right:-5,              cursor:"nwse-resize"}} onMouseDown={drag("br")} onTouchStart={drag("br")} />
        <div style={{ position:"absolute", left:"50%", top:"50%", transform:"translate(-50%,-50%)", width:20, height:20, borderRadius:"50%", background:"rgba(255,255,255,.15)", border:"1.5px solid rgba(255,255,255,.7)", pointerEvents:"none" }} />
        <div style={{ position:"absolute", bottom:6, right:6, background:"rgba(0,0,0,.6)", color:"white", padding:"2px 7px", borderRadius:5, fontFamily:"JetBrains Mono,monospace", fontSize:10.5, fontWeight:600, pointerEvents:"none" }}>
          {ratioLabel}
        </div>
      </div>
    </div>
  );
}

// ── Crop Tab ──────────────────────────────────────────────────────────────────

function CropTab({ t, files, onAddFiles, onDropFiles, onClearFiles }) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [ratio,       setRatio]       = React.useState(0);
  const [rotation,    setRotation]    = React.useState(0);
  const [flipH,       setFlipH]       = React.useState(false);
  const [flipV,       setFlipV]       = React.useState(false);
  const [resetKey,    setResetKey]    = React.useState(0);
  const [cropState,   setCropState]   = React.useState({ x:10, y:10, w:80, h:80 });
  const [processing,  setProcessing]  = React.useState(false);
  const [errors,      setErrors]      = React.useState([]);
  const idx          = Math.min(selectedIdx, Math.max(0, files.length - 1));
  const selectedFile = files[idx] || null;

  // Derived, not mirrored. As state with a syncing effect this could lag the
  // file it described, and here it feeds the rotated bounding box the crop
  // overlay is laid out against.
  const origDims = { w: selectedFile?.w || 0, h: selectedFile?.h || 0 };
  const fileUrl      = useFileUrl(selectedFile);
  const ratios       = t.crop.ratios;

  // The crop box has to sit on the rotated image, because that is what gets
  // cropped. That means knowing the rotated bounding box and how much the
  // preview has to shrink so it still fits the frame.
  const frameRef = React.useRef(null);
  const [frame, setFrame] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setFrame({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [files.length === 0]);

  const rad     = rotation * Math.PI / 180;
  const cosA    = Math.abs(Math.cos(rad)), sinA = Math.abs(Math.sin(rad));
  const rotDims = origDims.w > 0
    ? { w: Math.round(origDims.w * cosA + origDims.h * sinA),
        h: Math.round(origDims.w * sinA + origDims.h * cosA) }
    : { w: 0, h: 0 };
  // objectFit:contain sizes the image before the rotation is applied, so a
  // rotated image overflows the frame and gets clipped. Shrink to compensate.
  const fitScale = (frame.w && frame.h && origDims.w && rotDims.w)
    ? Math.min(1, Math.min(frame.w / rotDims.w,  frame.h / rotDims.h)
                / Math.min(frame.w / origDims.w, frame.h / origDims.h))
    : 1;

  function handleReset() {
    setRotation(0); setFlipH(false); setFlipV(false); setRatio(0);
    setResetKey(k => k + 1);
  }

  function handleApply() {
    if (!selectedFile) return;
    setProcessing(true);
    setErrors([]);
    Processor.processCrop([selectedFile], { crop: cropState, rotation, flipH, flipV },
      () => {}, (ok, errs) => { setErrors(errs || []); setProcessing(false); });
  }

  return (
    <div className="tool-stage">
      <div>
        <FileStrip
          files={files} selectedIdx={idx}
          onSelect={i => { setSelectedIdx(i); setResetKey(k => k + 1); }}
          onAdd={onAddFiles} disabled={processing} />

        {files.length === 0 ? (
          <MiniDropZone onAdd={onAddFiles} onDrop={onDropFiles} />
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <div style={{ display:"flex" }}>
              <ClearAllButton onClear={onClearFiles} label={t.convert.clearAll} disabled={processing} />
            </div>
            {/* 12px padding gives crop handles room to render outside the image edge */}
            <div style={{ padding:12 }}>
              <div ref={frameRef} style={{ position:"relative", minHeight:360, overflow:"visible", borderRadius:"var(--radius-lg,12px)", border:"1.5px solid var(--line)" }}>
                {/* Image layer — clipped to rounded corners so no bleed-out */}
                <div style={{ position:"absolute", inset:0, borderRadius:"var(--radius-lg,12px)", overflow:"hidden", background:"var(--surface-1,white)" }}>
                  {fileUrl ? (
                    <img src={fileUrl} alt="" style={{
                      position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"contain",
                      transform:`rotate(${rotation}deg) scale(${(flipH?-1:1)*fitScale},${(flipV?-1:1)*fitScale})`,
                      transition:"transform .35s cubic-bezier(.32,1.6,.42,1)",
                    }} />
                  ) : selectedFile ? (
                    <div style={{
                      position:"absolute", inset:0,
                      background:`linear-gradient(135deg,${selectedFile.palette[0]} 0%,${selectedFile.palette[1]} 50%,${selectedFile.palette[2]} 100%)`,
                      transform:`rotate(${rotation}deg) scale(${(flipH?-1:1)*fitScale},${(flipV?-1:1)*fitScale})`,
                      transition:"transform .35s cubic-bezier(.32,1.6,.42,1)",
                    }} />
                  ) : null}
                </div>
                {/* Crop overlay — NOT clipped so handles can bleed outside */}
                <CropCanvas key={resetKey} ratio={ratio} ratioLabel={ratios[ratio]} imageDims={rotDims}
                            onCropChange={setCropState} keyboardLabel={t.crop.boxLabel} />
              </div>
            </div>
            {/* Before → after dimensions */}
            <div style={{ fontSize:12, color:"var(--ink-3)", textAlign:"center", fontFamily:"JetBrains Mono,monospace" }}>
              {origDims.w > 0 ? `${origDims.w}×${origDims.h} px` : "—"}
              {" → "}
              <span style={{ color:"var(--coral-ink,var(--coral))", fontWeight:600 }}>
                {rotDims.w > 0
                  ? `${Math.round(cropState.w / 100 * rotDims.w)}×${Math.round(cropState.h / 100 * rotDims.h)} px`
                  : "—"}
              </span>
            </div>
          </div>
        )}
      </div>

      <aside className="rail" style={{ position:"static" }}>
        <h3>{t.crop.heading}</h3>

        <div className="field">
          <label>{t.crop.ratio}</label>
          <div className="preset-grid" style={{ gridTemplateColumns:"1fr 1fr 1fr" }}>
            {ratios.map((r, i) => (
              <button key={i} className={"preset " + (ratio===i?"on":"")} aria-pressed={ratio===i} onClick={() => setRatio(i)}>
                <span style={{ textAlign:"center", width:"100%", fontFamily:"JetBrains Mono,monospace" }}>{r}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>
            {t.crop.rotate}
            <span style={{ float:"right", color:"var(--ink-3)", textTransform:"none", letterSpacing:0, fontWeight:500 }}>{rotation}°</span>
          </label>
          <div className="slider-row">
            <input type="range" min="-180" max="180" step="1" value={rotation}
                   aria-label={t.crop.rotate} onChange={e => setRotation(+e.target.value)} />
          </div>
          <div style={{ display:"flex", gap:6, marginTop:8 }}>
            {[-90,0,90,180].map(deg => (
              <button key={deg} className={"preset " + (rotation===deg?"on":"")} aria-pressed={rotation===deg}
                style={{ flex:1, justifyContent:"center" }}
                onClick={() => setRotation(deg)}>
                <span style={{ width:"100%", textAlign:"center", fontFamily:"JetBrains Mono,monospace" }}>{deg}°</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <ToggleRow label={t.crop.flipH} on={flipH} onChange={setFlipH} />
          <ToggleRow label={t.crop.flipV} on={flipV} onChange={setFlipV} />
        </div>

        <ErrorNote t={t} errors={errors} />

        <div className="actions">
          <button className="btn ghost" onClick={handleReset}>
            <Icon name="undo" size={14} /> {t.crop.reset}
          </button>
          {processing
            ? <button className="btn ghost" style={{ justifyContent:"center" }}
                onClick={() => Processor.cancelJob()}>
                <Icon name="x" size={16} /> {t.convert.cancel}
              </button>
            : <button className="btn primary"
                disabled={!selectedFile}
                style={{ justifyContent:"center" }}
                onClick={handleApply}>
                <Icon name="sparkle" size={16} /> {t.crop.apply}
              </button>}
        </div>
      </aside>
    </div>
  );
}

window.lockedPartner = lockedPartner;
window.ratioLockedRect = ratioLockedRect;
window.ResizeTab   = ResizeTab;
window.CompressTab = CompressTab;
window.CropTab     = CropTab;
