/* Next mark → Signal K Course API, and the fallbacks when it can't be used. */
const { run, stubSignalK } = require('./harness');

run('course-api', async ({ open, check }) => {
  const page = await open();
  await page.evaluate(stubSignalK);
  await page.evaluate(() => {
    window.courseCalls = () => window.__http.filter(x => x.url.indexOf('navigation/course') >= 0);
    window.wsValues = () => {
      const v = {};
      window.__ws.forEach(m => m.updates.forEach(u => u.values.forEach(x => { v[x.path] = x.value; })));
      return v;
    };
    window.tick = ms => new Promise(res => setTimeout(res, ms || 50));
    document.querySelector('.nav-tab[data-tab="npsa"]').click();
    selectCourse('E');
    const v = getRaceVariant(), m = getActiveMarks();
    window.__leg = { prev: m[v.marks[0]], next: m[v.marks[1]] };
    window.getEffectiveLat = () => window.__leg.prev[0];
    window.getEffectiveLon = () => window.__leg.prev[1];
    /* Signal K holds its own fix — the on-boat case the Course API needs. */
    skState.lat = window.__leg.prev[0]; skState.lon = window.__leg.prev[1];
    skState.cogDeg = 0; skState.sogKts = 6;
  });

  // One PUT per destination, with the right body; no repeat on later ticks.
  const put = await page.evaluate(async () => {
    window.__http = [];
    syncCourseToSK(); await tick();
    syncCourseToSK(); syncCourseToSK(); await tick();
    const h = courseCalls()[0] || {};
    return { n: courseCalls().length, method: h.method, url: h.url, body: h.body, mode: skCourse.mode,
      arrival: Math.round(AUTO_ARRIVE_NM * 1852), next: window.__leg.next };
  });
  check('one PUT per destination', put.n === 1, put.n);
  check('PUT targets course/destination', put.method === 'PUT' && /navigation\/course\/destination$/.test(put.url), put.url);
  check('arrival circle matches auto-advance radius', put.body && put.body.arrivalCircle === put.arrival);
  check('PUT carries the next mark', put.body && Math.abs(put.body.position.latitude - put.next[0]) < 1e-9);
  check('mode becomes api', put.mode === 'api', put.mode);

  // A leg change re-targets.
  const leg = await page.evaluate(async () => {
    window.__http = [];
    raceAdvanceLeg(1); await tick();
    const want = getActiveMarks()[getRaceVariant().marks[raceState.legIdx]];
    const puts = window.__http.filter(x => x.method === 'PUT');
    return { n: puts.length, ok: puts.length > 0 && Math.abs(puts[0].body.position.latitude - want[0]) < 1e-9 };
  });
  check('leg change sends one PUT for the new mark', leg.n === 1 && leg.ok, leg);

  // XTE: due-north leg, boat 0.05 nm east → +92.6 m (right of track = positive).
  const xte = await page.evaluate(() => {
    const a = [39.20, -76.40], b = [39.30, -76.40], k = Math.cos(39.25 * Math.PI / 180);
    const r = x => Math.round(x * 10) / 10;
    return { east: r(xteMeters([39.25, -76.40 + (0.05 / 60) / k], a, b)),
      west: r(xteMeters([39.25, -76.40 - (0.05 / 60) / k], a, b)), on: r(xteMeters([39.25, -76.40], a, b)) };
  });
  check('XTE right of track = +92.6 m', xte.east === 92.6, xte);
  check('XTE left of track = -92.6 m', xte.west === -92.6, xte);
  check('XTE on track = 0', xte.on === 0, xte);

  // Refused PUT → the full v2 value set goes out over the socket instead.
  const fb = await page.evaluate(async () => {
    window.__putStatus = 403; resetSkCourse(); window.__ws = [];
    syncCourseToSK(); await tick();
    syncCourseToSK(); await tick(20);
    const v = wsValues(), np = v['navigation.course.nextPoint'] || {};
    const brg = v['navigation.course.calcValues.bearingTrue'];
    return { mode: skCourse.mode, type: np.type, name: np.name, prev: !!v['navigation.course.previousPoint'],
      brgRad: typeof brg === 'number' && brg >= 0 && brg <= 2 * Math.PI,
      distM: v['navigation.course.calcValues.distance'] > 100,
      xte: typeof v['navigation.course.calcValues.crossTrackError'] === 'number',
      arrival: v['navigation.course.arrivalCircle'] };
  });
  check('refused PUT falls back to delta mode', fb.mode === 'delta', fb.mode);
  check('fallback publishes nextPoint as a named Location', fb.type === 'Location' && !!fb.name, fb);
  check('fallback publishes previousPoint and XTE', fb.prev && fb.xte, fb);
  check('fallback units: bearing in rad, distance in m', fb.brgRad && fb.distM, fb);
  check('fallback arrival circle is 185 m', fb.arrival === 185, fb.arrival);

  // Server-computed calcValues suppress our own publishing; our echo doesn't count.
  const srv = await page.evaluate(async () => {
    window.__putStatus = 200; resetSkCourse();
    syncCourseToSK(); await tick();
    skCourse.putAt = 0;
    parseSKDelta(JSON.stringify({ updates: [{ source: { label: 'course-provider' },
      values: [{ path: 'navigation.course.calcValues.crossTrackError', value: 12.5 }] }] }));
    const live = skCourseCalcLive();
    window.__ws = []; syncCourseToSK();
    const quiet = window.__ws.length === 0;
    skState._ts.xte = null;
    parseSKDelta(JSON.stringify({ updates: [{ source: { label: 'RaceFlyerSK' },
      values: [{ path: 'navigation.course.calcValues.crossTrackError', value: 9 }] }] }));
    return { live, quiet, echoIgnored: !skCourseCalcLive() };
  });
  check('server calcValues detected', srv.live);
  check('app stays quiet while the server computes', srv.quiet);
  check('own echoed XTE does not count as the server', srv.echoIgnored);

  // Deselecting clears the server's destination.
  const clr = await page.evaluate(async () => {
    skCourse.mode = 'api'; skCourse.dest = 'x'; window.__http = [];
    raceState.courseId = ''; syncCourseToSK(); await tick(30);
    const d = window.__http.find(x => x.method === 'DELETE');
    return { deleted: !!d && /navigation\/course$/.test(d.url), dest: skCourse.dest };
  });
  check('deselect sends DELETE', clr.deleted, clr);
  check('deselect clears dest', clr.dest === '', clr.dest);

  // The server's own explanation reaches the status card.
  const err = await page.evaluate(async () => {
    const attempt = async (body) => {
      window.__putStatus = 400; window.__errBody = body; resetSkCourse();
      skState.lat = window.__leg.prev[0]; skState.lon = window.__leg.prev[1];
      raceState.courseId = 'E'; syncCourseToSK(); await tick(60);
      return { err: skCourse.err, status: skCourseStatusText(), mode: skCourse.mode };
    };
    return [await attempt({ state: 'FAILED', statusCode: 400, message: 'Error: Unable to retrieve vessel position!' }),
            await attempt([{ instancePath: '/arrivalCircle', message: 'must be number' }]),
            await attempt(null)];
  });
  check('handler message shown, Error: prefix stripped', err[0].err === 'HTTP 400: Unable to retrieve vessel position!', err[0].err);
  check('handler message reaches the card', err[0].status.indexOf('Unable to retrieve vessel position') >= 0);
  check('schema error array is summarised', err[1].err.indexOf('must be number') >= 0, err[1].err);
  check('unparseable body falls back to the status code', err[2].err === 'HTTP 400', err[2].err);
  check('every refusal falls back to delta', err.every(x => x.mode === 'delta'));

  // Server has no fix of its own: don't ask, say so, publish from the phone.
  const nofix = await page.evaluate(async () => {
    window.__putStatus = 200; window.__errBody = null; resetSkCourse();
    skState.lat = null; skState.lon = null;
    window.__http = []; window.__ws = [];
    syncCourseToSK(); await tick();
    const v = wsValues();
    return { calls: courseCalls().length, mode: skCourse.mode, status: skCourseStatusText(),
      next: 'navigation.course.nextPoint' in v, xte: 'navigation.course.calcValues.crossTrackError' in v };
  });
  check('no SK fix → no REST request at all', nofix.calls === 0, nofix.calls);
  check('no SK fix → nofix mode with an explanation', nofix.mode === 'nofix' && nofix.status.indexOf('no GPS fix of its own') >= 0, nofix);
  check('no SK fix → still publishes the course', nofix.next && nofix.xte, nofix);

  // Self-heal: fix comes back, retry clock elapses → one PUT, back to api.
  const heal = await page.evaluate(async () => {
    window.__putStatus = 400; window.__errBody = { message: 'Error: Unable to retrieve vessel position!' };
    resetSkCourse(); skState.lat = window.__leg.prev[0]; skState.lon = window.__leg.prev[1];
    syncCourseToSK(); await tick(60);
    const afterFail = skCourse.mode;
    window.__http = []; syncCourseToSK(); await tick(30);
    const early = courseCalls().length;
    window.__putStatus = 200; skCourse.retryAt = 0;
    syncCourseToSK(); await tick(60);
    return { afterFail, early, puts: courseCalls().filter(x => x.method === 'PUT').length, mode: skCourse.mode, err: skCourse.err };
  });
  check('failed PUT is not retried before the clock', heal.afterFail === 'delta' && heal.early === 0, heal);
  check('retry succeeds and returns to api mode', heal.puts === 1 && heal.mode === 'api' && heal.err === '', heal);

  // Deselect while the PUT is still in flight → orphaned destination is deleted.
  const orphan = await page.evaluate(async () => {
    let release;
    window.fetch = (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      window.__http.push({ url, method });
      if (method === 'PUT') return new Promise(res => { release = () => res({ ok: true, status: 200 }); });
      return Promise.resolve({ ok: true, status: 200 });
    };
    resetSkCourse(); raceState.courseId = 'E'; window.__http = [];
    skState.lat = window.__leg.prev[0]; skState.lon = window.__leg.prev[1];
    syncCourseToSK();
    const pending = skCourse.pending;
    raceState.courseId = ''; syncCourseToSK();
    release(); await tick();
    return { pending, deleted: window.__http.some(x => x.method === 'DELETE'), mode: skCourse.mode, stillPending: skCourse.pending };
  });
  check('in-flight PUT is pending', orphan.pending);
  check('late success after deselect is deleted', orphan.deleted, orphan);
  check('late success does not revive api mode', orphan.mode !== 'api' && !orphan.stillPending, orphan);

  // nofix mode also has published paths to take back on deselect.
  const nofixClear = await page.evaluate(async () => {
    resetSkCourse(); raceState.courseId = 'E';
    skState.lat = null; skState.lon = null;
    syncCourseToSK();
    const mode = skCourse.mode;
    window.__ws = []; raceState.courseId = ''; syncCourseToSK();
    const v = wsValues();
    return { mode, next: v['navigation.course.nextPoint'] === null, prev: v['navigation.course.previousPoint'] === null };
  });
  check('nofix deselect nulls nextPoint and previousPoint', nofixClear.mode === 'nofix' && nofixClear.next && nofixClear.prev, nofixClear);

  // disconnectSK abandons everything, including an in-flight request.
  const disco = await page.evaluate(() => {
    skCourse.pending = true; skCourse.putAt = 5; skCourse.retryAt = 5; skCourse.dest = 'x';
    disconnectSK();
    return { pending: skCourse.pending, putAt: skCourse.putAt, retryAt: skCourse.retryAt, dest: skCourse.dest };
  });
  check('disconnect resets all course sync state', !disco.pending && disco.putAt === 0 && disco.retryAt === 0 && disco.dest === '', disco);

  // Text from the server or the user can't inject markup.
  const x = await page.evaluate(() => {
    skState.connected = true; skCourse.dest = 'k'; skCourse.mode = 'delta';
    skCourse.err = 'HTTP 400: <img src=x onerror="window.__pwned=1">';
    const status = skCourseStatusText();
    disconnectSK(); skState.host = 'boat"lan'; skState.port = 3000; updateSKStatusCard();
    const input = document.getElementById('sk-host-input');
    return { escaped: status.indexOf('&lt;img') >= 0 && status.indexOf('<img') < 0,
      host: input && input.value, pwned: !!window.__pwned };
  });
  check('server error text is escaped on the status card', x.escaped && !x.pwned, x);
  check('a quote in the host keeps the input intact', x.host === 'boat"lan:3000', x.host);

  check('legacy v1 publisher is gone', await page.evaluate(() => typeof sendNextMarkToSK === 'undefined'));
});
