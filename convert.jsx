// convert.jsx — Convert tab content + file list + settings rail

const SAMPLE_FILES = [
  { id: 1, name: "sunset-dunes-2024.png",    ext: "PNG",  size: 4_820_000, w: 4032, h: 3024, palette: ["#ff8a5b","#ffd16e","#7a4a8a"] },
  { id: 2, name: "studio-portrait-01.jpeg",  ext: "JPEG", size: 6_140_000, w: 3000, h: 4000, palette: ["#f4d6c0","#c98668","#3a2a2a"] },
  { id: 3, name: "logo-stamp-final.svg",     ext: "SVG",  size: 62_400,    w: 512,  h: 512,  palette: ["#1f2a4a","#ff7a59","#fbf3e4"] },
  { id: 4, name: "lake-pano-morning.gif",    ext: "GIF",  size: 22_900_000,w: 7680, h: 2160, palette: ["#a9d4e8","#f8e4b5","#3c628a"] },
  { id: 5, name: "product-mock-back.webp",   ext: "WEBP", size: 480_000,   w: 1600, h: 1600, palette: ["#bfa4ff","#3a2f64","#fcd3e2"] },
];

// Output formats we can actually encode. GIF and TIFF are absent on purpose:
// canvas can't produce either, and the old code shipped WEBP/PNG bytes under
// a .gif/.tif name. Adding them back means bundling a real encoder.
// AVIF is absent for the same reason GIF and TIFF are: no browser can encode
// it from a canvas, so the option could only ever fail. It stays in
// ALL_FORMATS below because decoding AVIF works fine.
const FORMATS     = ["PNG","JPG","WEBP","BMP","PDF","ICO"];
// Input formats a browser can decode. Camera RAW (CR2, NEF, DNG…), PSD and EPS
// are not among them — listing them only produced failed conversions.
const ALL_FORMATS = ["AVIF","BMP","GIF","ICO","JPG","JPEG","PNG","SVG","WEBP"];

// Probed once at load — see Processor.canEncode.
const DEFAULT_FORMAT = Processor.canEncode("image/webp") ? "WEBP" : "JPG";

// Formats that support a quality/compression slider
const FMT_HAS_QUALITY = new Set(["JPG","WEBP","PDF"]);
// Formats that support transparency
const FMT_HAS_ALPHA   = new Set(["PNG","WEBP"]);
// 256 is the ceiling: an ICO directory entry stores width/height in one byte,
// with 0 meaning 256. 512 cannot be expressed, so offering it only produced a
// size that got silently dropped.
const ICO_SIZES  = [8,16,24,32,48,64,128,256];

// One switch and its label, wired together. A real <button role="switch">
// rather than a <div onClick>: reachable with Tab, activated by Space and
// Enter with no key handler of our own, and announced as a switch instead of
// as a stray piece of text.
function ToggleRow({ label, on, onChange }) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={!!on}
        aria-label={label}
        className={"toggle " + (on ? "on" : "")}
        onClick={() => onChange(!on)}>
        <span className="dot" />
      </button>
    </div>
  );
}

// Spanish needs the verb to agree, not just the noun, so one file gets its own
// sentence rather than "Se convirtieron 1 imágenes".
function doneMessage(t, n, grew, bytes) {
  const key = (grew ? "doneGrewSub" : "doneSub") + (n === 1 ? "One" : "");
  return t.convert[key]
    .replace("{n}", n)
    .replace(grew ? "{grew}" : "{saved}", formatBytes(bytes));
}

// Three distinct failures, three distinct messages — "unsupported format" for
// an image that is simply too big sends the user hunting in the wrong place.
function errorMessage(t, e) {
  if (e.tooBig) return t.convert.errTooBig.replace("{dims}", e.tooBig);
  if (e.fmt)    return t.convert.errFormat.replace("{fmt}", e.fmt);
  return t.convert.errRead;
}

function formatBytes(n) {
  if (n >= 10_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + " MB";
  if (n >= 1_000)      return (n / 1_000).toFixed(2).replace(/\.?0+$/, "") + " KB";
  if (n > 0)           return "<1 KB";
  return "0 KB";
}

// Shows real image when the file was uploaded, gradient SVG for sample files
function ThumbOrImg({ file }) {
  const url = useFileUrl(file);
  if (url) return <img src={url} alt={file.name} style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />;
  return <Thumb palette={file.palette} />;
}

function Thumb({ palette }) {
  const [a, b, c] = palette;
  return (
    <svg viewBox="0 0 60 60" preserveAspectRatio="none">
      <defs>
        <linearGradient id={"g" + a + b} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor={a} />
          <stop offset="100%" stopColor={b} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="60" height="60" fill={"url(#g" + a + b + ")"} />
      <circle cx="18" cy="22" r="6" fill="#fff8ec" opacity=".7" />
      <path d="M0 50 L20 32 L34 44 L48 28 L60 40 L60 60 L0 60 Z" fill={c} opacity=".7" />
    </svg>
  );
}

// There is no size to show until the file has actually been encoded — the old
// per-format guess factors were invented numbers shown as fact.
function FileRow({ file, targetFmt, progress, state, error, outBytes, onRemove }) {
  const failed = state === "error";
  return (
    <div className={"file-row " + (state || "")}>
      <div className="thumb"><ThumbOrImg file={file} /></div>
      <div className="info">
        <div className="name">{file.name}</div>
        <div className="stats">
          <span className="from">{file.ext}</span>
          <span className="arrow">→</span>
          <span className="to">{targetFmt}</span>
          {file.w > 0 && <><span>·</span><span>{file.w}×{file.h}</span></>}
        </div>
      </div>
      <div className="size">
        <span>{formatBytes(file.size)}</span>
        {failed && <span className="new err">{error}</span>}
        {!failed && outBytes != null && (
          <span className="new" style={{ fontWeight:"500" }}>{formatBytes(outBytes)}</span>
        )}
      </div>
      <button className="x" onClick={() => onRemove(file.id)} aria-label="Remove">
        <Icon name="x" size={14} />
      </button>
      <div className="progress-track">
        <div className="fill" style={{ width: (state === "done" ? 100 : progress || 0) + "%" }} />
      </div>
    </div>
  );
}

function ConvertTab({ t, files, setFiles, mode, setMode, settings, setSettings, onStart, onAddFiles }) {
  const [clearHover, setClearHover] = React.useState(false);
  const totalSize = files.reduce((a, f) => a + f.size, 0);

  const [progress, setProgress] = React.useState({});
  const [errors,   setErrors]   = React.useState([]);
  const [outSizes, setOutSizes] = React.useState(null);   // measured, set on completion
  const [stopped,  setStopped]  = React.useState(false);
  const [elapsed,  setElapsed]  = React.useState(0);
  const timerRef = React.useRef(null);

  // Elapsed-time counter
  React.useEffect(() => {
    if (mode === "converting") {
      setElapsed(0);
      const start = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000));
      }, 500);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [mode]);

  // Real processing via Processor
  React.useEffect(() => {
    if (mode !== "converting") return;
    setProgress({});
    setErrors([]);
    setOutSizes(null);
    setStopped(false);
    let cancelled = false;

    Processor.processConvert(
      files,
      settings,
      (fileId, pct, state) => {
        if (cancelled) return;
        setProgress(prev => ({ ...prev, [fileId]: { v: pct, state: state || (pct >= 100 ? "done" : "going") } }));
      },
      (ok, errs, sizes, wasCancelled) => {
        if (cancelled) return;
        setErrors(errs || []);
        setOutSizes(sizes || []);
        setStopped(!!wasCancelled);
        setTimeout(() => setMode("done"), 300);
      }
    );

    return () => { cancelled = true; };
  }, [mode]);

  // A failed file is finished too — otherwise the bar never reaches 100%.
  const errorText = React.useMemo(() => Object.fromEntries(errors.map(e =>
    [e.id, errorMessage(t, e)]
  )), [errors, t]);
  const allFailed = errors.length > 0 && errors.length === files.length;
  const completed = Object.values(progress).filter(p => p.state === "done" || p.state === "error").length;

  // Real byte counts, available only once the encode has happened.
  const results   = mode === "done" && outSizes ? outSizes : null;
  const outById   = React.useMemo(
    () => Object.fromEntries((results || []).filter(s => s.id != null).map(s => [s.id, s.bytes])),
    [results]);
  const totalOut  = (results || []).reduce((a, s) => a + s.bytes, 0);
  const failedIds = new Set(errors.map(e => e.id));
  const inputDone = files.filter(f => !failedIds.has(f.id)).reduce((a, f) => a + f.size, 0);
  // Signed on purpose. Clamping this to zero meant a PNG-to-BMP run that grew
  // 355 KB into 1.9 MB reported "saved 0 KB" — the one number the user came
  // for, hidden exactly when it mattered.
  const delta     = inputDone - totalOut;
  const grew      = delta < 0;
  const reductionPct = inputDone > 0 ? Math.round((1 - totalOut / inputDone) * 100) : 0;
  const [headNum, headUnit] = formatBytes(results ? Math.abs(delta) : totalSize).split(" ");
  const saved     = Math.max(0, delta);
  const overall   = files.length
    ? (completed * 100 + (Object.values(progress).find(p => p.state === "going")?.v || 0)) / files.length
    : 0;

  const fmt         = settings.format;
  const isICO       = fmt === "ICO";
  const isPDF       = fmt === "PDF";
  const hasQuality  = FMT_HAS_QUALITY.has(fmt);
  const hasAlpha    = FMT_HAS_ALPHA.has(fmt);
  // Only JPG and PNG have a WASM encoder wired up.
  const hasMaxCompress = fmt === "JPG" || fmt === "PNG";
  const icoSizes    = settings.icoSizes    || [16,32,48,256];
  const icoKeepOrig = settings.icoKeepOriginal !== false;
  const mergePDF    = !!settings.mergePDF;

  return (
    <div className="file-stage">

      {/* Left: file list */}
      <div>
        {mode === "converting" && (
          <div className="banner">
            <div className="spin" />
            <div className="text" style={{ flex: 1 }}>
              <div>
                <strong>{t.convert.converting}</strong>
                {" · "}{completed}/{files.length}
                {elapsed > 0 && (
                  <span style={{ marginLeft: 8, fontFamily: "JetBrains Mono, monospace", fontSize: 12, opacity: 0.75 }}>
                    {elapsed}s {t.convert.elapsed}
                  </span>
                )}
              </div>
              <div className="small">{t.convert.convertingSub}</div>
            </div>
            <div className="bar" style={{ flex: 1, maxWidth: 220 }}>
              <div className="fill" style={{ width: overall + "%" }} />
            </div>
            <button className="btn ghost" onClick={() => Processor.cancelJob()}>
              <Icon name="x" size={14} /> {t.convert.cancel}
            </button>
          </div>
        )}

        {mode === "done" && (
          <div className={"done-banner" + (allFailed ? " failed" : "")}>
            <div className="check">
              <Icon name={allFailed ? "x" : "check"} size={20} stroke={2.6} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {errors.length > 0 ? t.convert.failTitle : t.convert.doneTitle}
              </div>
              <div style={{ fontSize: 13, opacity: .85 }}>
                {stopped
                  ? t.convert.cancelled.replace("{n}", (outSizes || []).length).replace("{total}", files.length)
                  : errors.length > 0
                  ? t.convert.failSub.replace("{n}", errors.length).replace("{total}", files.length)
                  : doneMessage(t, files.length - errors.length, grew, grew ? -delta : saved)}
              </div>
            </div>
            <button className="btn ghost" onClick={() => setMode("idle")}>
              <Icon name="rotate" size={14} /> {t.convert.again}
            </button>
            {!allFailed && (
              <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:"var(--ink-3)", fontWeight:500 }}>
                <Icon name="folder" size={13} /> {t.convert.downloads} ↓
              </span>
            )}
          </div>
        )}

        <div className="file-list">
          <div className="head" style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <h3 style={{ margin:0 }}>{files.length} {t.convert.filesIn}</h3>
            <button
              onClick={() => setFiles([])}
              onMouseEnter={() => setClearHover(true)}
              onMouseLeave={() => setClearHover(false)}
              style={{
                height:28, border:0, borderRadius:8, cursor:"pointer",
                display:"flex", alignItems:"center", gap:5,
                padding: clearHover ? "0 10px 0 8px" : "0 0 0 0",
                background: clearHover ? "var(--coral-soft)" : "transparent",
                color: clearHover ? "var(--coral-ink)" : "var(--ink-3)",
                transition:"background .2s, color .2s, padding .2s",
                overflow:"hidden",
              }}>
              <Icon name="cancel-square" size={16} />
              <span style={{
                fontSize:12, fontWeight:600, whiteSpace:"nowrap",
                maxWidth: clearHover ? 160 : 0,
                opacity: clearHover ? 1 : 0,
                transition:"max-width .22s ease, opacity .18s ease",
                overflow:"hidden",
              }}>
                {t.convert.clearAll}
              </span>
            </button>
          </div>

          {/* Scrollable when > 6 files */}
          <div style={files.length > 6 ? { maxHeight: 420, overflowY: "auto" } : {}}>
            {files.map(f => {
              const p = progress[f.id];
              return (
                <FileRow
                  key={f.id}
                  file={f}
                  targetFmt={settings.format}
                  outBytes={outById[f.id]}
                  progress={p?.v}
                  state={p?.state === "error" ? "error" : (mode === "done" ? "done" : p?.state)}
                  error={errorText[f.id]}
                  onRemove={id => setFiles(files.filter(x => x.id !== id))}
                />
              );
            })}
          </div>

          <button
            className="btn ghost"
            style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
            onClick={onAddFiles}>
            <Icon name="plus" size={14} /> {t.convert.moreFiles}
          </button>
        </div>
      </div>

      {/* Right: settings rail */}
      <aside className="rail" style={isICO ? { maxHeight: "calc(100vh - 80px)", overflowY: "auto" } : {}}>
        <h3>{t.convert.heading}</h3>

        {/* Format grid — 3 columns to fit 9 formats */}
        <div className="field">
          <label>{t.convert.format}</label>
          <div className="fmt-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {FORMATS.map(fmt => (
              <button key={fmt}
                className={"opt " + (settings.format === fmt ? "on" : "")}
                onClick={() => setSettings({ ...settings, format: fmt })}>
                {fmt}
              </button>
            ))}
          </div>
        </div>

        {/* ICO-specific options */}
        {isICO && (
          <div className="field">
            <ToggleRow label={t.convert.icoKeepOriginal} on={icoKeepOrig}
              onChange={v => setSettings({ ...settings, icoKeepOriginal: v })} />
            {icoKeepOrig && (
              <div style={{ fontSize: 12, color: "var(--ink-3)", padding: "4px 0 8px" }}>
                {t.convert.icoIncludeSource}
              </div>
            )}
            <label style={{
              display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink-2)",
              letterSpacing: ".04em", textTransform: "uppercase", margin: "12px 0 8px",
            }}>
              {t.convert.icoSizes}
            </label>
            <div className="preset-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              {ICO_SIZES.map(size => {
                const sel = icoSizes.includes(size);
                return (
                  <button key={size}
                    className={"preset " + (sel ? "on" : "")}
                    onClick={() => {
                      const next = sel
                        ? icoSizes.filter(s => s !== size)
                        : [...icoSizes, size].sort((a, b) => a - b);
                      setSettings({ ...settings, icoSizes: next });
                    }}>
                    <span style={{ textAlign:"center", width:"100%", fontFamily:"JetBrains Mono,monospace", fontSize:11 }}>{size}×{size}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8 }}>
              {t.convert.icoSizesHint}
            </div>
          </div>
        )}

        {/* Quality — only for lossy formats */}
        {hasQuality && (
          <div className="field">
            <label>
              {t.convert.quality}
              <span style={{ float: "right", color: "var(--ink-3)", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
                {settings.quality}%
              </span>
            </label>
            <div className="slider-row">
              <input type="range" min="10" max="100" value={settings.quality}
                onChange={e => setSettings({ ...settings, quality: +e.target.value })} />
            </div>
            <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--ink-3)" }}>{t.convert.qualityHint}</div>
          </div>
        )}

        {/* PDF-specific options */}
        {isPDF && (
          <div className="field">
            <ToggleRow label={t.convert.mergePDF} on={mergePDF}
              onChange={v => setSettings({ ...settings, mergePDF: v })} />
          </div>
        )}

        {/* Transparency is the only one of these canvas can actually honour —
            EXIF and ICC toggles used to sit here doing nothing. */}
        <div className="field">
          {hasMaxCompress && (
            <>
              <ToggleRow label={t.convert.maxCompress} on={!!settings.maxCompress}
                onChange={v => setSettings({ ...settings, maxCompress: v })} />
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", paddingTop: 6, lineHeight: 1.45 }}>
                {t.convert.maxCompressHint}
              </div>
            </>
          )}
          {hasAlpha && (
            <ToggleRow label={t.convert.transparent} on={settings.transparent}
              onChange={v => setSettings({ ...settings, transparent: v })} />
          )}
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", paddingTop: hasAlpha ? 10 : 0, lineHeight: 1.45 }}>
            {t.convert.metaNote}
          </div>
        </div>

        {/* Output folder */}
        <div className="field">
          <label>{t.convert.output}</label>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
            background: "var(--surface-2)", border: "1px solid var(--line)",
            borderRadius: 10, fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--ink-2)",
          }}>
            <Icon name="folder-export" size={14} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t.convert.outputPath}
            </span>
            <button style={{ border: 0, background: "transparent", color: "var(--coral-ink)", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: '"Plus Jakarta Sans"' }}>
              {t.convert.change}
            </button>
          </div>
        </div>

        {/* Summary card — queue size before, measured savings after */}
        <div className="summary">
          <div className="summary-top">
            <span className="lab">
              {!results ? t.convert.queued : grew ? t.convert.totalGrew : t.convert.total}
            </span>
            {results && (
              <span className={"summary-pill" + (grew ? " grew" : "")}>
                {grew ? "+" : "−"}{Math.abs(reductionPct)}%
              </span>
            )}
          </div>
          {/* No sign here: the label says "added" or "saved" and the pill
              carries the direction, and formatBytes can return "<1", which a
              "+" turns into the nonsense "+<1". */}
          <div className="summary-num" style={{ fontFamily: "Fraunces" }}>
            {headNum}<span className="unit">{headUnit}</span>
          </div>
          {results && (
            <div className="summary-bar">
              <div className={"summary-bar-fill" + (grew ? " grew" : "")}
                style={{ width: Math.min(100, Math.abs(reductionPct)) + "%" }} />
            </div>
          )}
          <div className="summary-foot">
            <span>{formatBytes(totalSize)}</span>
            {results && <span className="arr">→</span>}
            {results && <span className="emph">{formatBytes(totalOut)}</span>}
            <span style={{ marginLeft: "auto" }}>{settings.format}</span>
          </div>
        </div>

        <div className="actions">
          <button className="btn primary" onClick={onStart}
            style={{ justifyContent:"center" }}
            disabled={mode === "converting" || files.length === 0}>
            <Icon name="sparkle" size={16} />
            {mode === "converting" ? t.convert.converting : t.convert.go}
          </button>
        </div>
      </aside>
    </div>
  );
}

window.ConvertTab     = ConvertTab;
window.DEFAULT_FORMAT = DEFAULT_FORMAT;
window.errorMessage   = errorMessage;
window.ToggleRow      = ToggleRow;
window.SAMPLE_FILES = SAMPLE_FILES;
window.ALL_FORMATS  = ALL_FORMATS;
window.formatBytes  = formatBytes;
window.Thumb        = Thumb;
