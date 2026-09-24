/* Track recording, persistence across reloads, GPX output and export. */
const { run } = require('./harness');

/* Before the app loads: capture share/download calls and answer confirm(). */
function stubExport() {
  window.__shared = []; window.__downloads = []; window.__shareMode = 'ok';
  navigator.canShare = () => window.__shareMode !== 'unsupported';
  navigator.share = (d) => {
    window.__shared.push({ name: d.files[0].name, type: d.files[0].type, title: d.title });
    return window.__shareMode === 'cancel' ? Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }))
      : window.__shareMode === 'fail' ? Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
      : Promise.resolve();
  };
  HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push(this.download); };
  window.confirm = () => true;
}

run('tracks', async ({ open, check }) => {
  const page = await open(stubExport);
  await page.waitForTimeout(200);                      // saved tracks load asynchronously

  // Feed a fix that's moving north at ~6 kts, 2 s apart.
  const feed = (n, opts) => page.evaluate(([n, o]) => {
    for (let i = 0; i < n; i++) {
      skState.lat = (skState.lat || 39.2) + (o && o.still ? 0 : 0.0001); skState.lon = -76.45;
      skState._ts.pos = Date.now() - (o && o.staleMs || 0);
      Object.assign(skState, { sogKts: 6.2, cogDeg: 358, stwKts: 5.8, windKts: 12.4, windDir: 15, windLabel: 'TWS', _hdgTrue: 2 });
      trackTick();
    }
    return trk.cur ? trk.cur.pts.length : -1;
  }, [n, opts]);

  // Start from the Race tab button, with a course selected.
  await page.evaluate(() => { document.querySelector('.nav-tab[data-tab="npsa"]').click(); selectCourse('E'); });
  await page.click('.nav-tab[data-tab="race"]');
  await page.click('#race-track .trk-start');
  let n = await feed(5);
  const rec = await page.evaluate(() => ({ rec: trk.rec, nm: trk.cur.nm, name: trk.cur.name, marks: trk.cur.marks.length,
    ui: document.getElementById('race-track').textContent, wake: wakeLockWanted(), stored: lsGet('track_rec') === trk.cur.id }));
  check('Record button starts a track', rec.rec && rec.ui.indexOf('REC') >= 0, rec);
  check('moving fixes are recorded', n === 5, n);   // no fix existed yet when Record was tapped
  check('distance accumulates', Math.abs(rec.nm - 0.024) < 0.001, rec.nm);   // 4 legs of 0.0001° lat
  check('track is named for the day and course', /^RaceFlyer \d{4}-\d\d-\d\d \d{4} Course E$/.test(rec.name), rec.name);
  check('course marks are kept as waypoints', rec.marks === 4, rec.marks);   // Start, PW-12, PW-6, Finish
  check('recording holds the screen awake on any tab', rec.wake);

  check('sitting still does not add a point every tick', await feed(5, { still: true }) === n, n);
  check('a stale position is not recorded', await feed(3, { staleMs: 20000 }) === n, n);

  // Reload mid-race: the track and the recording both survive.
  await page.evaluate(() => trackPut(trk.cur));
  await page.waitForTimeout(100);
  await page.reload();
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => ({ rec: trk.rec, pts: trk.cur && trk.cur.pts.length, list: trk.list.length }));
  check('a recording survives a reload and carries on', back.rec && back.pts === n && back.list === 1, back);
  const more = await feed(2);
  check('points keep appending after the reload', more === n + 2, more);

  await page.click('.nav-tab[data-tab="dash"]');
  await page.click('#dash-tracks .trk-stop');
  const stopped = await page.evaluate(() => ({ rec: trk.rec, end: trk.list[0].end != null, wake: wakeLockWanted(),
    flag: lsGet('track_rec'), rows: document.querySelectorAll('#dash-tracks button').length }));
  check('Stop ends the recording and releases the flag', !stopped.rec && stopped.end && !stopped.flag, stopped);
  check('stopping no longer holds the screen off the Race tab', !stopped.wake);
  check('saved track is listed with Export and Delete', stopped.rows === 3, stopped.rows);   // Record + Export + Delete

  // GPX: well-formed, all points, waypoints, extensions, a new segment after a gap.
  const gpx = await page.evaluate(() => {
    const t = trk.list[0];
    t.name = 'Test & <race>';
    t.pts.push([t.pts[t.pts.length - 1][0] + 120000, 39.3, -76.45, null, null, null, null, null, null]);
    const x = trackGPX(t), doc = new DOMParser().parseFromString(x, 'application/xml');
    return { ok: !doc.querySelector('parsererror'), pts: doc.getElementsByTagName('trkpt').length, want: t.pts.length,
      segs: doc.getElementsByTagName('trkseg').length, wpts: doc.getElementsByTagName('wpt').length,
      name: doc.querySelector('metadata name').textContent,
      sog: (doc.getElementsByTagNameNS('https://github.com/cptnslick/RaceFlyerSK/gpx/1', 'sog')[0] || {}).textContent,
      time: doc.querySelector('trkpt time').textContent };
  });
  check('GPX is well-formed XML', gpx.ok, gpx);
  check('every point is exported', gpx.pts === gpx.want, gpx);
  check('a gap over 60 s starts a new segment', gpx.segs === 2, gpx.segs);
  check('course marks exported as waypoints', gpx.wpts === 4, gpx.wpts);
  check('names with & and < survive', gpx.name === 'Test & <race>', gpx.name);
  check('speed rides along in the extension', gpx.sog === '6.2', gpx.sog);
  check('times are ISO UTC', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(gpx.time), gpx.time);

  // Export: share sheet when available; cancel is quiet; other failures and no support download.
  const ex = await page.evaluate(async () => {
    const id = trk.list[0].id, tick = () => new Promise(r => setTimeout(r, 30)), out = {};
    for (const mode of ['ok', 'cancel', 'fail', 'unsupported']) {
      window.__shareMode = mode; window.__shared = []; window.__downloads = [];
      exportTrack(id); await tick();
      out[mode] = { shared: window.__shared.map(s => s.name + '|' + s.type), downloads: window.__downloads.slice() };
    }
    return out;
  });
  check('Export opens the share sheet with a .gpx file', ex.ok.shared.length === 1 && /^Test & -race-\.gpx\|application\/gpx\+xml$/.test(ex.ok.shared[0]) && !ex.ok.downloads.length, ex.ok);
  check('cancelling the share sheet does nothing more', ex.cancel.shared.length === 1 && !ex.cancel.downloads.length, ex.cancel);
  check('a failed share falls back to a download', ex.fail.downloads.length === 1, ex.fail);
  check('no file sharing → download', !ex.unsupported.shared.length && ex.unsupported.downloads.length === 1, ex.unsupported);

  // An empty recording leaves nothing behind; Delete removes a track for good.
  const clean = await page.evaluate(async () => {
    skState._ts.pos = 0; phoneGPS.ts = null;           // no fix at all
    startTrack(); stopTrack();
    const afterEmpty = trk.list.length;
    deleteTrack(trk.list[0].id);
    await new Promise(r => setTimeout(r, 100));
    return { afterEmpty, afterDelete: trk.list.length };
  });
  check('a recording with no points is discarded', clean.afterEmpty === 1, clean);
  check('Delete removes the track', clean.afterDelete === 0, clean);
  await page.reload();
  await page.waitForTimeout(400);
  check('deleted track stays gone after a reload', await page.evaluate(() => trk.list.length) === 0);
});
