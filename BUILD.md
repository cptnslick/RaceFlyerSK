# Building RaceFlyer SK as an iOS App with Apple Watch Support

This is the roadmap for turning the single-file web app (`index.html`) into a
native iOS app with a companion Apple Watch app. Everything below happens on a
Mac — iOS/watchOS apps can only be built and signed with Xcode.

**The architecture in one sentence:** the iPhone app is a thin native shell
(Capacitor) that runs the existing `index.html` unchanged in a WKWebView; the
Watch app is a small native SwiftUI app that receives a ~1 Hz snapshot of race
data from the phone over WatchConnectivity.

```
┌─────────────────────────────┐         ┌──────────────────────────┐
│  iPhone (Capacitor shell)   │         │  Apple Watch (SwiftUI)   │
│                             │         │                          │
│  WKWebView ── index.html    │  WCSession  │  • Race numbers page │
│   • Signal K WebSocket      │ ───────►│  • Next mark page        │
│   • Leaflet chart           │  ~1 Hz  │  • Shift status + haptic │
│   • Polars / trim / weather │ ◄───────│  • Start timer           │
│                             │ advance-leg,                       │
│  RaceBridge plugin (Swift)  │ timer sync                         │
└─────────────────────────────┘         └──────────────────────────┘
```

Why this split:

- **watchOS cannot run WebViews.** There is no WKWebView on the watch, so the
  watch screens must be native SwiftUI no matter what. That's the only part
  that gets written in Swift.
- **The web app stays the single source of truth.** All polar tables, course
  geometry, VMG math, and shift analysis stay in `index.html`. The phone
  computes everything (it already does) and ships *results* to the watch —
  the watch is a dumb display with buttons. No logic is duplicated in Swift.
- **Capacitor over a from-scratch WKWebView project** because it handles the
  web-asset bundling, JS↔native bridge plumbing, and plugin ecosystem
  (geolocation, splash screen) for free, while still giving you a plain Xcode
  project you fully own.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Mac | Any Apple Silicon or recent Intel Mac. Required — no way around this. |
| Xcode 16+ | Free from the Mac App Store. Includes the watchOS SDK and simulators. |
| Apple ID | Free. Enough to build and run on your own devices for **7 days per install** (fine for early testing). |
| Apple Developer Program | **$99/yr.** Required for TestFlight, App Store, year-long provisioning, and distributing to crew. You can defer this until Phase 4/5. |
| Node.js 18+ | For the Capacitor CLI (`brew install node`). |
| Physical iPhone + Apple Watch | Simulators work for layout, but WatchConnectivity, GPS, and the boat's Signal K server need real hardware. |

---

## Phase 1 — Wrap the web app with Capacitor

### 1.1 Restructure the repo slightly

Capacitor wants a web-asset directory. Move the web files into `www/`:

```
RaceFlyerSK/
├── www/
│   ├── index.html
│   └── vendor/          (leaflet, tabler-icons, fonts)
├── serve.py             (unchanged — still used for the boat Pi)
└── ...
```

### 1.2 Initialize Capacitor

```bash
cd RaceFlyerSK
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init "RaceFlyer" "com.yourname.raceflyer" --web-dir=www
npx cap add ios
npx cap open ios          # opens the generated Xcode project
```

In Xcode: select the **App** target → *Signing & Capabilities* → set your
Team, and pick a unique bundle ID (e.g. `com.yourname.raceflyer`). Hit ▶ with
your iPhone selected and the app should launch showing the full web app.

### 1.3 iOS-specific fixes the current code needs

These are the known friction points between `index.html` as written and a
WKWebView on iOS:

**a) Plain `ws://` to the Signal K server** — `index.html:1006` opens
`ws://192.168.x.x:3000/signalk/v1/stream`. iOS App Transport Security blocks
cleartext connections by default, and iOS 14+ additionally gates local-network
access behind a privacy prompt. Add to `ios/App/App/Info.plist`:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
<key>NSLocalNetworkUsageDescription</key>
<string>RaceFlyer connects to the boat's Signal K server on the local network for live wind and navigation data.</string>
<key>NSBonjourServices</key>
<array>
  <string>_http._tcp</string>
  <string>_signalk-ws._tcp</string>
</array>
```

`NSAllowsLocalNetworking` is the narrow exception (RFC-1918 addresses +
`.local` hosts only) — prefer it over `NSAllowsArbitraryLoads`. The first
`ws://` connection will trigger the "RaceFlyer would like to find and connect
to devices on your local network" prompt; that's expected, tap Allow.

**b) Geolocation** — the phone-GPS fallback (`index.html:935`,
`watchPosition`) and the manual weather-location lookup (`index.html:1441`)
use `navigator.geolocation`. In WKWebView this works but produces a
double-prompt UX unless you route it through the native layer. Two options:

- *Simplest:* add `NSLocationWhenInUseUsageDescription` to Info.plist and let
  the WebView's geolocation work as-is.
- *Cleaner:* `npm install @capacitor/geolocation`, and in `index.html` swap
  `navigator.geolocation` for `Capacitor.Plugins.Geolocation` when
  `window.Capacitor` exists (a 5-line shim at the top of the script keeps the
  file working in plain browsers too).

Either way Info.plist needs:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Used to show your boat on the course chart and load local weather and tides.</string>
```

**c) Wake lock** — `index.html:2653` uses `navigator.wakeLock`, which is
unreliable inside WKWebView. The native equivalent is one line. Replace the
web wake lock (when running under Capacitor) with a call into the RaceBridge
plugin you'll build in Phase 3 anyway:

```swift
// In the plugin:
UIApplication.shared.isIdleTimerDisabled = true   // screen stays on
```

**d) localStorage** — good news: the 22 `localStorage` uses (theme, course,
SK host, etc.) persist indefinitely in Capacitor's WKWebView. This is
actually an upgrade over Safari home-screen PWAs, where WebKit can evict
storage after 7 days of disuse.

**e) Icons & launch screen** — drop a 1024×1024 icon into
`ios/App/App/Assets.xcassets/AppIcon.appiconset/` (Xcode 16 generates all
sizes from one image). The existing `viewport-fit=cover` meta tag already
handles notch/safe-area correctly.

**Milestone:** the app runs on your iPhone, connects to Signal K over the
boat's WiFi, chart and race tabs work, screen stays awake. This alone is a
shippable v1 without the watch.

---

## Phase 2 — Add the watchOS app target

In Xcode: **File → New → Target → watchOS → App**. Name it `RaceFlyer Watch`,
check *"Watch App for Existing iOS App"* so it's bundled as a companion, and
choose SwiftUI. Xcode creates the target, scheme, and a paired-simulator
setup.

The watch app is 4 small screens in a vertical `TabView` (crown-scrollable):

### 2.1 Race numbers page

The wrist version of the Race tab's top block:

- **TWS / TWA** big, top row
- **SOG** and **VMG** second row
- **Target heading** for the current point of sail (upwind or downwind VMG
  optimum from the polar — computed on the phone, displayed here)
- **Tack/gybe headings** with deviation from current COG, same as the
  `hdgCell` pairs in the web Race tab

### 2.2 Next mark page

- Mark name + rounding color (port red / starboard green, matching the chart)
- **Bearing** (with relative arrow — bearing minus COG), **distance**, **ETA**
- An **"Advance leg"** button that sends a message back to the phone, which
  increments `raceState.legIdx` in the web app — so tapping your wrist at the
  mark updates the phone chart too.

### 2.3 Shift status + haptics

- Current status line from the shift analyzer (oscillating/trending, lift or
  header, amplitude, time-to-next-shift) — all already computed from
  `windHistBuf` on the phone.
- When the status flips lift↔header, play a haptic:
  `WKInterfaceDevice.current().play(.notification)`. Distinct patterns for
  lift (`.success`) vs header (`.failure`) are learnable within one race.

### 2.4 Start timer (new feature)

Not in the web app today; lives natively on the watch where it's most useful:

- 5-minute default with quick presets (5/4/3/1), sync-to-next-minute button
  (the classic "sync" at the warning signal)
- Haptic ticks at each minute, every 10 s in the last minute, every second in
  the last 10, and a distinct pattern at GO
- Runs entirely on the watch (no phone dependency once started) using a
  `Timer` + `WKExtendedRuntimeSession` so it survives wrist-down

### watchOS platform notes

- **Always-On display:** use `TimelineView(.periodic(...))` for the numbers
  pages so they stay live (dimmed, 1 Hz) when your wrist drops. Data older
  than ~30 s should grey out — mirror the web app's `SK_STALE_MS` behavior.
- **Water lock:** spray will trigger phantom touches; remind users (README)
  that water lock (side-button hold) disables the screen but haptics and the
  timer keep running.
- **Battery:** a WCSession receiving 1 Hz updates for a 3-hour race is fine;
  don't stream at the Signal K native 1 s × every path rate — the phone
  aggregates to one compact snapshot per second (Phase 3).

---

## Phase 3 — Phone ⇄ Watch data bridge

Three pieces: a JS shim in `index.html`, a small Capacitor plugin
(`RaceBridge`) on the phone, and a `WCSession` delegate on the watch.

### 3.1 JS side (additions to index.html)

At the end of the existing Signal K delta handler (the code that updates
`skState`), add a throttled push — at most once per second, and only when
running inside Capacitor:

```js
var _lastBridgePush = 0;
function pushToWatch() {
  if (!window.Capacitor?.Plugins?.RaceBridge) return;
  var now = Date.now();
  if (now - _lastBridgePush < 1000) return;
  _lastBridgePush = now;
  Capacitor.Plugins.RaceBridge.update({ snapshot: buildWatchSnapshot() });
}
```

`buildWatchSnapshot()` gathers values that are already computed for the Race
tab UI. The payload schema both sides agree on:

| Key | Type | Source in index.html |
|---|---|---|
| `tws` | number (kts) | `skState.windKts` |
| `twa` | number (°, signed) | computed TWA (Race tab) |
| `twd` | number (°T) | `skState.windDir` |
| `sog` | number (kts) | `skState.sog` |
| `cog` | number (°T) | `skState.cog` |
| `vmg` | number (kts) | Race tab VMG calc |
| `targetHdg` | number (°T) | polar optimum for current point of sail |
| `tackHdg` / `gybeHdg` | number (°T) | the `hdgCell` values |
| `markName` | string | active mark, `raceState` + course table |
| `markRounding` | `"port"`/`"stbd"` | mark color logic |
| `markBrg` | number (°T) | next-mark panel |
| `markDist` | number (nm) | next-mark panel |
| `markEta` | string | next-mark panel |
| `legIdx` / `legCount` | numbers | `raceState.legIdx`, course marks length |
| `shiftStatus` | string | shift analyzer summary line |
| `shiftIsLift` | bool/null | lift/header flag (drives watch haptic) |
| `stale` | bool | `Date.now() - skState.lastUpdate > SK_STALE_MS` |

Also register a listener for watch→phone commands:

```js
Capacitor.Plugins.RaceBridge.addListener('watchCommand', function (cmd) {
  if (cmd.action === 'advanceLeg') { /* same code path as the on-screen leg + button */ }
});
```

### 3.2 Phone native side — the RaceBridge Capacitor plugin

One Swift file registered as a local Capacitor plugin (no npm publishing
needed — Capacitor supports in-app plugins). Responsibilities:

- `update(snapshot:)` → `WCSession.default.updateApplicationContext(snapshot)`.
  `updateApplicationContext` is the right WCSession API here: it coalesces
  (latest snapshot wins — perfect for live data), is delivered even if the
  watch app launches later, and is battery-friendly. Don't use
  `sendMessage` for the telemetry stream.
- `keepAwake(on:)` → `UIApplication.shared.isIdleTimerDisabled` (the Phase 1c
  wake-lock replacement).
- `WCSessionDelegate.didReceiveMessage` (watch→phone) → forward to JS via
  `notifyListeners("watchCommand", data)`.

### 3.3 Watch side

- A `ConnectivityStore: ObservableObject` that activates `WCSession`,
  implements `didReceiveApplicationContext`, decodes the snapshot dict into a
  `RaceSnapshot` struct, and publishes it — every SwiftUI page just observes
  this one store.
- "Advance leg" button → `WCSession.default.sendMessage(["action":
  "advanceLeg"], ...)` (interactive messaging is right for commands — it's
  immediate when the phone app is reachable).
- Track `lastReceived: Date`; if > 5 s, show the reconnecting/stale state.

**Caveat to know upfront:** WatchConnectivity delivers reliably while the
watch app is **foreground/active**. When wrist-down with Always-On, updates
keep flowing; if the user switches watch apps, they resume on return. That's
the expected behavior for a during-the-race companion — don't fight it with
complications/background refresh in v1.

---

## Phase 4 — Run it on real hardware, then on the boat

1. **Pair devices to Xcode:** iPhone via cable (first time), watch pairs
   through the phone automatically. Enable Developer Mode on both
   (Settings → Privacy & Security → Developer Mode).
2. **Run the watch scheme** — Xcode installs both apps. First install with a
   free Apple ID lasts 7 days; with the paid account, 1 year.
3. **Bench test:** run a Signal K server on your Mac (`npx signalk-server`)
   with sample NMEA data, point the app at `mac-hostname.local:3000`, verify
   the whole pipeline: SK → WebView → bridge → watch, plus advance-leg coming
   back.
4. **Boat test:** join the boat WiFi, connect to the openplotter server as
   usual. Expect the local-network prompt once. Verify the wss/ws toggle
   still behaves, GPS fallback works with location permission granted, and
   the screen stays awake.

---

## Phase 5 — Distribution

### TestFlight (recommended, and fine long-term for you + crew)

1. Join the Apple Developer Program ($99/yr).
2. In Xcode: Product → **Archive** → *Distribute App* → App Store Connect.
3. In [App Store Connect](https://appstoreconnect.apple.com): create the app
   record (name, bundle ID), the uploaded build appears under TestFlight.
4. Add crew as **internal testers** (up to 100, no Apple review needed —
   builds are testable within minutes). They install via the TestFlight app;
   the watch app comes along automatically.
5. Builds expire after **90 days** — re-archive and upload occasionally.
   External testers (beyond 100 internal) need a one-time light review.

### App Store (if you later want it public)

Everything above, plus: full App Review (expect questions about the
local-network usage — the Signal K explanation suffices), privacy "nutrition
label" declaring location use, 6.7"/6.1" iPhone + watch screenshots, and a
support URL. The `NSAllowsLocalNetworking` exception is accepted when
justified. No code changes required — this is paperwork, not engineering.

---

## Effort summary

| Phase | What | Rough effort |
|---|---|---|
| 1 | Capacitor wrapper + iOS fixes | An afternoon |
| 2 | Watch app UI (4 screens) | 2–4 days if new to SwiftUI |
| 3 | Data bridge (JS + plugin + WCSession) | 1–2 days |
| 4 | Hardware + boat testing | An afternoon + one sail |
| 5 | TestFlight | An hour once enrolled |

Recommended order is exactly 1 → 5; Phase 1 alone gives you an installable
iPhone app, so you get value before writing any Swift UI.

**Next step:** the Phase 1–3 skeletons (Capacitor config, `www/` restructure,
the JS bridge shim, RaceBridge plugin, and the SwiftUI watch app source) can
all be generated in this repo ahead of time so that on the Mac it's just
`npm install && npx cap add ios` plus adding the watch target in Xcode — say
the word.
