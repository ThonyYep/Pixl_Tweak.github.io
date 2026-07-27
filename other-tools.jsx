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

function FileStrip({ files, selectedIdx, onSelect, onAdd }) {
  return (
    <div style={{ display:"flex", gap:6, paddingBottom:10, overflowX:"auto", alignItems:"center" }}>
      {files.map((f,i) => (
        <FilePill key={f.id} file={f} selected={i===selectedIdx} onClick={() => onSelect(i)} />
      ))}
      <button onClick={onAdd} title="Add images" style={{
        width:44, height:44, flexShrink:0, border:"1.5px dashed var(--line)",
        borderRadius:8, background:"transparent", cursor:"pointer", color:"var(--ink-3)",
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

function ClearAllButton({ onClear, label }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClear}
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
      className={"preset " + (active ? "on" : "")}
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
  const [w,           setW]           = React.useState(1280);
  const [h,           setH]           = React.useState(720);
  const [lock,        setLock]        = React.useState(true);
  const [fit,         setFit]         = React.useState(0);
  const [upscale,     setUpscale]     = React.useState(false);
  const [format,      setFormat]      = React.useState(DEFAULT_FORMAT);
  const [transparent, setTransparent] = React.useState(true);
  const [processing,  setProcessing]  = React.useState(false);
  const [errors,      setErrors]      = React.useState([]);
  const [origDims,    setOrigDims]    = React.useState({ w:0, h:0 });

  const idx          = Math.min(selectedIdx, Math.max(0, files.length - 1));
  const selectedFile = files[idx] || null;
  const fileUrl      = useFileUrl(selectedFile);

  // App decodes each file once and patches w/h onto it — follow that instead
  // of decoding a second time here.
  React.useEffect(() => {
    const iw = selectedFile?.w || 0, ih = selectedFile?.h || 0;
    setOrigDims({ w: iw, h: ih });
    if (iw > 0) { setW(iw); setH(ih); }
  }, [selectedFile?.id, selectedFile?.w]);

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
        <FileStrip files={files} selectedIdx={idx} onSelect={setSelectedIdx} onAdd={onAddFiles} />

        {files.length === 0 ? (
          <MiniDropZone onAdd={onAddFiles} onDrop={onDropFiles} />
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <div style={{ display:"flex" }}>
              <ClearAllButton onClear={onClearFiles} label={t.convert.clearAll} />
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
              <span style={{ color:"var(--coral-ink,var(--coral))", fontWeight:600 }}>{w > 0 ? `${w}×${h} px` : "—"}</span>
            </div>
          </div>
        )}
      </div>

      <aside className="rail" style={{ position:"static" }}>
        <h3>{t.resize.heading}</h3>

        <div className="field">
          <label>{t.resize.width} & {t.resize.height}</label>
          <div className="dim-row">
            <div className="num-input">
              <small>{t.resize.width}</small>
              <input type="text" value={w} onChange={e => {
                const v = +e.target.value || 0; setW(v);
                if (lock && h > 0) setH(Math.round(v * h / Math.max(1, w)));
              }} />
            </div>
            <button className={"link " + (lock?"on":"")} onClick={() => setLock(!lock)} title={t.resize.lock}>
              <Icon name={lock ? "lock" : "unlock"} size={16} />
            </button>
            <div className="num-input">
              <small>{t.resize.height}</small>
              <input type="text" value={h} onChange={e => {
                const v = +e.target.value || 0; setH(v);
                if (lock && w > 0) setW(Math.round(v * w / Math.max(1, h)));
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
              <button key={fmt} className={"preset " + (format===fmt?"on":"")}
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
          <button className="btn primary"
            disabled={processing || files.length === 0}
            style={{ justifyContent:"center" }}
            onClick={handleApply}>
            <Icon name="sparkle" size={16} />
            {processing ? "…" : t.resize.apply}
          </button>
        </div>
      </aside>
    </div>
  );
}

// ── Compress Tab ──────────────────────────────────────────────────────────────

function CompressTab({ t, files, onAddFiles, onDropFiles, onClearFiles }) {
  const [selectedIdx,  setSelectedIdx]  = React.useState(0);
  const [target,       setTarget]       = React.useState(0);
  const [quality,      setQuality]      = React.useState(72);
  const [format,       setFormat]       = React.useState("JPG");
  const [reduceColors, setReduceColors] = React.useState(false);
  const [maxColors,    setMaxColors]    = React.useState(null);
  const [processing,   setProcessing]   = React.useState(false);
  const [errors,       setErrors]       = React.useState([]);
  const [outBytes,     setOutBytes]     = React.useState(null);

  const idx          = Math.min(selectedIdx, Math.max(0, files.length - 1));
  const selectedFile = files[idx] || null;
  const fileUrl      = useFileUrl(selectedFile);

  const totalBefore = selectedFile ? selectedFile.size : 0;
  // Measured on completion. Guessing it from a per-format factor, as this used
  // to, produced a number that was never checked against the real encoder.
  const totalAfter  = outBytes;
  const savings     = totalBefore > 0 && outBytes != null
    ? Math.round((1 - outBytes / totalBefore) * 100) : null;

  // Any settings change invalidates the last measurement.
  React.useEffect(() => { setOutBytes(null); },
    [selectedFile?.id, format, quality, reduceColors, maxColors]);

  function handleStart() {
    if (!selectedFile) return;
    setProcessing(true);
    setErrors([]);
    setOutBytes(null);
    Processor.processCompress([selectedFile], { format, quality, reduceColors, maxColors },
      () => {}, (ok, errs, sizes) => {
        setErrors(errs || []);
        setOutBytes(sizes && sizes.length ? sizes[0].bytes : null);
        setProcessing(false);
      });
  }

  return (
    <div className="tool-stage">
      <div>
        <FileStrip files={files} selectedIdx={idx} onSelect={setSelectedIdx} onAdd={onAddFiles} />

        {files.length === 0 ? (
          <MiniDropZone onAdd={onAddFiles} onDrop={onDropFiles} />
        ) : (
          <>
            <div style={{ display:"flex", marginBottom:4 }}>
              <ClearAllButton onClear={onClearFiles} label={t.convert.clearAll} />
            </div>
            <div style={{
              minHeight:200, marginBottom:14, position:"relative",
              display:"flex", alignItems:"center", justifyContent:"center",
              background:"var(--surface-1,white)", borderRadius:"var(--radius-lg,12px)",
              border:"1.5px solid var(--line)", padding:10, boxSizing:"border-box",
            }}>
              {fileUrl
                ? <img src={fileUrl} alt="" style={{ maxWidth:"100%", maxHeight:220, objectFit:"contain", display:"block" }} />
                : selectedFile && <div style={{ width:"70%", maxWidth:320 }}><Thumb palette={selectedFile.palette} /></div>}
            </div>
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
                <div className="meta">1 {t.compress.filesSingular} · {format} q{quality}</div>
                <div className="barwrap"><div className="fill" style={{
                  width: totalAfter != null ? Math.max(4, totalAfter / totalBefore * 100) + "%" : "0%" }} /></div>
              </div>
            </div>
          </>
        )}
      </div>

      <aside className="rail" style={{ position:"static" }}>
        <h3>{t.compress.heading}</h3>

        <div className="field">
          <label>{t.compress.target}</label>
          <div className="preset-grid">
            {t.compress.targets.map((name, i) => (
              <button key={i} className={"preset " + (target===i?"on":"")}
                style={{ flexDirection:"column", gap:4, alignItems:"center", justifyContent:"center", padding:"8px 4px" }}
                onClick={() => { setTarget(i); setQuality([60,50,88,quality][i]); }}>
                <Icon name={["globe","mail","printer","star"][i]} size={16} />
                <span style={{ textAlign:"center", width:"100%" }}>{name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t.compress.outputFormat}</label>
          <div className="preset-grid" style={{ gridTemplateColumns:"1fr 1fr 1fr" }}>
            {["JPG","PNG","WEBP"].map(fmt => (
              <button key={fmt} className={"preset " + (format===fmt?"on":"")}
                onClick={() => { setFormat(fmt); if (fmt !== "PNG") setReduceColors(false); }}>
                <span style={{ textAlign:"center", width:"100%", fontFamily:"JetBrains Mono,monospace" }}>{fmt}</span>
              </button>
            ))}
          </div>
        </div>

        {format !== "PNG" && (
          <div className="field">
            <label>
              {t.compress.quality}
              <span style={{ float:"right", color:"var(--ink-3)", textTransform:"none", letterSpacing:0, fontWeight:500 }}>{quality}%</span>
            </label>
            <div className="slider-row">
              <input type="range" min="10" max="100" value={quality} onChange={e => setQuality(+e.target.value)} />
            </div>
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
                  {[256,128,64,32].map(n => (
                    <button key={n} className={"preset " + (maxColors===n?"on":"")}
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

        <ErrorNote t={t} errors={errors} />

        <div className="actions">
          <button className="btn primary"
            disabled={processing || !selectedFile || (reduceColors && maxColors === null)}
            style={{ justifyContent:"center" }}
            onClick={handleStart}>
            <Icon name="sparkle" size={16} />
            {processing ? "…" : t.compress.start}
          </button>
        </div>
      </aside>
    </div>
  );
}

// ── Crop Canvas with draggable handles ────────────────────────────────────────

const ASPECT_NUMS = [null, 1, 4/3, 16/9, 3/4, 9/16];

function CropCanvas({ ratio, ratioLabel, imageDims, onCropChange }) {
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
      const dx = (px - ox) / rect.width  * 100;
      const dy = (py - oy) / rect.height * 100;
      let { x, y, w, h } = { ...sc };
      const ib = imgBoundsRef.current;
      const targetR = asp ? asp / cAsp : null;

      if (type === "move") {
        x = Math.max(ib.x, Math.min(ib.x + ib.w - w, x + dx));
        y = Math.max(ib.y, Math.min(ib.y + ib.h - h, y + dy));
        updateCrop({ x, y, w, h });
        return;
      }

      // ── Raw resize per handle ─────────────────────────────────────────────
      if (type==="tl"||type==="ml"||type==="bl") { const nw=Math.max(5,w-dx); x+=w-nw; w=nw; }
      if (type==="tr"||type==="mr"||type==="br") { w=Math.max(5,w+dx); }
      if (type==="tl"||type==="tc"||type==="tr") { const nh=Math.max(5,h-dy); y+=h-nh; h=nh; }
      if (type==="bl"||type==="bc"||type==="br") { h=Math.max(5,h+dy); }

      if (targetR) {
        // ── Aspect-ratio enforcement with hard image-bounds limit ─────────────
        // Anchors: the edge that does NOT move for each handle type
        const rAnchor = sc.x + sc.w; // right  anchor (stays fixed for tl/ml/bl)
        const bAnchor = sc.y + sc.h; // bottom anchor (stays fixed for tl/tc/tr)
        const lAnchor = sc.x;        // left   anchor (stays fixed for tr/mr/br)
        const tAnchor = sc.y;        // top    anchor (stays fixed for bl/bc/br)
        const cxAnchor = sc.x + sc.w / 2; // horizontal center (tc/bc)
        const cyAnchor = sc.y + sc.h / 2; // vertical   center (ml/mr)

        if (type === "tc" || type === "bc") {
          // Height primary — width derives from ratio, centered horizontally
          const maxH = type === "tc" ? bAnchor - ib.y : ib.y + ib.h - tAnchor;
          const maxW = ib.w;
          h = Math.max(5, Math.min(h, maxH, maxW / targetR));
          w = h * targetR;
          x = cxAnchor - w / 2;
          y = type === "tc" ? bAnchor - h : tAnchor;
        } else if (type === "ml" || type === "mr") {
          // Width primary — height derives from ratio, centered vertically
          const maxW = type === "ml" ? rAnchor - ib.x : ib.x + ib.w - lAnchor;
          const maxHc = 2 * Math.min(cyAnchor - ib.y, ib.y + ib.h - cyAnchor);
          w = Math.max(5, Math.min(w, maxW, maxHc * targetR));
          h = w / targetR;
          x = type === "ml" ? rAnchor - w : lAnchor;
          y = cyAnchor - h / 2;
        } else {
          // Corner handles — width primary, each corner pins its opposite
          const maxW = (type==="tl"||type==="bl") ? rAnchor - ib.x : ib.x + ib.w - lAnchor;
          const maxH = (type==="tl"||type==="tr") ? bAnchor - ib.y : ib.y + ib.h - tAnchor;
          w = Math.max(5, Math.min(w, maxW, maxH * targetR));
          h = w / targetR;
          x = (type==="tl"||type==="bl") ? rAnchor - w : lAnchor;
          y = (type==="tl"||type==="tr") ? bAnchor - h : tAnchor;
        }
      } else {
        // ── Free mode — clamp to image bounds ────────────────────────────────
        if (x < ib.x)             { w -= ib.x - x;       x = ib.x; }
        if (y < ib.y)             { h -= ib.y - y;       y = ib.y; }
        if (x + w > ib.x + ib.w) { w  = ib.x + ib.w - x; }
        if (y + h > ib.y + ib.h) { h  = ib.y + ib.h - y; }
        w = Math.max(5, w);
        h = Math.max(5, h);
      }

      updateCrop({ x, y, w, h });
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
        style={{ position:"absolute", left:`${crop.x}%`, top:`${crop.y}%`, width:`${crop.w}%`, height:`${crop.h}%`, border:"1.5px solid rgba(255,255,255,.9)", boxSizing:"border-box", cursor:"move" }}
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
  const [origDims,    setOrigDims]    = React.useState({ w:0, h:0 });

  const idx          = Math.min(selectedIdx, Math.max(0, files.length - 1));
  const selectedFile = files[idx] || null;

  React.useEffect(() => {
    setOrigDims({ w: selectedFile?.w || 0, h: selectedFile?.h || 0 });
  }, [selectedFile?.id, selectedFile?.w]);
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
          onAdd={onAddFiles} />

        {files.length === 0 ? (
          <MiniDropZone onAdd={onAddFiles} onDrop={onDropFiles} />
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <div style={{ display:"flex" }}>
              <ClearAllButton onClear={onClearFiles} label={t.convert.clearAll} />
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
                <CropCanvas key={resetKey} ratio={ratio} ratioLabel={ratios[ratio]} imageDims={rotDims} onCropChange={setCropState} />
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
              <button key={i} className={"preset " + (ratio===i?"on":"")} onClick={() => setRatio(i)}>
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
            <input type="range" min="-180" max="180" step="1" value={rotation} onChange={e => setRotation(+e.target.value)} />
          </div>
          <div style={{ display:"flex", gap:6, marginTop:8 }}>
            {[-90,0,90,180].map(deg => (
              <button key={deg} className={"preset " + (rotation===deg?"on":"")}
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
          <button className="btn primary"
            disabled={processing || !selectedFile}
            style={{ justifyContent:"center" }}
            onClick={handleApply}>
            <Icon name="sparkle" size={16} />
            {processing ? "…" : t.crop.apply}
          </button>
        </div>
      </aside>
    </div>
  );
}

window.ResizeTab   = ResizeTab;
window.CompressTab = CompressTab;
window.CropTab     = CropTab;
