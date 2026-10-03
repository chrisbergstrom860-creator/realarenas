'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
function load(db, instant, ref) {
  const source = ref
    ? execFileSync('git', ['show', `${ref}:artifacts/html-arenas/server.js`], { encoding: 'utf8', maxBuffer: 3000000 })
    : fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return new Date(instant).getTime(); } }
  const routes = {};
  let dates = require('../../tzdate');
  if (ref) {
    const dateSource = execFileSync('git', ['show', `${ref}:artifacts/html-arenas/tzdate.js`], { encoding: 'utf8' });
    const dateCtx = { module: { exports: {} }, Date: Clock, Intl };
    vm.runInNewContext(dateSource, dateCtx);
    dates = dateCtx.module.exports;
  }
  const ctx = vm.createContext({
    ...dates, ...require('../../sports'), ...require('../../html/arenas-parse'),
    // Required modules otherwise retain Node's real clock outside this VM.
    computeStreaks: (rows, tz, nowMs) => dates.computeStreaks(rows, tz, nowMs ?? Clock.now()),
    supabaseAdmin: db, Date: Clock, console, BASE: '', requireAuth() {},
    requireProPlan: () => () => {}, app: { get: (url, ...args) => { routes[url] = args.at(-1); } }
  });
  const section = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    if (a < 0 || b < 0) throw Error('Missing proof boundary: ' + start);
    vm.runInContext(source.slice(a, b), ctx);
  };
  section('function calculatePoints(', 'function summarizePoints(');
  section('async function fetchAllRows(', '// Full-coverage data export.');
  section('const GOAL_TYPES =', '// Create a goal — Pro-gated.');
  section("app.get(BASE + '/api/profile/stats'", '// ── AI INSIGHTS');
  return {
    ctx,
    async invoke(url, user, query = {}) {
      let status = 200, body;
      await routes[url]({ user, query }, { status(n) { status = n; return this; }, json(x) { body = x; } });
      if (status !== 200) throw Error(url + ' failed: ' + JSON.stringify(body));
      return JSON.parse(JSON.stringify(body));
    }
  };
}
module.exports = { load };