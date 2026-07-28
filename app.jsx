// app.jsx — main shell

// The last two values from the prototyping host's tweak panel that CSS still
// reads at runtime. Tone, density, typeface and animation speed used to be
// adjustable; their rules now sit in styles.css with the values baked in.
const LOOK = {
  accent: "#6aa3ff",
  radius: 18,
};

// Preferences survive a reload. localStorage throws when storage is disabled
// or the page is sandboxed, and remembering a theme is not worth breaking the
// app over, so both directions swallow it.
const PREF = "pixl.";
function recall(key, allowed) {
  try {
    const v = localStorage.getItem(PREF + key);
    return allowed.includes(v) ? v : null;
  } catch (e) { return null; }
}
// Only a deliberate click is written. Persisting the resolved default instead
// would freeze the app on whatever the OS said the first time it was opened.
const choose = (key, set) => value => {
  try { localStorage.setItem(PREF + key, value); } catch (e) {}
  set(value);
};

const preferredTheme = () =>
  recall("theme", ["light", "dark"]) ||
  (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

const preferredLang = () =>
  recall("lang", ["es", "en"]) ||
  (String(navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en");

function Tabs({ t, value, onChange, fileCount }) {
  const items = [
    { id: "convert",  label: t.tabs.convert,  ico: "convert"  },
    { id: "resize",   label: t.tabs.resize,   ico: "resize"   },
    { id: "compress", label: t.tabs.compress, ico: "compress" },
    { id: "crop",     label: t.tabs.crop,     ico: "crop"     },
  ];

  const wrapRef  = React.useRef(null);
  const dropRef  = React.useRef(null);
  const [pill, setPill]           = React.useState({ left: 6, width: 0 });
  const [isMobile, setIsMobile]   = React.useState(() => window.matchMedia("(max-width: 600px)").matches);
  const [open, setOpen]           = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 600px)");
    const handler = e => { setIsMobile(e.matches); setOpen(false); };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = e => { if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  React.useLayoutEffect(() => {
    if (isMobile) return;
    const el = wrapRef.current;
    if (!el) return;
    const idx = items.findIndex(i => i.id === value);
    const btn = el.querySelectorAll("button.tab")[idx];
    if (btn) {
      const r = btn.getBoundingClientRect();
      const p = el.getBoundingClientRect();
      setPill({ left: r.left - p.left, width: r.width });
    }
  }, [value, t, fileCount, isMobile]);

  const active = items.find(i => i.id === value) || items[0];

  // ── Mobile dropdown ────────────────────────────────────────────────
  if (isMobile) {
    return (
      <nav ref={dropRef} aria-label={t.tabs.switchTool}
           style={{ position:"relative", marginBottom:14, zIndex:40 }}>
        {/* Current tab row */}
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          background:"var(--tint)", border:"1px solid var(--tint-line)",
          borderRadius: open ? "var(--radius) var(--radius) 0 0" : "var(--radius)",
          padding:"10px 14px", transition:"border-radius .15s",
        }}>
          <div style={{
            display:"flex", alignItems:"center", gap:8,
            background:"var(--surface)", borderRadius:"999px",
            padding:"6px 14px 6px 10px",
            boxShadow:"0 2px 8px rgba(0,0,0,.08), 0 0 0 1px color-mix(in oklab, var(--coral), transparent 88%)",
            fontWeight:600, fontSize:14, color:"var(--ink)",
          }}>
            <Icon name={active.ico} size={16} />
            {active.label}
            {value === "convert" && fileCount > 0 && (
              <span className="badge">{fileCount}</span>
            )}
          </div>
          <button
            onClick={() => setOpen(o => !o)}
            aria-label={t.tabs.switchTool}
            aria-haspopup="menu"
            aria-expanded={open}
            style={{ border:0, background:"transparent", cursor:"pointer", color:"var(--ink-2)",
              display:"flex", alignItems:"center", justifyContent:"center",
              // 44px is the smallest comfortable tap target; this was 28.
              width:44, height:44, margin:-8, padding:0, borderRadius:10,
              transition:"color .15s" }}>
            <Icon name="menu" size={20} />
          </button>
        </div>

        {/* Dropdown options */}
        {open && (
          <div style={{
            position:"absolute", left:0, right:0,
            background:"var(--surface)", border:"1px solid var(--tint-line)",
            borderTop:0, borderRadius:"0 0 var(--radius) var(--radius)",
            overflow:"hidden", boxShadow:"0 8px 24px -8px rgba(0,0,0,.15)",
          }}>
            {items.filter(i => i.id !== value).map((i, idx, arr) => (
              <button key={i.id}
                onClick={() => { onChange(i.id); setOpen(false); }}
                style={{
                  display:"flex", alignItems:"center", gap:10,
                  width:"100%", padding:"13px 16px",
                  border:0, borderTop:"1px solid var(--line-2)",
                  background:"transparent", cursor:"pointer",
                  font:"inherit", fontWeight:600, fontSize:14, color:"var(--ink-2)",
                  transition:"background .15s, color .15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background="var(--tint)"; e.currentTarget.style.color="var(--ink)"; }}
                onMouseLeave={e => { e.currentTarget.style.background="transparent"; e.currentTarget.style.color="var(--ink-2)"; }}>
                <Icon name={i.ico} size={16} />
                {i.label}
              </button>
            ))}
          </div>
        )}
      </nav>
    );
  }

  // ── Desktop pill tabs ──────────────────────────────────────────────
  return (
    <div className="tabs" ref={wrapRef}>
      <div className="pill" style={{ left: pill.left, width: pill.width }} />
      {items.map(i => (
        <button key={i.id}
          className={"tab " + (value === i.id ? "on" : "")}
          onClick={() => onChange(i.id)}
          style={{ borderRadius: "999px" }}>
          <span className="tab-ico"><Icon name={i.ico} size={16} /></span>
          {i.label}
          {value === i.id && fileCount > 0 && i.id === "convert" && (
            <span className="badge">{fileCount}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function LangToggle({ lang, onChange }) {
  const wrapRef = React.useRef(null);
  const [pill, setPill] = React.useState({ left: 4, width: 0 });
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const idx = lang === "es" ? 0 : 1;
    const btn = el.querySelectorAll("button")[idx];
    if (btn) {
      const r = btn.getBoundingClientRect();
      const p = el.getBoundingClientRect();
      setPill({ left: r.left - p.left, width: r.width });
    }
  }, [lang]);
  return (
    <div className="lang" ref={wrapRef}>
      <div className="pill" style={{ left: pill.left, width: pill.width }} />
      <button className={lang === "es" ? "on" : ""} onClick={() => onChange("es")}>ES</button>
      <button className={lang === "en" ? "on" : ""} onClick={() => onChange("en")}>EN</button>
    </div>
  );
}

function DropZone({ t, onAccept, onBrowse, onFolder }) {
  const [hot, setHot] = React.useState(false);

  const particles = React.useMemo(() => {
    const colors = ["#ff7a59","#f6c453","#c9a8ff","#8fb8ff","#6fc6a0"];
    return Array.from({ length: 14 }, (_, i) => ({
      left:  5  + Math.random() * 90,
      top:   60 + Math.random() * 40,
      size:  6  + Math.random() * 10,
      color: colors[i % colors.length],
      delay: Math.random() * 8,
      dx:    (Math.random() - .5) * 80,
      rot:   (Math.random() - .5) * 360,
    }));
  }, []);

  return (
    <div
      className={"dropzone " + (hot ? "hot" : "")}
      onDragEnter={e => { e.preventDefault(); setHot(true);  }}
      onDragOver={ e => { e.preventDefault(); setHot(true);  }}
      onDragLeave={()  => setHot(false)}
      onDrop={     e => { e.preventDefault(); setHot(false); onAccept(e.dataTransfer.files); }}
>

      <div className="particles" aria-hidden>
        {particles.map((p, i) => (
          <span key={i} style={{
            left: p.left + "%", top: p.top + "%",
            width: p.size, height: p.size,
            background: p.color,
            animationDelay: p.delay + "s",
            ["--dx"]: p.dx + "px",
            ["--rot"]: p.rot + "deg",
          }} />
        ))}
      </div>

      <div className="uploader">
        <div className="ring" />
        <div className="disk">
          <div className="arrow"><Icon name="upload" size={28} stroke={2} /></div>
        </div>
      </div>

      <h2>{t.drop.title}</h2>
      <p className="hint">{t.drop.hint}</p>

      <div className="row">
        <button className="btn primary" onClick={onBrowse || onAccept}>
          <Icon name="image" size={16} /> {t.drop.browse}
        </button>
        <button className="btn ghost" onClick={onFolder || onAccept}>
          <Icon name="folder" size={16} /> {t.drop.folder}
        </button>
        <button className="btn soft" onClick={() => onAccept(null)}>
          <Icon name="sparkle" size={16} /> {t.drop.sample}
        </button>
      </div>

      <div style={{ marginTop: 22, fontSize: 11, color: "var(--ink-3)", letterSpacing: ".06em", fontWeight: 600, textTransform: "uppercase" }}>
        {t.drop.supported}
      </div>
      <div className="formats">
        {ALL_FORMATS.map(f => <span key={f} className="fmt">{f}</span>)}
      </div>
    </div>
  );
}

const PALETTES = [
  ["#ff8a5b","#ffd16e","#7a4a8a"],
  ["#f4d6c0","#c98668","#3a2a2a"],
  ["#1f2a4a","#ff7a59","#fbf3e4"],
  ["#a9d4e8","#f8e4b5","#3c628a"],
  ["#bfa4ff","#3a2f64","#fcd3e2"],
];

function App() {
  // Remembered between visits, and the first visit follows the browser rather
  // than a hardcoded light/Spanish. The English strings existed all along and
  // an English visitor never saw them.
  const [theme, setTheme] = React.useState(preferredTheme);
  const [lang,  setLang]  = React.useState(preferredLang);
  const t = COPY[lang];

  const [tab,  setTab]  = React.useState("convert");
  const [files, setFiles] = React.useState([]);
  const [mode,  setMode]  = React.useState("idle");
  const [settings, setSettings] = React.useState({
    // WEBP where it works, JPG on Safari — canvas there can't encode WebP and
    // defaulting to it made every conversion fail before the user touched anything.
    format:         DEFAULT_FORMAT,
    quality:        82,
    transparent:    true,
    icoKeepOriginal: true,
    icoSizes:       [],
  });

  // The conversion outlives the tab it was started from, so its state lives
  // here rather than in ConvertTab. ConvertTab unmounts on a tab switch, and
  // when it came back its effect saw mode === "converting" and launched the
  // whole queue a second time — two full jobs for one click.
  const [job, setJob] = React.useState(null);

  function startConvert() {
    setMode("converting");
    setJob({ progress: {}, errors: [], sizes: null, stopped: false, startedAt: Date.now() });
    Processor.processConvert(
      files,
      settings,
      (fileId, pct, state) => setJob(j => j && ({
        ...j,
        progress: { ...j.progress, [fileId]: { v: pct, state: state || (pct >= 100 ? "done" : "going") } },
      })),
      (ok, errs, sizes, wasCancelled) => {
        setJob(j => j && ({ ...j, errors: errs || [], sizes: sizes || [], stopped: !!wasCancelled }));
        setTimeout(() => setMode("done"), 300);
      }
    );
  }

  // Fixed look — written once.
  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--coral",     LOOK.accent);
    root.style.setProperty("--radius-lg", LOOK.radius * 1.4 + "px");
    root.style.setProperty("--radius",    LOOK.radius + "px");
    root.style.setProperty("--radius-sm", Math.max(6, LOOK.radius * .55) + "px");
  }, []);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Also what a screen reader picks its pronunciation from, so it has to track
  // the interface language rather than the lang="en" index.html ships with.
  React.useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const fileInputRef = React.useRef(null);

  function mapFile(f, i) {
    return {
      id: Date.now() + i, name: f.name,
      ext: (f.name.split(".").pop() || "").toUpperCase(),
      size: f.size, w: 0, h: 0,
      palette: PALETTES[i % PALETTES.length],
      fileObj: f,
    };
  }

  // Width and height aren't known until the image decodes, so rows start at 0
  // and get patched as each one lands. Decode failures stay at 0 — the
  // conversion itself reports the real error.
  function fillDims(entries) {
    entries.forEach(entry => {
      Processor.loadImage(entry.fileObj).then(img => {
        setFiles(prev => prev.map(x =>
          x.id === entry.id ? { ...x, w: img.naturalWidth, h: img.naturalHeight } : x));
      }).catch(() => {});
    });
  }

  // Replace all files (called from DropZone — navigates to Convert tab)
  function acceptFiles(realFiles) {
    if (realFiles && realFiles.length > 0) {
      const mapped = Array.from(realFiles).map(mapFile);
      setFiles(mapped);
      fillDims(mapped);
    } else {
      // Generated on demand, then indistinguishable from a real upload.
      makeSampleFiles().then(setFiles);
    }
    setMode("idle");
    setTab("convert");
  }

  // Add files to existing list (called from tool tabs — no tab switch)
  function addFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const mapped = Array.from(fileList).map(mapFile);
    setFiles(prev => [
      ...prev,
      ...mapped.map((m, i) => ({ ...m, palette: PALETTES[(prev.length + i) % PALETTES.length] })),
    ]);
    fillDims(mapped);
  }

  function openFilePicker() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*"; input.multiple = true;
    input.onchange = e => acceptFiles(e.target.files);
    input.click();
  }

  function openFolderPicker() {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true;
    input.webkitdirectory = true;
    input.onchange = e => {
      const images = Array.from(e.target.files).filter(f => f.type.startsWith("image/"));
      if (images.length > 0) acceptFiles(images);
    };
    input.click();
  }

  function openAddFilePicker() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*"; input.multiple = true;
    input.onchange = e => addFiles(e.target.files);
    input.click();
  }

  function renderTab() {
    if (files.length === 0) return <DropZone t={t} onAccept={acceptFiles} onBrowse={openFilePicker} onFolder={openFolderPicker} />;
    switch (tab) {
      case "convert":
        return (
          <ConvertTab
            t={t} files={files} setFiles={setFiles}
            mode={mode} setMode={setMode}
            settings={settings} setSettings={setSettings}
            job={job} onStart={startConvert}
            onAddFiles={openAddFilePicker} />
        );
      case "resize":   return <ResizeTab   t={t} files={files} onAddFiles={openAddFilePicker} onDropFiles={addFiles} onClearFiles={() => setFiles([])} />;
      case "compress": return <CompressTab t={t} files={files} onAddFiles={openAddFilePicker} onDropFiles={addFiles} onClearFiles={() => setFiles([])} />;
      case "crop":     return <CropTab     t={t} files={files} onAddFiles={openAddFilePicker} onDropFiles={addFiles} onClearFiles={() => setFiles([])} />;
      default:         return null;
    }
  }

  return (
    <div className="stage">
      <div className="window">
        <div className="titlebar">
          <div className="left">
            <div className="logo" style={{ fontWeight:"900", fontFamily:'"Plus Jakarta Sans"', color:"rgb(0,0,0)" }}>P</div>
            <span style={{ fontFamily:'"Plus Jakarta Sans"' }}>Pixl Tweak</span>
          </div>
        </div>

        <div className="app">
          <header className="app-header">
            <div className="app-title">
              <h1>{t.appTitle1} <span className="accent">{t.appTitle2}</span></h1>
              <div className="sub">{t.appSub}</div>
            </div>
            <div className="controls">
              <LangToggle lang={lang} onChange={choose("lang", setLang)} />
              <button className="iconbtn"
                onClick={() => choose("theme", setTheme)(theme === "dark" ? "light" : "dark")}
                title="Toggle theme">
                <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
              </button>
            </div>
          </header>

          <Tabs t={t} value={tab} onChange={setTab} fileCount={files.length} />

          {renderTab()}

          {files.length > 0 && (
            <div className="footer">
              <div className="chips">
                <span className="chip"><span className="dot" />{t.footer.ready}</span>
                <span className="chip">{files.length} {files.length === 1 ? t.compress.filesSingular : t.compress.filesPlural}</span>
                <span className="chip">{formatBytes(files.reduce((a, f) => a + f.size, 0))}</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span>{t.footer.offline}</span>
                <span>·</span>
                <span style={{ fontFamily:"JetBrains Mono, monospace" }}>{t.footer.version}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The footer says "works offline"; this is what makes that true. Failing to
// register is not worth breaking the page over — it only costs offline use.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
