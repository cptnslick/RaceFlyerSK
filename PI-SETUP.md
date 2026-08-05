# Setting up the boat Pi from scratch

Everything needed to get RaceFlyer SK and its Signal K chain running on a
freshly imaged OpenPlotter Pi. Written after a factory reset, so it assumes
nothing is installed.

Order matters: Signal K needs a **position fix of its own** before the Course
API will accept a destination, and the NMEA 0183 output needs the course tree
before it emits anything. Build it bottom-up.

Paths used throughout (they're baked into `serve.py` — change both if you move
them): webroot `/home/pi/www`, certs `/home/pi/ssl-certs/`, update script
`/usr/local/bin/update-page.sh`.

---

## 1. Flash and first boot

1. Flash the current **OpenPlotter** image with Raspberry Pi Imager. In the
   Imager's advanced options, set the hostname to `openplotter`, enable SSH,
   and pre-fill wifi — saves a monitor and keyboard.
2. Boot, then `ssh pi@openplotter.local`. If mDNS doesn't resolve, find the IP
   on the router and use that; `avahi-daemon` ships with Raspberry Pi OS and
   usually just works.
3. `sudo apt update && sudo apt full-upgrade` and reboot.
4. Set the timezone — **the start timer's auto-start reads the Pi's wall clock
   only through the browser, but tide times and log timestamps come from here**:
   `sudo raspi-config` → Localisation → Timezone → US/Eastern.

Menu names shift between OpenPlotter releases; if something below doesn't match
what's on screen, the OpenPlotter docs are authoritative for the image itself.

## 2. Signal K server

OpenPlotter installs Signal K through its own installer app (OpenPlotter →
Signal K Installer). Once it's running, confirm both ports answer:

```bash
curl -s http://localhost:3000/signalk | head -c 200      # plain
curl -sk https://localhost:3443/signalk | head -c 200    # TLS
```

The app defaults to `openplotter.local:3443` over `wss` and
`openplotter.local:3000` over `ws`, so keep the stock ports unless you have a
reason not to.

Create the admin login when prompted, then leave the admin UI open — the next
three steps all live in it.

## 3. GPS into Signal K — do this before anything else

**This is the step everything else depends on.** The Course API sets the leg
origin from the server's own `navigation.position` and refuses a destination
outright without one (`HTTP 400: Unable to retrieve vessel position!`). The app
falls back to publishing the course itself, which works, but you lose the
server-side calculations.

Wire the boat's GPS in via OpenPlotter → Serial (for a USB/serial GPS) or CAN
(for NMEA 2000 through the MacArthur HAT), then confirm Signal K actually holds
a fix:

```bash
curl -s http://localhost:3000/signalk/v1/api/vessels/self/navigation/position
```

You want real numbers with a recent timestamp. Until this returns a position,
skip ahead at your own risk — the whole Raymarine chain is dead without it.

> Testing at the dock with no GPS? A browser simulator like sksim will feed
> position in, but **its tab sleeps** when backgrounded and Signal K then loses
> the fix — that's what took down `course-provider` last time. For bench work,
> prefer something server-side on the Pi (a replayed NMEA log) so nothing
> depends on a browser staying awake.

## 4. Signal K plugins

Admin UI → Appstore → install both:

| Plugin | Does what |
|---|---|
| `@signalk/course-provider` | Computes `navigation.course.calcValues.*` from the destination |
| `signalk-to-nmea0183` | Builds the `RMB` / `APB` / `BWC` / `XTE` sentences |

Then Server → Plugin Config:

- **Course Provider** — enable it. No settings needed.
- **signalk-to-nmea0183** — enable it and tick **RMB, APB, BWC, XTE**. Its
  sentence builders read the **v2** `navigation.course.*` tree only; the older
  `navigation.courseGreatCircle.*` paths reach nothing, which is why the app
  drives the Course API rather than writing those paths.

## 5. Source priorities

Once the app is publishing, three sources can touch the same course paths.
Admin UI → Server → Source Priorities, for the `navigation.course.*` group:

1. `courseApi`
2. `course-provider`
3. `RaceFlyerSK.XX` (the app — **must be last**)

Set "Fallback after (ms)" to `15000` and Save. Only the app being last actually
matters; the top two cover disjoint paths, so their order is cosmetic. Don't
deactivate or delete entries — unranked sources fall back to last-write-wins,
which makes RMB and XTE jitter between two sources.

## 6. The app

```bash
sudo apt install -y git
sudo mkdir -p /home/pi/www && sudo chown pi:pi /home/pi/www
git clone https://github.com/cptnslick/RaceFlyerSK.git /home/pi/www
```

Clone straight into the webroot so `git pull` updates the served files in
place — that's what the in-app update button drives.

> Note this also exposes `/home/pi/www/.git/` over HTTP to anyone on the boat
> network. It's a public repo on a LAN, so it's noise rather than a risk, but
> don't put anything private in that directory.

## 7. Self-signed cert

Geolocation and the PWA install need HTTPS, so the server needs a cert:

```bash
mkdir -p /home/pi/ssl-certs && cd /home/pi/ssl-certs
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout key.pem -out cert.pem \
  -subj "/CN=openplotter.local" \
  -addext "subjectAltName=DNS:openplotter.local,DNS:localhost,IP:127.0.0.1"
chmod 600 key.pem
```

The `subjectAltName` matters — modern browsers reject certs that only carry a
CN. You'll still get a warning once per device (Advanced → Proceed); accept it
and it sticks.

Because the cert is self-signed, **the service worker will not register**, so
there's no offline app shell on the Pi. That's expected and by design: the app
caches chart tiles in IndexedDB instead, which works regardless of cert trust.

## 8. The update script

`serve.py` shells out to this on every "Check for update" tap. It isn't
optional — without it the button returns an error.

```bash
sudo tee /usr/local/bin/update-page.sh >/dev/null <<'EOF'
#!/bin/bash
# Refresh the webroot from origin/main. Output is matched by the app's
# checkForUpdate(): it looks for the literal words "Updated" or "No change".
set -euo pipefail
cd /home/pi/www
before=$(git rev-parse HEAD)
git fetch --quiet origin main
# Hard reset, not pull: the webroot is never hand-edited, and a stray local
# change would otherwise wedge every future update with a merge error.
git reset --hard --quiet origin/main
after=$(git rev-parse HEAD)
if [ "$before" = "$after" ]; then
  echo "No change"
else
  echo "Updated $before -> $after"
  git diff --name-only "$before" "$after" | grep -q '^serve.py$' \
    && echo "(serve.py changed — restart raceflyer for it to take effect)"
fi
EOF
sudo chmod +x /usr/local/bin/update-page.sh
sudo -u pi /usr/local/bin/update-page.sh     # should print "No change"
```

Run it as the `pi` user once, as above. If it works from your shell but fails
from the button, it's almost always because the service runs as a different
user than the one that owns `/home/pi/www`.

## 9. Run serve.py at boot

```bash
sudo tee /etc/systemd/system/raceflyer.service >/dev/null <<'EOF'
[Unit]
Description=RaceFlyer SK HTTPS server
After=network-online.target
Wants=network-online.target

[Service]
User=pi
ExecStart=/usr/bin/python3 /home/pi/www/serve.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now raceflyer
systemctl status raceflyer --no-pager
```

Running it from `/home/pi/www/serve.py` (not a copy in `/home/pi`) means the
update button keeps the server script current too. It still needs a restart to
pick up its own changes — Python holds the old code in memory:

```bash
sudo systemctl restart raceflyer
```

Open **https://openplotter.local:8443** and accept the cert warning.

## 10. NMEA 0183 out to the Raymarine

With the MacArthur HAT installed, `signalk-to-nmea0183` needs somewhere to send
its sentences: in Signal K, add a **NMEA 0183 output** connection targeting the
HAT's serial port (typically `/dev/ttyAMA0` or a `/dev/serial0` symlink — check
OpenPlotter → Serial for the actual device), at **4800 baud** for standard NMEA
0183. From there it's HAT → SeaTalk bridge → the Raymarine display.

Watch the sentences live while a mark is selected in the app:

```bash
# from the Pi, on whatever port you configured
cat /dev/ttyAMA0
```

You want `$IIRMB` and `$IIXTE` with a non-empty cross-track figure. Sign
convention: negative cross-track means the boat is left of the track.

## 11. Verification checklist

Work down this list; each line depends on the ones above it.

- [ ] `curl -s http://localhost:3000/signalk` answers
- [ ] `navigation.position` shows a live fix in the Signal K data browser
- [ ] Course Provider and signalk-to-nmea0183 both show **enabled**
- [ ] `https://openplotter.local:8443` loads and shows the version bottom-right
- [ ] Dashboard → Signal K connects (`wss`, `openplotter.local:3443`)
- [ ] Wind, SOG and depth populate on the Race tab
- [ ] Pick a course; the Signal K card reads **"Next mark set via Course API ·
      cross-track live to NMEA 0183"** — that green note is the whole chain
      confirmed in one line
- [ ] "Check for update" reports "Already up to date"
- [ ] `$IIRMB` on the wire with a live cross-track

If the Signal K card says something other than the green note, it names the
failing layer directly — no fix on the server, a refused write with the
server's own explanation, or the Course Provider not running.

## Troubleshooting

**Update button says "Unavailable"** — you're not on the Pi-served copy (a
hosted or iCloud copy has no `/update`), or `raceflyer.service` is down.

**Says "Error — see console"** — `update-page.sh` failed. Run it by hand as
`pi`. A killed `git` can leave `.git/index.lock` behind, which then breaks every
later run: `rm -f /home/pi/www/.git/index.lock`.

**Says "Updated" but the version doesn't change** — stale browser cache. v1.15.2
added `Cache-Control: no-cache` to `serve.py` to prevent exactly this; if you're
running an older `serve.py`, restart the service after pulling.

**Course card says "no GPS fix of its own"** — Signal K isn't holding
`navigation.position`. Back to step 3; the app keeps working off the phone's GPS
in the meantime.

**Nothing on the Raymarine but the app looks healthy** — the break is in step 10.
Confirm sentences on the serial device first, then the SeaTalk bridge.
