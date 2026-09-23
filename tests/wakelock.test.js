/* Screen wake lock: held on the Race tab and during a start sequence, never leaked. */
const { run } = require('./harness');

/* Runs before the app: a controllable navigator.wakeLock and document.hidden. */
function stubWakeLock() {
  window.__wl = { requests: 0, releases: 0, deny: false, hold: false, held: [], live: [] };
  const sentinel = (type) => {
    const listeners = [];
    const s = { type, released: false,
      addEventListener: (n, f) => { if (n === 'release') listeners.push(f); },
      release() { if (this.released) return Promise.resolve(); this.released = true;
        window.__wl.releases++; listeners.forEach(f => f()); return Promise.resolve(); } };
    window.__wl.live.push(s);
    return s;
  };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
    request: (type) => {
      window.__wl.requests++;
      if (window.__wl.deny) return Promise.reject(new Error('denied'));
      const s = sentinel(type);
      if (window.__wl.hold) return new Promise(res => window.__wl.held.push(() => res(s)));
      return Promise.resolve(s);
    } } });
  window.__hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
}

run('wakelock', async ({ open, check }) => {
  const page = await open(stubWakeLock);
  const st = () => page.evaluate(() => ({ requests: __wl.requests, held: !!_wakeLock,
    unreleased: __wl.live.filter(s => !s.released).length }));
  const tab = async (t) => { await page.click(`.nav-tab[data-tab="${t}"]`); await page.waitForTimeout(60); };
  const setHidden = async (h) => { await page.evaluate(h => { window.__hidden = h;
    document.dispatchEvent(new Event('visibilitychange')); }, h); await page.waitForTimeout(60); };

  check('no lock at startup', !(await st()).held);

  await tab('race');
  let s = await st();
  check('Race tab acquires one lock', s.held && s.requests === 1, s);

  await tab('race');
  s = await st();
  check('re-entering Race does not stack locks', s.requests === 1 && s.unreleased === 1, s);

  await tab('trim');
  s = await st();
  check('leaving Race releases', !s.held && s.unreleased === 0, s);

  await tab('race');
  await setHidden(true);
  const hidden = await st();
  await setHidden(false);
  s = await st();
  check('hidden page drops the lock', !hidden.held, hidden);
  check('returning to the page re-acquires', s.held && s.unreleased === 1, s);

  await tab('dash');
  const before = (await st()).requests;
  await setHidden(false);
  s = await st();
  check('visible on another tab: no request', !s.held && s.requests === before, s);

  await page.evaluate(() => { __wl.deny = true; });
  await tab('race');
  check('refused request leaves clean state', !(await st()).held);
  await page.evaluate(() => { __wl.deny = false; });

  // Two syncs while the first request is still pending → only one request.
  await tab('dash');
  await page.evaluate(() => { __wl.hold = true; });
  const r0 = (await st()).requests;
  await tab('race');
  await page.evaluate(() => syncWakeLock());
  const midFlight = (await st()).requests - r0;
  await page.evaluate(() => { __wl.hold = false; __wl.held.splice(0).forEach(f => f()); });
  await page.waitForTimeout(60);
  s = await st();
  check('pending request guards against a second', midFlight === 1, midFlight);
  check('resolved pending request is held, no leak', s.held && s.unreleased === 1, s);

  // The OS revokes while we're still visible on Race → re-acquire.
  const r1 = (await st()).requests;
  await page.evaluate(() => _wakeLock.release());
  await page.waitForTimeout(60);
  s = await st();
  check('OS revocation is re-acquired', s.held && s.requests > r1 && s.unreleased === 1, s);

  // The start sequence shares the same lock.
  await tab('dash');
  await page.evaluate(() => { timerState.running = true; syncWakeLock(); });
  await page.waitForTimeout(60);
  check('running sequence holds the lock on any tab', (await st()).held);
  await tab('race');
  s = await st();
  check('Race + running sequence: still exactly one lock', s.held && s.unreleased === 1, s);
  await page.evaluate(() => { timerState.running = false; syncWakeLock(); });
  await page.waitForTimeout(60);
  check('gun on the Race tab keeps the lock', (await st()).held);
  await tab('dash');
  await page.evaluate(() => { timerState.running = true; syncWakeLock(); });
  await page.waitForTimeout(60);
  await page.evaluate(() => { timerState.running = false; syncWakeLock(); });
  await page.waitForTimeout(60);
  s = await st();
  check('gun on another tab releases', !s.held && s.unreleased === 0, s);

  // No Wake Lock API at all.
  const bare = await open(() => Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined }));
  await bare.click('.nav-tab[data-tab="race"]');
  await bare.waitForTimeout(60);
  check('unsupported browser still switches tabs',
    await bare.evaluate(() => document.getElementById('tab-race').classList.contains('active')));
});
