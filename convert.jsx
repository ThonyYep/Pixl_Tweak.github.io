// convert.jsx — Convert tab content + file list + settings rail

const SAMPLE_FILES = [
  { id: 1, name: "sunset-dunes-2024.png",    ext: "PNG",  size: 4_820_000, w: 4032, h: 3024, palette: ["#ff8a5b","#ffd16e","#7a4a8a"] },
  { id: 2, name: "studio-portrait-01.jpeg",  ext: "JPEG", size: 6_140_000, w: 3000, h: 4000, palette: ["#f4d6c0","#c98668","#3a2a2a"] },
  { id: 3, name: "logo-stamp-final.svg",     ext: "SVG",  size: 62_400,    w: 512,  h: 512,  palette: ["#1f2a4a","#ff7a59","#fbf3e4"] },
  { id: 4, name: "lake-pano-morning.tif",    ext: "TIF",  size: 22_900_000,w: 7680, h: 2160, palette: ["#a9d4e8","#f8e4b5","#3c628a"] },
  { id: 5, name: "product-mock-back.webp",   ext: "WEBP", size: 480_000,   w: 1600, h: 1600, palette: ["#bfa4ff","#3a2f64","#fcd3e2"] },
];

const FORMATS     = ["PNG","JPG","WEBP","AVIF","GIF","BMP","TIFF","PDF","ICO"];
const ALL_FORMATS = ["BMP","CR2","CR3","DNG","EPS","ICO","JPG","JPEG","NEF","ODD","ORF","PNG","PSD","RAF","RAW","RW2","SVG","TGA","TIFF","TIF","WEBP"];

// Formats that support a quality/compression slider
const FMT_HAS_QUALITY = new Set(["JPG","WEBP","AVIF","GIF","PDF"]);
// Formats that support EXIF metadata preservation
const FMT_HAS_EXIF    = new Set(["JPG","WEBP","AVIF","TIFF","PDF"]);
// Formats that support sRGB profile embedding
const FMT_HAS_SRGB    = new Set(["JPG","WEBP","AVIF","PNG","TIFF","PDF"]);
// Formats that support transparency
const FMT_HAS_ALPHA   = new Set(["PNG","WEBP","AVIF","GIF"]);
const ICO_SIZES  = [8,16,24,32,48,64,128,256,512];

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

function calcFactor(fmt, quality) {
  const q = (quality || 82) / 100;
  switch (fmt) {
    case "JPG":  return 0.04 + q * 0.22;
    case "WEBP": return 0.02 + q * 0.12;
    case "AVIF": return 0.01 + q * 0.09;
    case "PNG":  return 0.60 + q * 0.15;
    case "GIF":  return 0.40 + q * 0.12;
    case "BMP":  return 1.8;
    case "TIFF": return 1.4;
    case "PDF":  return 0.18 + q * 0.10;
    case "ICO":  return 0.05;
    default:     return 0.3;
  }
}

function FileRow({ file, targetFmt, quality, progress, state, onRemove }) {
  const factor    = calcFactor(targetFmt, quality);
  const estimated = Math.max(20_000, file.size * factor);
  return (
    <div className={"file-row " + (state || "")}>
      <div className="thumb"><ThumbOrImg file={file} /></div>
      <div className="info">
        <div className="name">{file.name}</div>
        <div className="stats">
          <span className="from">{file.ext}</span>
          <span className="arrow">→</span>
          <span className="to">{targetFmt}</span>
          <span>·</span>
          <span>{file.w}×{file.h}</span>
        </div>
      </div>
      <div className="size">
        <span>{formatBytes(file.size)}</span>
        <span className="new" style={{ fontWeight:"500" }}>{formatBytes(estimated)}</span>
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
  const factor         = calcFactor(settings.format, settings.quality);
  const totalSize      = files.reduce((a, f) => a + f.size, 0);
  const estimatedTotal = totalSize * factor;
  const saved          = Math.max(0, totalSize - estimatedTotal);

  const [progress, setProgress] = React.useState({});
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
    let cancelled = false;

    Processor.processConvert(
      files,
      settings,
      (fileId, pct) => {
        if (cancelled) return;
        setProgress(prev => ({ ...prev, [fileId]: { v: pct, state: pct >= 100 ? "done" : "going" } }));
      },
      () => {
        if (!cancelled) setTimeout(() => setMode("done"), 300);
      }
    );

    return () => { cancelled = true; };
  }, [mode]);

  const completed = Object.values(progress).filter(p => p.state === "done").length;
  const overall   = files.length
    ? (completed * 100 + (Object.values(progress).find(p => p.state === "going")?.v || 0)) / files.length
    : 0;

  const fmt         = settings.format;
  const isICO       = fmt === "ICO";
  const isPDF       = fmt === "PDF";
  const hasQuality  = FMT_HAS_QUALITY.has(fmt);
  const hasExif     = FMT_HAS_EXIF.has(fmt);
  const hasSrgb     = FMT_HAS_SRGB.has(fmt);
  const hasAlpha    = FMT_HAS_ALPHA.has(fmt);
  const icoSizes    = settings.icoSizes    || [16,32,48,256];
  const icoKeepOrig = settings.icoKeepOriginal !== false;
  const mergePDF    = !!settings.mergePDF;
  const reductionPct = Math.round((1 - factor) * 100);
  const [savedNum, savedUnit] = formatBytes(saved).split(" ");

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
          </div>
        )}

        {mode === "done" && (
          <div className="done-banner">
            <div className="check"><Icon name="check" size={20} stroke={2.6} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t.convert.doneTitle}</div>
              <div style={{ fontSize: 13, opacity: .85 }}>
                {t.convert.doneSub.replace("{n}", files.length).replace("{saved}", formatBytes(saved))}
              </div>
            </div>
            <button className="btn ghost" onClick={() => setMode("idle")}>
              <Icon name="rotate" size={14} /> {t.convert.again}
            </button>
            <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:"var(--ink-3)", fontWeight:500 }}>
              <Icon name="folder" size={13} /> Downloads ↓
            </span>
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
                  quality={settings.quality}
                  progress={p?.v}
                  state={mode === "done" ? "done" : p?.state}
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
            <div className="toggle-row" style={{ borderTop: 0, paddingTop: 0 }}>
              <span>{t.convert.icoKeepOriginal}</span>
              <div className={"toggle " + (icoKeepOrig ? "on" : "")}
                onClick={() => setSettings({ ...settings, icoKeepOriginal: !icoKeepOrig })}>
                <div className="dot" />
              </div>
            </div>
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
            <div className="toggle-row" style={{ borderTop: 0, paddingTop: 0 }}>
              <span>{t.convert.mergePDF}</span>
              <div className={"toggle " + (mergePDF ? "on" : "")}
                onClick={() => setSettings({ ...settings, mergePDF: !mergePDF })}>
                <div className="dot" />
              </div>
            </div>
          </div>
        )}

        {/* Metadata toggles — only shown when the format supports each option */}
        {(hasExif || hasSrgb || hasAlpha) && (
          <div className="field">
            {hasExif && (
              <div className="toggle-row" style={{ borderTop: 0, paddingTop: 0 }}>
                <span>{t.convert.preserve}</span>
                <div className={"toggle " + (settings.exif ? "on" : "")}
                  onClick={() => setSettings({ ...settings, exif: !settings.exif })}>
                  <div className="dot" />
                </div>
              </div>
            )}
            {hasSrgb && (
              <div className="toggle-row">
                <span>{t.convert.colorProfile}</span>
                <div className={"toggle " + (settings.srgb ? "on" : "")}
                  onClick={() => setSettings({ ...settings, srgb: !settings.srgb })}>
                  <div className="dot" />
                </div>
              </div>
            )}
            {hasAlpha && (
              <div className="toggle-row">
                <span>{t.convert.transparent}</span>
                <div className={"toggle " + (settings.transparent ? "on" : "")}
                  onClick={() => setSettings({ ...settings, transparent: !settings.transparent })}>
                  <div className="dot" />
                </div>
              </div>
            )}
          </div>
        )}

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

        {/* Summary card */}
        <div className="summary">
          <div className="summary-top">
            <span className="lab">{t.convert.total}</span>
            <span className="summary-pill">−{reductionPct}%</span>
          </div>
          <div className="summary-num" style={{ fontFamily: "Fraunces" }}>
            {savedNum}<span className="unit">{savedUnit}</span>
          </div>
          <div className="summary-bar">
            <div className="summary-bar-fill" style={{ width: reductionPct + "%" }} />
          </div>
          <div className="summary-foot">
            <span>{formatBytes(totalSize)}</span>
            <span className="arr">→</span>
            <span className="emph">{formatBytes(estimatedTotal)}</span>
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

window.ConvertTab   = ConvertTab;
window.SAMPLE_FILES = SAMPLE_FILES;
window.ALL_FORMATS  = ALL_FORMATS;
window.formatBytes  = formatBytes;
window.Thumb        = Thumb;
