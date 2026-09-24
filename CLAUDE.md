# RaceFlyer SK — working notes for Claude

Single-file sailing-race PWA for an Oyster SJ35 on the Chesapeake. **No build
step, no dependencies** — everything ships in `index.html`.

## Token discipline (read this first)

`index.html` is one ~3,200-line file (~45K tokens to read whole). The vendored
libraries are far larger. To keep sessions cheap:

- **Never read `vendor/`** — `leaflet.js` (~37K tokens) is a third-party
  library; treat it as opaque. The Tabler icon files are now a tiny **subset**
  (see below) but still don't need reading.
- **Don't read `index.html` whole.** Grep for the section or function you need
  and read only that range (a few hundred lines). Use the map below.
- The section headers `/* ── … ── */` are stable anchors — grep those, not line
  numbers (numbers drift as the file changes).

## File map

- `index.html` — the entire app (HTML + inline CSS in `<style>` + inline JS in
  the final `<script>`).
- `serve.py` — tiny HTTPS server for the on-boat Raspberry Pi (OpenPlotter);
  also exposes the `/update` endpoint the in-app "Check for update" button hits.
- `sw.js` — service worker: offline app shell, network-first (so `/update`
  stays fresh). Chart tiles are NOT cached here — the app caches them in
  IndexedDB (`CachedTileLayer` in index.html) because SWs refuse to run on
  the Pi's self-signed cert.
- `manifest.json` + `icons/` — PWA install metadata (add to home screen).
- `vendor/` — Leaflet + Tabler icons, vendored for offline use. Do not read.
  The Tabler font/CSS are **subset to only the ~24 `ti-*` icons the app uses**
  (865 KB → 5 KB font, 238 KB → 1.4 KB CSS).

## Adding a Tabler icon

If you use a new `ti-<name>` (including ones built dynamically like
`'ti-'+(cond?'a':'b')`), it won't render until the font subset includes it —
the subset only contains icons that were present when it was generated.
Regenerate from a full Tabler build (`pip install fonttools brotli`):
1. Collect every `ti-*` used in `index.html` (grep, plus dynamic fragments).
2. Look up each codepoint in the full `tabler-icons.min.css`
   (`.ti-name:before{content:"\XXXX"}`).
3. `pyftsubset full.woff2 --unicodes=U+XXXX,... --flavor=woff2
   --output-file=vendor/fonts/tabler-icons.woff2`.
4. Rebuild `vendor/tabler-icons.min.css` with `@font-face` + only the used
   `.ti-*:before` rules.
- `README.md` — feature overview.

## Where things live in `index.html` (grep these anchors)

| Area | Anchor / symbol |
|---|---|
| CSS design tokens + themes | top `<style>`, `:root` / `data-theme` |
| Race-tab cell styles | `/* ── Race tab compact wind grid` |
| Polar data + interpolation | `const POLAR`, `function interpPolar` |
| Trim tab | `function updateUpwind`, `REACH_BANDS`, `RUN_BANDS` |
| Weather / tides | `/* ── Weather`, `function loadWeather`, `renderWx` → `wxWindHTML`, `wxTidesHTML`…, `renderTideSVG` |
| Signal K live sensors | `var skState`, `function connectSK`, `parseSKDelta` |
| Phone-GPS fallback | `/* ── Phone/tablet GPS fallback` |
| Course data | `var MARKS`, `var COURSES`, `NPSA_S3_COURSES`, `RCRA_COURSES` |
| Course map render | `function selectCourse` |
| Race tab | `function renderRaceTab` → `raceWindState`, `raceHeadingsHTML`, `racePerfHTML`, `raceWindHTML`; `nextMarkCardHTML` |
| Track recording / GPX | `/* ── Track recording`, `var trk`, `trackTick`, `trackGPX`, `exportTrack` |
| Periodic jobs (1 s tick) | `/* ── Periodic jobs`, `every(sec, name, fn)` |
| Flat-earth geometry | `function enNm` (with `bearingDeg`, `distNm`, `destPoint`) |
| Start timer | `var SEQUENCES`, `var timerState`, `renderRaceTimerPanel` |
| Eink kiosk view | `EINK_MODE`, `refreshEinkUI` |

## Conventions

- Version string lives at `id="app-version"` (e.g. `v1.6.0`) — bump it with
  meaningful changes.
- Vanilla ES5-ish JS, string-concatenated HTML, inline styles that read from the
  CSS custom properties (`--color-text-primary`, `--t600`, etc.). Match the
  surrounding style; keep it framework-free.
- Anything that polls on a fixed period registers with `every(sec, name, fn)`
  rather than its own `setInterval`.
- Views that re-render on live data (Race tab, next-mark cards, Signal K card)
  go through `patchHTML(el, html)`, not `el.innerHTML=` — a full rebuild swaps
  out buttons mid-tap and drops the tap. Build the same HTML string; the patcher
  updates only what changed.
- Theme-aware: style both light and dark. Inline colors must use the CSS tokens,
  not hard-coded black/white, or dark mode breaks.
  Rounding/warning colours are tokens too: `--port`/`--stbd`/`--warn` (same in
  both themes; JS reads them as `CLR.*` for Leaflet and SVG attributes, which
  can't use `var()`), and `-bg`/`-bd`/`-fg`/`-ink` tints that adapt.

## Testing a change (headless, cheap)

Run the suite before and after any change: **`node tests/run.js`** (about a
minute; exits non-zero on failure). One file: `node tests/course-api.test.js`.

- `tests/harness.js` — `run(name, async ({open, check}) => …)`; `open(init?)`
  loads `index.html` over `file://` in headless Chromium, `check(label, ok,
  detail)` records a pass/fail, and any page error fails the suite.
  `stubSignalK` fakes the socket and REST so course sync runs with no server.
- `*.test.js` — course API, course selection, periodic jobs, live rendering, theme colours, tracks, wake lock,
  wind/current/laylines.
- `test_serve.py` — `serve.py`'s real handler over plain HTTP (no cert needed).

Add a check whenever you fix a bug, and put tests here, not in a scratchpad
(scratchpads are deleted with the session; the first set of tests was lost
that way). Drive the real UI and assert on state rather than screenshotting
when a scalar check will do (screenshots are image tokens). Only Signal K /
weather / map tiles need the network, and the tests stub all three.

## Deploy

Changes merge to `main`; the boat pulls them via the in-app "Check for update"
button (or `git pull` on `openplotter.local`). Do not open a PR unless asked.
