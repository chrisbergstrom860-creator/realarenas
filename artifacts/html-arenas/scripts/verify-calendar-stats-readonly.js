// Read-only live handler benchmark + parity, without starting/importing server.js.
// Usage: node scripts/verify-calendar-stats-readonly.js USER_ID [--timing-only]
// HTTP auth middleware is excluded: auth user is fetched once before timing.
// All requests are GET-only to the configured Supabase origin; no providers.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const tz = require('../tzdate');
const { SPORT_POINTS } = require('../sports');
const calendar = require('../calendar-stats');
const parsers = require('../html/arenas-parse');
const ROOT = path.join(__dirname, '..');

function extractFunction(source, name) {
  const match = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(source);
  assert.ok(match, 'Missing source function: ' + name);
  const end = source.indexOf('\n}', match.index);
  assert.ok(end > match.index, 'Missing function terminator: ' + name);
  return source.slice(match.index, end + 2);
}

function extractHandler(source, route, context) {
  const start = source.indexOf("app.get(BASE + '" + route + "'");
  assert.ok(start >= 0, 'Missing route: ' + route);
  const end = source.indexOf('\n});', start);
  const code = source.slice(start, end + 2);
  return vm.runInContext('(' + code.slice(code.indexOf('async (req')) + ')', context);
}

async function invoke(handler, user, query) {
  let payload;
  const response = {
    code: 200,
    status(code) { this.code = code; return this; },
    json(value) { payload = value; }
  };
  await handler({ user, query }, response);
  assert.equal(response.code, 200, payload?.error);
  assert.ok(payload && !payload.error, 'Missing successful handler payload');
  return payload;
}

async function main() {
  const userId = process.argv[2];
  assert.match(userId || '', /^[0-9a-f-]{36}$/i, 'Pass a user UUID explicitly');
  assert.ok(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, 'Service-role environment required');
  const origin = new URL(process.env.SUPABASE_URL).origin;
  let requests = [];
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, options) => {
      assert.equal(options?.method || 'GET', 'GET', 'Non-read request blocked');
      assert.equal(new URL(url).origin, origin, 'Non-Supabase request blocked');
      requests.push(new URL(url).pathname);
      return fetch(url, options);
    } }
  });
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const context = vm.createContext({ console, supabaseAdmin: admin, ...tz, ...calendar, ...parsers, SPORT_POINTS });
  for (const name of [
    'calculatePoints',
    'eventImageVersion', 'attachPlanSeries', 'visibleEventsFilter',
    'buildEventAccessCtx', 'canUserSeeEvent'
  ]) vm.runInContext(extractFunction(source, name), context);
  const handler = extractHandler(source, '/api/calendar/month', context);
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw error;
  const user = data.user;
  const accountTimezone = tz.getUserTimezone(user);
  const month = tz.monthKey(new Date(), accountTimezone);
  console.log(JSON.stringify({ month, accountTimezone, browserTimezone: 'unknown; cannot infer from machine timezone' }));
  let payload;
  for (let i = 0; i < 3; i++) {
    requests = [];
    const start = performance.now();
    payload = await invoke(handler, user, { month });
    const ms = +(performance.now() - start).toFixed(1);
    console.log(JSON.stringify({
      run: i + 1, ms, calls: requests.length, paths: requests,
      counts: { events: payload.events.length, activities: payload.activities.length, plans: payload.plans.length }
    }));
    assert.ok(requests.length <= 7, 'Calendar exceeded seven read round trips');
  }
  if (process.argv.includes('--timing-only')) return;
  const profile = await invoke(extractHandler(source, '/api/profile/stats', context), user, { period: 'month' });
  const { createAiInsightsRuntime } = require('../ai-insights-runtime');
  const { createAiInsightsService } = require('../ai-insights-service');
  const runtime = createAiInsightsRuntime({ supabaseAdmin: admin });
  // Use the exact server parsers for the web-service dependency contract.
  const insights = await createAiInsightsService({
    ...runtime,
    parseDurationHours: context.parseDurationHours,
    parseDistanceKmUnitAware: context.parseDistanceKmUnitAware,
    calculatePoints: context.calculatePoints,
    createAnthropicClient() { throw new Error('Provider calls prohibited'); }
  }).buildContextForAuthenticatedUser(user);
  const monthly = insights.last12Months.find(row => row.month === month);
  const comparison = {
    calendar: payload.stats,
    profile: { sessions: profile.hero.activities, hours: profile.hero.totalHours, distanceKm: profile.hero.totalKm },
    insights: {
      sessions: monthly.sessions, hours: monthly.durationHours, distanceKm: monthly.distanceKm,
      activeDays: monthly.activeDays, restDays: monthly.restDays, observedDays: monthly.observedDays
    }
  };
  console.log(JSON.stringify(comparison));
  for (const field of ['sessions', 'hours', 'distanceKm']) assert.equal(payload.stats[field], comparison.profile[field], 'Profile ' + field);
  for (const field of Object.keys(comparison.insights)) assert.equal(payload.stats[field], comparison.insights[field], 'Insights ' + field);
  assert.ok(payload.activities.every(a => 'notes' in a && 'feeling' in a && 'distanceKm' in a && 'durationMinutes' in a));
  console.log('PASS: live calendar/Profile Stats/Insights monthly parity; activity fields present');
}

module.exports = { extractFunction, extractHandler, invoke };
if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});