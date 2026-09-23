/* The shared 1 s job tick: the right jobs at the right periods, isolated
   from each other, and actually running in real time. */
const { run, stubSignalK } = require('./harness');

run('jobs', async ({ open, check }) => {
  const page = await open();

  const list = await page.evaluate(() => _jobs.map(j => j.name + '/' + j.sec).sort().join(' '));
  check('registered jobs and periods',
    list === 'auto-leg/2 course-sync/2 current-pub/5 sk-stale/5 start-line/1', list);

  // Which jobs fire on which tick.
  const due = await page.evaluate(() => {
    const saved = _jobs.map(j => j.fn), hits = [];
    _jobs.forEach(j => { j.fn = () => hits.push(j.name); });
    const at = n => { hits.length = 0; runJobs(n); return hits.slice().sort().join(' '); };
    const r = { t1: at(1), t2: at(2), t5: at(5), t10: at(10) };
    _jobs.forEach((j, i) => { j.fn = saved[i]; });
    return r;
  });
  check('tick 1: only 1 s jobs', due.t1 === 'start-line', due.t1);
  check('tick 2: 1 s and 2 s jobs', due.t2 === 'auto-leg course-sync start-line', due.t2);
  check('tick 5: 1 s and 5 s jobs', due.t5 === 'current-pub sk-stale start-line', due.t5);
  check('tick 10: everything', due.t10 === 'auto-leg course-sync current-pub sk-stale start-line', due.t10);

  // A job that throws is logged and doesn't stop the ones after it.
  const iso = await page.evaluate(() => {
    const logged = []; const orig = console.error; console.error = (...a) => logged.push(String(a[0]));
    let ran = false;
    _jobs.unshift({ sec: 1, name: 'boom', fn: () => { throw new Error('x'); } });
    _jobs.push({ sec: 1, name: 'after', fn: () => { ran = true; } });
    runJobs(1);
    _jobs.shift(); _jobs.pop(); console.error = orig;
    return { ran, logged: logged.join() };
  });
  check('a throwing job does not stop the rest', iso.ran, iso);
  check('the failure is logged with the job name', iso.logged.indexOf('job boom failed') >= 0, iso.logged);

  // End to end: with a course set, the real tick publishes it within ~2 s.
  await page.evaluate(stubSignalK);
  const published = await page.evaluate(async () => {
    skState.lat = null; phoneGPS.lat = 39.20; phoneGPS.lon = -76.45;
    document.querySelector('.nav-tab[data-tab="npsa"]').click(); selectCourse('E');
    window.__ws = [];
    await new Promise(r => setTimeout(r, 2300));
    return window.__ws.some(m => m.updates.some(u => u.values.some(v => v.path === 'navigation.course.nextPoint')));
  });
  check('real tick publishes the course within 2 s', published);
});
