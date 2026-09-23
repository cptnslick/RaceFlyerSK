/* Shared Playwright harness for the headless UI tests.
   Each test file calls run(name, async ({open, check}) => {...}); every
   check() is a named pass/fail, and any uncaught page error fails the file. */
const path = require('path');
const fs = require('fs');

function loadPlaywright() {
  try { return require('playwright'); }
  catch (e) { return require('/opt/node22/lib/node_modules/playwright'); }  /* Claude Code on the web */
}
const { chromium } = loadPlaywright();

const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const EXE = process.env.CHROMIUM ||
  (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

async function run(name, body) {
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const results = [], errors = [];
  const check = (label, ok, detail) => results.push({ label, ok: !!ok, detail });

  /* A fresh phone-sized page on the app; `init` runs before the app's script. */
  const open = async (init) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', e => errors.push(e.message));
    if (init) await page.addInitScript(init);
    await page.goto(APP);
    await page.waitForTimeout(300);
    return page;
  };

  try { await body({ open, check }); }
  catch (e) { results.push({ label: 'test threw: ' + e.message, ok: false }); }
  await browser.close();
  check('no page errors', errors.length === 0, errors.join(' | '));

  const failed = results.filter(r => !r.ok);
  console.log(`${failed.length ? 'FAIL' : 'ok  '}  ${name}  (${results.length - failed.length}/${results.length})`);
  failed.forEach(r => console.log(`        ✗ ${r.label}${r.detail !== undefined ? '  → ' + JSON.stringify(r.detail) : ''}`));
  process.exitCode = failed.length ? 1 : 0;
}

/* Stub the Signal K socket + REST so course sync can run with no server.
   Returns nothing; state lives on window.__ws / window.__http. */
function stubSignalK() {
  window.__ws = []; window.__http = [];
  window.__putStatus = 200; window.__errBody = null;
  window.fetch = (url, opts) => {
    window.__http.push({ url, method: (opts && opts.method) || 'GET',
      body: opts && opts.body ? JSON.parse(opts.body) : null });
    return Promise.resolve({
      ok: window.__putStatus >= 200 && window.__putStatus < 300,
      status: window.__putStatus,
      json: () => window.__errBody === null ? Promise.reject(new Error('not json')) : Promise.resolve(window.__errBody)
    });
  };
  skState.ws = { readyState: 1, send: s => window.__ws.push(JSON.parse(s)), close() {} };
  skState.connected = true; skState.scheme = 'ws'; skState.host = 'openplotter.local'; skState.port = 3000;
}

module.exports = { run, stubSignalK };
