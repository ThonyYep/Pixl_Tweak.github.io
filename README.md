# Pixl Tweak

Convert, resize, compress and crop images — free, offline, in your browser.

**→ [thonyyep.github.io/Pixl_Tweak.github.io](https://thonyyep.github.io/Pixl_Tweak.github.io/)**

Nothing is uploaded. Every image is decoded, transformed and re-encoded by the
Canvas API in your own tab, so there is no server to trust, no file size cap,
no batch limit and no queue. Close the tab and nothing remains.

Interface is bilingual (Español / English).

## Tools

**Convert** — batch convert to PNG, JPG, WebP, BMP, PDF or ICO. One file
downloads directly; several arrive as a ZIP. PDF can merge the whole batch into
a single multi-page document. ICO exports a real multi-size icon (8–256 px, your
pick) alongside a PNG of each size.

**Resize** — width and height with optional aspect lock, three fit modes and an
upscale toggle. Output as JPG, PNG or WebP. *Contain* fits the image inside the
box and returns it at that size — 1600×900 into an 800×600 box gives 800×450,
with no padding, so a JPG never comes back with white bars burnt in. *Cover*
fills the box and crops the overflow; *stretch* matches it exactly and may
distort. The line under the preview always states the size the file will actually be.

**Compress** — two modes. *Quality* is the usual slider, with Web / Email /
Print presets. *Target size* takes a number in KB or MB and finds the highest
quality that fits, by encoding and measuring — about seven tries — and says so
plainly when the target simply isn't reachable. Optional colour reduction for
PNG. Every size reported is measured, never modelled.

After a run, the preview becomes a **before/after wipe** you can drag, or move
with the arrow keys once it has focus.

All four tools run in a Web Worker, so the page stays responsive and any job
can be cancelled mid-queue — finished files are kept, the rest are dropped.

**Maximum compression** swaps the browser's encoders for MozJPEG and OxiPNG,
compiled to WASM. Measured in Chromium at quality 82 on three 1200×800 sources
generated in the browser — a noisy radial gradient, a flat UI panel with text
bars, and a two-colour logo:

| source | JPEG (MozJPEG) | PNG (OxiPNG) |
|---|---|---|
| photo | −24% | −29% |
| UI panel | −20% | −92% |
| logo | −19% | −85% |

PNG gains the most because Chromium deliberately encodes PNG at a
speed-optimised, size-pessimal compression level. MozJPEG also emits
progressive JPEGs, which canvas cannot.

MozJPEG does not win everywhere: on dense high-frequency detail at quality 95
it measured 101% *larger* than the browser encoder. So both encoders run and
the smaller result is kept — the option can never hand back a bigger file than
leaving it off. It costs ~460 KB of codec, loaded only when the option is
switched on and cached from then on, and it is slower — around a second for a
large PNG.

**Crop & Rotate** — crop box with aspect presets, free rotation from −180° to
180°, and horizontal / vertical flips. The box takes a pointer or the keyboard:
tab to it, then arrows move it, Shift+arrows resize it and Alt takes a finer
step. Output is always a lossless PNG, so nothing is re-compressed — which
means a JPG input comes back larger.

## What it can and cannot do

The browser's canvas is the whole engine, and that sets hard boundaries. Rather
than hide them:

| | |
|---|---|
| **Input** | AVIF, BMP, GIF, ICO, JPG, PNG, SVG, WebP — whatever your browser can decode. Camera RAW (CR2, NEF, DNG…), PSD and EPS are **not** supported by any browser. |
| **Output** | PNG, JPG, WebP, BMP, PDF, ICO. GIF, TIFF and AVIF are absent because no browser can encode them from a canvas; emitting WebP bytes under a `.gif` name would be a lie. AVIF is still accepted as **input** — decoding it works everywhere, only encoding doesn't. Real AVIF output would need another 3.4 MB of WASM and seconds per megapixel. |
| **WebP** | Not encodable in any version of Safari. The default output format is probed at load, so Safari starts on JPG instead of failing on the first click. |
| **Metadata** | Always stripped. Canvas re-encodes pixels only, so EXIF, GPS and colour profiles are lost. Output is sRGB; wide-gamut (Display P3) sources are clipped. |
| **Very large images** | Browsers silently blank a canvas past their size cap (~268 megapixels on desktop, less on iOS). This is detected and reported as a size problem, not a mystery failure. |
| **Animated GIF / WebP** | First frame only. |

Every failure names its own cause — a file that cannot be read, a format this
browser cannot encode, and an image too large are three different messages, and
none of them are reported as success.

## Running locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`. `dev` builds first and then serves; any
static file server works on the output.

The `.jsx` files are the sources — `build.mjs` runs esbuild over them and
writes `bundle.js`, which is what `index.html` loads. **Edit the `.jsx` files,
never `bundle.js`.** After editing, `npm run build` (or `npm run watch` to
rebuild on save).

The build is a transform, not a bundle: the sources are classic scripts that
share one global scope and reach for each other's top-level names directly, so
`build.mjs` concatenates them in load order and only converts the JSX.
Bundling proper would give each file its own module scope and every cross-file
reference would break.

`bundle.js` and `selftest.bundle.js` are committed on purpose — GitHub Pages
serves the repository as-is, with no build of its own.

## Tests

`selftest.html` runs in the browser with no test framework: start the dev
server and open `http://localhost:3000/selftest.html`.

66 cases, guarding the things that are easy to get quietly wrong: that an
encoder never mislabels its output, that a failed file is reported instead of
swallowed, that resizing preserves transparency and averages instead of
aliasing, that a crop stays inside its rotated canvas and answers the keyboard
the same way it answers the pointer, that a sideways phone photo comes out
upright and carries none of its original metadata, and that every byte count
shown matches what the encoder actually produced — including after a run is
cancelled part-way, where the savings figure has to count only the files that
finished.

## Layout

| File | |
|---|---|
| `index.html` | Entry point, CDN scripts, meta tags, pre-paint theme/language |
| `sw.js` | Service worker — precaches the shell and the codecs so offline is real |
| `manifest.webmanifest` | PWA manifest, so it installs |
| `engine.js` | The pixel pipeline — decode, resize, encode, target-size search, hand-written BMP and ICO writers. No DOM, so it runs in both threads |
| `worker.js` | Loads `engine.js` and runs jobs off the main thread |
| `processor.jsx` | Orchestration: dispatch to the worker, then ZIP, PDF and downloads, which need the DOM |
| `app.jsx` | Shell, tabs, file intake, theme |
| `convert.jsx` | Convert tab, file list, settings rail |
| `other-tools.jsx` | Resize, Compress, Crop tabs |
| `copy.jsx` | All ES/EN strings |
| `icons.jsx` + `icons.svg` | `<Icon>` wrapper and the 23-symbol sprite it references |
| `styles.css` | Everything visual |
| `vendor/` | MozJPEG and OxiPNG, vendored rather than pulled from a CDN so offline stays true |
| `build.mjs` | esbuild transform → `bundle.js`, `selftest.bundle.js`; also injects the version and checks `vendor/` is fully precached |
| `selftest.html` + `selftest-cases.js` | Browser test suite |

## License

MIT — see [LICENSE](LICENSE).
