/* Colour tokens: no hard-coded rounding/warning colours, tints follow the theme,
   the chart keeps its colours. Plus the weather card when a gust is missing. */
const fs = require('fs');
const path = require('path');
const { run } = require('./harness');

const HEX = ['#dc2626', '#16a34a', '#f59e0b', '#fee2e2', '#dcfce7', '#fca5a5', '#86efac'];

run('theme', async ({ open, check }) => {
  // Static: those colours live only in the CSS tokens, never in the markup or JS.
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const after = src.slice(src.indexOf('</style>'));
  const stray = HEX.filter(h => after.toLowerCase().indexOf(h) >= 0);
  check('no hard-coded rounding/warning colours outside the CSS', stray.length === 0, stray);

  const page = await open();
  const clr = await page.evaluate(() => CLR);
  check('CLR resolves every strong token', clr.port === '#dc2626' && clr.stbd === '#16a34a' && clr.warn === '#f59e0b', clr);

  // Tints follow the theme, however it's chosen.
  const tint = (theme, scheme) => page.evaluate(async ([theme, scheme]) => {
    setTheme(theme);
    const chip = document.createElement('span'); chip.className = 'npsa-mark-port';
    document.body.appendChild(chip);
    const c = getComputedStyle(chip), r = { bg: c.backgroundColor, fg: c.color };
    chip.remove(); return r;
  }, [theme, scheme]);
  const light = await tint('light'), dark = await tint('dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  const sysDark = await tint(null), sysDarkForcedLight = await tint('light');
  await page.emulateMedia({ colorScheme: 'light' });
  check('light theme: pale port chip, dark text', light.bg === 'rgb(254, 226, 226)' && light.fg === 'rgb(153, 27, 27)', light);
  check('dark theme: dark port chip, light text', dark.bg === 'rgb(58, 20, 20)' && dark.fg === 'rgb(252, 165, 165)', dark);
  check('system dark follows the dark tints', sysDark.bg === dark.bg, sysDark);
  check('manual light beats system dark', sysDarkForcedLight.bg === light.bg, sysDarkForcedLight);

  // The next-mark box uses the tints; the chart keeps its strong colours in dark mode.
  const card = await page.evaluate(async () => {
    setTheme('dark');
    document.querySelector('.nav-tab[data-tab="npsa"]').click();
    await new Promise(r => setTimeout(r, 400));
    selectCourse('E');
    Object.assign(skState, { lat: 39.20, lon: -76.45, windDir: 10, windKts: 12 });
    _laylineSig = ''; drawLaylines();
    document.querySelector('.nav-tab[data-tab="race"]').click();
    renderRaceTab();
    const box = document.querySelector('#race-content [style*="-bg)"]');
    const out = { bg: box && getComputedStyle(box).backgroundColor,
      laylines: npsaLaylineGroup.getLayers().map(l => l.options.color).sort() };
    setTheme('light');
    return out;
  });
  check('next-mark box is tinted for dark mode', card.bg === 'rgb(58, 20, 20)' || card.bg === 'rgb(15, 42, 25)', card.bg);
  check('laylines keep chart colours in dark mode', card.laylines.join() === '#16a34a,#dc2626', card.laylines);

  // Weather card with and without a gust figure.
  const gust = await page.evaluate(() => {
    const wx = g => ({ wind_speed_10m: 12, wind_direction_10m: 200, wind_gusts_10m: g, temperature_2m: 72,
      weather_code: 1, surface_pressure: 1015, visibility: 20000 });
    wxState.lat = 39.2; wxState.lon = -76.45;          // renderWx always follows a fix
    renderWx('Here', wx(null), null, null);
    const none = { text: (document.querySelector('.wx-wind-gust') || {}).textContent, state: wxState.windGust };
    renderWx('Here', wx(18.4), null, null);
    return { none, some: (document.querySelector('.wx-wind-gust') || {}).textContent, state: wxState.windGust };
  });
  check('missing gust shows --, not 0 kts', gust.none.text === 'Gusts to --' && gust.none.state === null, gust.none);
  check('gust shows when present', gust.some === 'Gusts to 18 kts' && gust.state === 18, gust);
});
