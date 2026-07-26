# Pixl Tweak

Convert, resize, compress and crop images — free, offline, in your browser.

**→ [thonyyep.github.io/Pixl_Tweak.github.io](https://thonyyep.github.io/Pixl_Tweak.github.io/)**

Nothing is uploaded. Every image is decoded, transformed and re-encoded by the
Canvas API in your own tab, so there is no server to trust, no file size cap,
no batch limit and no queue. Close the tab and nothing remains.

Interface is bilingual (Español / English).

## Tools

**Convert** — batch convert to PNG, JPG, WebP, AVIF, BMP, PDF or ICO. One file
downloads directly; several arrive as a ZIP. PDF can merge the whole batch into
a single multi-page document. ICO exports a real multi-size icon (8–256 px, your
pick) alongside a PNG of each size.

**Resize** — width and height with optional aspect lock, three fit modes
(contain / cover / stretch), and an upscale toggle. Output as JPG, PNG or WebP.

**Compress** — quality slider with Web / Email / Print / Custom presets, plus
optional colour reduction for PNG. Reports the real output size once encoded.

**Crop & Rotate** — draggable crop box with aspect presets, free rotation from
−180° to 180°, and horizontal / vertical flips.

## What it can and cannot do

The browser's canvas is the whole engine, and that sets hard boundaries. Rather
than hide them:

| | |
|---|---|
| **Input** | AVIF, BMP, GIF, ICO, JPG, PNG, SVG, WebP — whatever your browser can decode. Camera RAW (CR2, NEF, DNG…), PSD and EPS are **not** supported by any browser. |
| **Output** | PNG, JPG, WebP, AVIF, BMP, PDF, ICO. GIF and TIFF are absent because canvas cannot produce them; emitting WebP bytes under a `.gif` name would be a lie. |
| **AVIF** | Listed, but **no browser can currently encode AVIF from a canvas**. Selecting it reports an error rather than silently handing you a PNG named `.avif`. Real AVIF output needs a WASM encoder. |
| **WebP** | Not encodable in any version of Safari. The default output format is probed at load, so Safari starts on JPG instead of failing on the first click. |
| **Metadata** | Always stripped. Canvas re-encodes pixels only, so EXIF, GPS and colour profiles are lost. Output is sRGB; wide-gamut (Display P3) sources are clipped. |
| **Very large images** | Browsers silently blank a canvas past their size cap (~268 megapixels on desktop, less on iOS). This is detected and reported as a size problem, not a mystery failure. |
| **Animated GIF / WebP** | First frame only. |

Every failure names its own cause — a file that cannot be read, a format this
browser cannot encode, and an image too large are three different messages, and
none of them are reported as success.

## Running locally

No build step. The `.jsx` files are transpiled in the browser by Babel standalone.

```bash
npm run dev
```

Then open `http://localhost:3000`. Any static file server works — the app is
plain HTML, CSS and JSX with React, JSZip and jsPDF loaded from a CDN.

## Tests

`selftest.html` is a dependency-free suite that runs in the browser: start the
dev server and open `http://localhost:3000/selftest.html`.

It guards the things that are easy to get quietly wrong — that an encoder never
mislabels its output, that a failed file is reported instead of swallowed, that
resizing preserves transparency and averages instead of aliasing, that a crop
stays inside its rotated canvas, and that reported byte counts match what the
encoder actually produced.

## Layout

| File | |
|---|---|
| `index.html` | Entry point, CDN scripts, meta tags |
| `processor.jsx` | The engine — decode, resize, encode, ZIP, PDF, hand-written BMP and ICO writers |
| `app.jsx` | Shell, tabs, file intake, theme |
| `convert.jsx` | Convert tab, file list, settings rail |
| `other-tools.jsx` | Resize, Compress, Crop tabs |
| `copy.jsx` | All ES/EN strings |
| `icons.jsx` | SVG icon set |
| `styles.css` | Everything visual |
| `selftest.html` | Browser test suite |

## License

MIT — see [LICENSE](LICENSE).
