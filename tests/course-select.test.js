/* Choosing, clearing and switching course sets. */
const { run, stubSignalK } = require('./harness');

run('course-select', async ({ open, check }) => {
  const page = await open();
  await page.click('.nav-tab[data-tab="npsa"]');
  await page.waitForTimeout(400);                 // map init runs on a 120 ms timer
  await page.evaluate(stubSignalK);
  await page.evaluate(() => { skState.lat = null; phoneGPS.lat = 39.20; phoneGPS.lon = -76.45; });

  const snap = () => page.evaluate(() => ({
    courseId: raceState.courseId,
    sel: document.getElementById('npsa-course-sel').value,
    course: npsaLayerGroup.getLayers().length,
    labels: npsaLabelGroup.getLayers().length,
    laylines: npsaLaylineGroup.getLayers().length,
    startLine: npsaLineGroup.getLayers().length,
    card: document.getElementById('npsa-next-mark').innerHTML.length,
    raceCard: nextMarkCardHTML().length,
    stored: lsGet('course_' + npsaClub) || ''
  }));
  const blank = s => s.courseId === '' && s.sel === '' && s.course === 0 && s.labels === 0 &&
    s.laylines === 0 && s.card === 0 && s.raceCard === 0 && s.stored === '';

  await page.selectOption('#npsa-course-sel', 'E');
  await page.waitForTimeout(150);
  let s = await snap();
  check('picking a course draws it everywhere',
    s.courseId === 'E' && s.course > 0 && s.labels > 0 && s.card > 0 && s.raceCard > 0 && s.stored === 'E', s);
  await page.evaluate(() => syncCourseToSK());      // publish it, as the 2 s tick would

  await page.selectOption('#npsa-course-sel', '');
  await page.waitForTimeout(150);
  s = await snap();
  check('"Select course…" clears map, labels, laylines, both cards and storage', blank(s), s);

  const sk = await page.evaluate(() => {
    window.__ws = []; syncCourseToSK();
    const v = {}; window.__ws.forEach(m => m.updates.forEach(u => u.values.forEach(x => { v[x.path] = x.value; })));
    return { nulled: v['navigation.course.nextPoint'] === null, dest: skCourse.dest };
  });
  check('clearing drops the Signal K destination', sk.nulled && sk.dest === '', sk);

  const line = await page.evaluate(() => {
    lineState.pin = [39.19, -76.46]; lineState.boat = [39.19, -76.44]; drawStartLine();
    const before = npsaLineGroup.getLayers().length;
    selectCourse('E'); clearCourseSelection();
    return { before, after: npsaLineGroup.getLayers().length };
  });
  check('pinged start line survives a course clear', line.before > 0 && line.after === line.before, line);

  await page.selectOption('#npsa-course-sel', 'E');
  await page.waitForTimeout(150);
  await page.selectOption('#npsa-club-sel', 'rcra');
  await page.waitForTimeout(200);
  s = await snap();
  check('changing the course set clears the course', blank(s), s);
  check('course set change keeps the start line', s.startLine > 0, s.startLine);
  check('course list is repopulated for the new set',
    await page.evaluate(() => document.querySelectorAll('#npsa-course-sel option').length > 1));

  await page.selectOption('#npsa-club-sel', 'npsa');
  await page.waitForTimeout(200);
  check('switching back does not resurrect the old course', blank(await snap()));

  await page.selectOption('#npsa-course-sel', 'E');
  await page.waitForTimeout(150);
  await page.reload();
  await page.click('.nav-tab[data-tab="npsa"]');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ id: raceState.courseId, sel: document.getElementById('npsa-course-sel').value }));
  check('a selected course survives a reload', r.id === 'E' && r.sel === 'E', r);
});
