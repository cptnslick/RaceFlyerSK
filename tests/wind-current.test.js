/* Computed true wind, current set & drift, and laylines. */
const { run, stubSignalK } = require('./harness');

run('wind-current', async ({ open, check }) => {
  const page = await open();

  // True wind from apparent is rotated by HEADING, not COG.
  const w = await page.evaluate(() => {
    Object.assign(skState, { _speedTrue: null, _dirTrue: null, _speedApp: 5, _angleApp: Math.PI / 2,
      sogKts: 0, cogDeg: 90, _hdgTrue: 0 });
    recomputeSKWind();
    const hdg = { dir: skState.windDir, kts: skState.windKts, label: skState.windLabel };
    skState._hdgTrue = null;                        // no heading → COG is the fallback
    recomputeSKWind();
    const cog = skState.windDir;
    skState._speedApp = null; skState._angleApp = null;
    recomputeSKWind();
    return { hdg, cog, stale: { kts: skState.windKts, label: skState.windLabel } };
  });
  check('cTWS rotates apparent wind by heading', Math.abs(w.hdg.dir - 90) <= 2, w.hdg);
  check('cTWS speed 5 m/s ≈ 9.7 kts', Math.abs(w.hdg.kts - 9.7) < 0.1, w.hdg);
  check('computed wind is labelled cTWS', w.hdg.label === 'cTWS', w.hdg.label);
  check('COG used only as fallback', Math.abs(w.cog - 180) <= 2, w.cog);
  check('stale wind clears value and resets label', w.stale.kts === null && w.stale.label === 'TWS', w.stale);

  // Current: SOG 6 @ 090 over ground, STW 5 @ 090 through water → 1 kt setting 090.
  const cur = await page.evaluate(() => {
    const feed = (o, n) => { for (let i = 0; i < n; i++) { Object.assign(skState, o); pushCurrentSample(); } };
    curBuf = [];
    feed({ sogKts: 6, cogDeg: 90, stwKts: 5, _hdgTrue: 90 }, 12);
    const e = currentEstimate();
    const out = { drift: e && Math.round(e.driftKts * 10) / 10, set: e && Math.round(e.setDeg) };
    curBuf = []; feed({ sogKts: 1, cogDeg: 90, stwKts: 0.5, _hdgTrue: 90 }, 12); out.slow = curBuf.length;
    curBuf = []; feed({ sogKts: 6, cogDeg: 90, stwKts: 5, _hdgTrue: null, _hdgMag: null }, 12); out.noHdg = curBuf.length;
    curBuf = []; feed({ sogKts: 6, cogDeg: 90, stwKts: 5.95, _hdgTrue: 90 }, 12); out.noise = currentEstimate();
    curBuf = []; feed({ sogKts: 6, cogDeg: 90, stwKts: 5, _hdgTrue: null, _hdgMag: 100, _magVar: -10 }, 12);
    const m = currentEstimate(); out.mag = m && Math.round(m.setDeg);
    return out;
  });
  check('current: 1 kt drift', cur.drift === 1, cur);
  check('current: set 090', cur.set === 90, cur);
  check('current: no samples below 1.5 kts SOG', cur.slow === 0, cur.slow);
  check('current: no samples without a heading', cur.noHdg === 0, cur.noHdg);
  check('current: drift under the noise floor is ignored', cur.noise === null, cur.noise);
  check('current: magnetic heading + variation works', cur.mag === 90, cur.mag);

  // Current is published on environment.current in SI units.
  await page.evaluate(stubSignalK);
  const pub = await page.evaluate(() => {
    curBuf = [];
    for (let i = 0; i < 12; i++) { Object.assign(skState, { sogKts: 6, cogDeg: 90, stwKts: 5, _hdgTrue: 90 }); pushCurrentSample(); }
    window.__ws = []; sendCurrentToSK();
    const v = window.__ws[0] && window.__ws[0].updates[0].values[0];
    return v && { path: v.path, set: Math.round(v.value.setTrue * 100) / 100, drift: Math.round(v.value.drift * 100) / 100 };
  });
  check('current published in rad and m/s', pub && pub.path === 'environment.current' && pub.set === 1.57 && pub.drift === 0.51, pub);

  // Laylines: two on a beat, two on a run, none on a reach; current bends them.
  await page.click('.nav-tab[data-tab="npsa"]');
  await page.waitForTimeout(400);
  const ll = await page.evaluate(() => {
    curBuf = [];
    selectCourse('E');
    const v = getRaceVariant(), m = getActiveMarks();
    const legBrg = bearingDeg(m[v.marks[0]], m[v.marks[1]]);
    const at = (windDir) => { skState.windDir = windDir; skState.windKts = 12; _laylineSig = ''; drawLaylines();
      return npsaLaylineGroup.getLayers().map(l => { const p = l.getLatLngs();
        return Math.round(bearingDeg([p[0].lat, p[0].lng], [p[1].lat, p[1].lng])); }); };
    const beat = at(legBrg), run = at((legBrg + 180) % 360), reach = at((legBrg + 90) % 360);
    at(legBrg); const layers = npsaLaylineGroup.getLayers()[0]; drawLaylines();
    const cached = npsaLaylineGroup.getLayers()[0] === layers;
    for (let i = 0; i < 12; i++) { Object.assign(skState, { sogKts: 6, cogDeg: 90, stwKts: 5, _hdgTrue: 90 }); pushCurrentSample(); }
    _laylineSig = ''; drawLaylines();
    const bent = npsaLaylineGroup.getLayers().map(l => { const p = l.getLatLngs();
      return Math.round(bearingDeg([p[0].lat, p[0].lng], [p[1].lat, p[1].lng])); });
    return { beat, run, reach, cached, bent };
  });
  check('beat: two laylines', ll.beat.length === 2, ll.beat);
  check('run: two laylines', ll.run.length === 2, ll.run);
  check('reach: no laylines', ll.reach.length === 0, ll.reach);
  check('unchanged inputs skip the redraw', ll.cached);
  check('a current estimate bends the laylines', ll.bent.length === 2 && ll.bent.join() !== ll.beat.join(), ll);
});
