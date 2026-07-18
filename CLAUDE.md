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
| Weather / tides | `/* ── Weather`, `function loadWeather`, `renderTideSVG` |
| Signal K live sensors | `var skState`, `function connectSK`, `parseSKDelta` |
| Phone-GPS fallback | `/* ── Phone/tablet GPS fallback` |
| Course data | `var MARKS`, `var COURSES`, `NPSA_S3_COURSES`, `RCRA_COURSES` |
| Course map render | `function selectCourse` |
| Race tab | `function renderRaceTab`, `nextMarkCardHTML` |
| Start timer | `var SEQUENCES`, `var timerState`, `renderRaceTimerPanel` |
| Eink kiosk view | `EINK_MODE`, `refreshEinkUI` |

## Conventions

- Version string lives at `id="app-version"` (e.g. `v1.6.0`) — bump it with
  meaningful changes.
- Vanilla ES5-ish JS, string-concatenated HTML, inline styles that read from the
  CSS custom properties (`--color-text-primary`, `--t600`, etc.). Match the
  surrounding style; keep it framework-free.
- Theme-aware: style both light and dark. Inline colors must use the CSS tokens,
  not hard-coded black/white, or dark mode breaks.

## Testing a change (headless, cheap)

Chromium + Playwright are preinstalled. Drive the real UI and assert on state
rather than screenshotting when a scalar check will do (screenshots are image
tokens). Load `file://` on `index.html` directly — no server needed for the
UI; only Signal K / weather / map tiles need the network.

## Deploy

Changes merge to `main`; the boat pulls them via the in-app "Check for update"
button (or `git pull` on `openplotter.local`). Do not open a PR unless asked.
