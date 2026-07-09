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
- All NPSA courses (A–T) with spinnaker and non-spin variants
- Course lines with bearing and distance labels
- Color-coded mark circles (port = red, starboard = green)
- Active next-mark highlighted with a larger circle and dashed ring
- Live boat icon that follows GPS position and rotates to COG
- Wind arrow updated in real time from SK data
- Next mark panel below the chart with bearing, distance, ETA, and leg navigation

### Race Tactics
- True wind speed & angle, COG, SOG
- Optimal upwind/downwind VMG headings from the SJ35 ORC polar
- Tack/gybe heading cells with deviation from current COG
- **Wind history** — lull / avg / gust over the last 10 minutes
- **Wind shift analysis** — detects oscillating or trending conditions from the last 30 minutes of SK data, estimates amplitude, cycle period, current lift/header status, and time to next shift

### Trim Guide
- Per-point-of-sail settings (upwind, reaching, running) with a wind speed slider
- All three modes respond to the slider: condition badge, sail selection, polar targets, and downwind gybe-angle goal update with TWS
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

Oyster SJ35 — polar data from ORC certificate.

## Area

North Point / Chesapeake Bay, NPSA courses A–T.
