/* Live refreshes patch the screen in place instead of rebuilding it, so a tap
   that straddles a refresh still lands, and what's shown matches a fresh render. */
const { run } = require('./harness');

run('live-render', async ({ open, check }) => {
  const page = await open();
  await page.evaluate(() => {
    document.querySelector('.nav-tab[data-tab="npsa"]').click();
    selectCourse('E');
    document.querySelector('.nav-tab[data-tab="race"]').click();
    Object.assign(skState, { lat: 39.20, lon: -76.45, sogKts: 6, cogDeg: 40, windKts: 12, windDir: 10,
      _speedApp: 8, _angleApp: 0.6, stwKts: 5.5 });
    renderRaceTab();
  });

  // The ▶ button survives refreshes as the same element while the numbers move.
  const same = await page.evaluate(() => {
    const btn = () => Array.from(document.querySelectorAll('#race-content button')).find(b => b.textContent === '▶');
    const before = btn(), text = document.getElementById('race-content').textContent;
    for (let i = 0; i < 5; i++) { skState.lat += 0.002; skState.sogKts += 0.3; renderRaceTab(); }
    return { kept: !!before && before === btn() && before.isConnected,
      changed: document.getElementById('race-content').textContent !== text };
  });
  check('▶ button is the same element across refreshes', same.kept, same);
  check('live numbers still update', same.changed, same);

  // A real click while the tab refreshes every 5 ms still advances the leg.
  await page.evaluate(() => { raceState.legIdx = 1;
    window.__iv = setInterval(() => { skState.lat += 0.0001; renderRaceTab(); }, 5); });
  let clickErr = null;   // 40 ms press spans ~8 refreshes
  try { await page.click('#race-content button:text-is("▶")', { delay: 40, timeout: 3000 }); }
  catch (e) { clickErr = e.message.split('\n')[0]; }
  const leg = await page.evaluate(() => { clearInterval(window.__iv); return raceState.legIdx; });
  check('tap during rapid refresh advances the leg', !clickErr && leg === 2, clickErr || leg);

  // Patched DOM is identical to a from-scratch render, across layout changes.
  const states = [
    ['beat', { windDir: 10, cogDeg: 40 }],
    ['run', { windDir: 190, cogDeg: 20 }],
    ['no wind', { windKts: null, windDir: null, _speedApp: null, _angleApp: null }],
    ['wind back', { windKts: 14, windDir: 30, _speedApp: 9, _angleApp: 0.5 }],
    ['no course', null],
    ['course again', 'E'],
  ];
  for (const [name, st] of states) {
    const r = await page.evaluate((st) => {
      if (st === null) clearCourseSelection();
      else if (typeof st === 'string') selectCourse(st);
      else Object.assign(skState, st);
      renderRaceTab();
      const el = document.getElementById('race-content'), live = el.innerHTML;
      el.innerHTML = ''; renderRaceTab();               // empty container → fresh build
      return { match: live === el.innerHTML, len: live.length };
    }, st);
    check(`patched render matches a fresh render: ${name}`, r.match && r.len > 0, r);
  }

  // Same guarantee for the Courses-tab card and the Signal K status card.
  const other = await page.evaluate(() => {
    selectCourse('E'); renderNpsaNextMark();
    const c = document.getElementById('npsa-next-mark');
    const cBtn = c.querySelector('button');
    skState.lat += 0.003; renderNpsaNextMark();
    skState.connected = true; updateSKStatusCard();
    const sk = document.getElementById('sk-card'), skBtn = sk.querySelector('button');
    skState.sogKts = 7.7; updateSKStatusCard();
    return { courses: !!cBtn && cBtn === c.querySelector('button'),
      sk: !!skBtn && skBtn === sk.querySelector('button') && sk.textContent.indexOf('7.7') >= 0 };
  });
  check('Courses-tab card keeps its buttons', other.courses, other);
  check('Signal K card keeps its button and updates', other.sk, other);

  // Typing into the Signal K host box isn't wiped by a refresh.
  const typed = await page.evaluate(() => {
    skState.connected = false; updateSKStatusCard();
    const input = document.getElementById('sk-host-input');
    input.value = '192.168.1.50:3000';
    updateSKStatusCard();
    const now = document.getElementById('sk-host-input');
    return { same: input === now, value: now && now.value };
  });
  check('host being typed survives a status-card refresh', typed.same && typed.value === '192.168.1.50:3000', typed);
});
