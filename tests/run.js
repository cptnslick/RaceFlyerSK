#!/usr/bin/env node
/* Run every test: node tests/run.js   (or one: node tests/course-api.test.js) */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const jobs = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort()
  .map(f => [process.execPath, [path.join(dir, f)]]);
if (fs.existsSync(path.join(dir, 'test_serve.py'))) jobs.push(['python3', [path.join(dir, 'test_serve.py')]]);

let failed = 0;
for (const [cmd, args] of jobs) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} of ${jobs.length} suites failed` : `\nall ${jobs.length} suites passed`);
process.exit(failed ? 1 : 0);
