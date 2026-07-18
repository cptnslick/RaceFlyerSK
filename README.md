# RaceFlyer SK

A single-file PWA for sailboat racing aboard an Oyster SJ35, designed for use on the Chesapeake Bay with the North Point Sailing Association (NPSA) out of North Point.

All data, course geometry, and polar tables are self-contained in `index.html` — no build step, no server, no dependencies to install. Open the file in any modern browser.

## Features

### Live Sensors (Signal K)
Connects to a Signal K server over WebSocket and streams:
- True wind speed & direction (or computed from apparent wind via vector triangle)
- Speed over ground, speed through water, course over ground
- Heel angle, depth below keel
- Auto-loads weather once GPS position is received

Includes a `ws` / `wss` toggle for plain or TLS connections, reconnect logic with cancel, and a live sensor bar on the trim and race tabs.

### Course Chart
- Interactive Leaflet map with OpenSeaMap overlays
- Three selectable course sets: NPSA North Point (A–T), NPSA Series 3 /
  Joint Series (A–N, start/finish at PW-6), and RCRA Rock Creek
- All courses with spinnaker and non-spin variants
- Course lines with bearing/distance labels that auto-declutter: they sit on
  the line when there's room and slide to open water with a thin leader line
  when legs bunch up (e.g. windward-leeward courses that reuse marks),
  re-placing themselves as you zoom
- Landscape two-column layout — next-mark card beside a full-height map
- Color-coded mark circles (port = red, starboard = green)
- Active next-mark highlighted with a larger circle and dashed ring
- Live boat icon that follows GPS position and rotates to COG
- Wind arrow updated in real time from SK data
- Unified next-mark card above the chart (shared with the Race tab): course,
  leg, GPS source, the course mark order, a large rounding-coloured bearing,
  and distance / ETA / VMG with leg navigation

### Race Tactics
- Start timer with selectable sequences (classic **5·4·1·0** RRS sequence by
  default, plus a 10-minute option) and the matching horn schedule
- **Sync ±** buttons flanking the clock snap the remaining time to the nearest
  whole minute, to trim drift against the race committee's signals
- **Auto-start at gun time** — enter a 24-hour start time and the sequence
  arms and fires its horns on its own; just tap Sync if it's slightly off
- Horns use the `playback` audio session so they sound with the phone on
  silent / vibrate (iOS 16.4+ and other modern browsers)
- Collapsible start timer — collapses to a heading when the gun fires (tap to restore)
- Layout ordered timer → optimal headings → next mark → wind for at-a-glance racing
- Optimal upwind/downwind VMG headings from the SJ35 ORC polar; the point of
  sail in use is featured full-size (TWA <95° upwind, >105° downwind, with a
  neutral band between to avoid flicker) and the other shown compact
- Active tack/gybe cell (aligned with COG) highlighted, theme-aware in light & dark
- Compact next-mark card: course/leg/GPS source, mark trail, large bearing in the
  rounding-coloured box, and Distance · ETA · VMG on one line
- Compact 3×2 wind grid (SOG/AWS/TWS · COG/AWA/TWA) that bolds the apparent pair
  upwind and the true pair downwind
- **Wind history** — lull / avg / gust over the last 10 minutes
- **Wind shift analysis** — detects oscillating or trending conditions from the last 30 minutes of SK data, estimates amplitude, cycle period, current lift/header status, and time to next shift

### Trim Guide
- Per-point-of-sail settings (upwind, reaching, running) with a wind speed slider
- All three modes respond to the slider: condition badge, sail selection, polar targets, and downwind gybe-angle goal update with TWS
- Upwind shows the target apparent wind angle (AWA) alongside the true wind
  angle — the AWA is what the masthead reads and the helm steers to (~13–15°
  tighter than TWA), while TWA still drives the tack headings and laylines
- Trim rules and goals sourced from SJ35 tuning notes
- Slider position smoothed with a 60-second rolling wind average to prevent jumping on gusts

### Weather
- Conditions fetched from Open-Meteo for current GPS location
- Wind speed, direction, gusts, Beaufort scale
- 3-hour 15-minute forecast strip
- Swell / sea state (marine API)
- NOAA tide predictions with a visual sinusoidal tide curve

### Dashboard
- At-a-glance conditions summary
- Quick access to all tabs

## Usage

1. Open `index.html` in a browser (locally via `file://` for full ws:// support, or from iCloud/hosted for wss://)
2. Select a course and boat class (Spinnaker / Non-Spin) on the **Courses** tab
3. Enter your Signal K server address on the **Dashboard** and connect
4. Use the **Race** tab during racing for wind data, optimal headings, shift analysis, and next-mark guidance

## Signal K Paths

| Path | Period | Used for |
|---|---|---|
| `environment.wind.speedTrue` | 1 s | TWS, polar lookup |
| `environment.wind.directionTrue` | 1 s | Wind direction |
| `environment.wind.speedApparent` | 1 s | Vector triangle fallback |
| `environment.wind.angleApparent` | 1 s | Vector triangle fallback |
| `navigation.position` | 2 s | GPS, weather load, mark distance |
| `navigation.speedOverGround` | 1 s | ETA, trim, vector triangle |
| `navigation.speedThroughWater` | 1 s | Trim bar |
| `navigation.courseOverGroundTrue` | 1 s | TWA, vector triangle |
| `environment.depth.belowKeel` | 2 s | Depth display |
| `navigation.attitude` | 0.5 s | Heel angle |

## Boat

Oyster SJ35 "Flyer" (Sail# USA-25126) — polar targets transcribed from the
boat's ORC 2023 Speed Guide. Upwind and downwind figures are the certificate's
"BestPerf" beat/run VMG optima; reach figures are BestPerf boat speed at 90°
(beam) and 120° (broad). Per the certificate's separate headsail/spinnaker
targets, the symmetric spinnaker only outperforms the headsail at TWA ~110°
and deeper — surfaced in the Reaching tab as the spinnaker crossover.

## Area

North Point / Chesapeake Bay, NPSA courses A–T.
