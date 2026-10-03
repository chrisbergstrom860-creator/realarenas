// Live API→Stats proof for grouped goals and the account-zone week strip.
// Exclusively owned fixtures, recorded at creation; no real-user writes.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from './lib/mobile-geometry.js';
import { mustWrite, makeCleanup } from './lib/checked-writes.js';
import { createClient } from '@supabase/supabase-js';
const { dayKey, addDaysToKey } = createRequire(import.meta.url)('../tzdate.js');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE = `https://${DOMAIN}/html`;
const MANIFEST = '/tmp/verify-goal-chart-manifest.json';
const PW = 'ArenasTest!234', TZ = 'America/Los_Angeles';
let checks = 0, failures = 0, browser;
const ids = [];
function check(name, ok) {
  checks++; if (!ok) failures++;
  console.log((ok ? '  ok  ' : '  FAIL ') + name);
}
function remember(type, id) { ids.push({ type, id }); fs.writeFileSync(MANIFEST, JSON.stringify(ids)); }
async function login(email) {
  const r = await fetch(BASE + '/auth/login', { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password: PW }).toString() });
  const pairs = r.headers.getSetCookie().map(c => c.split(';')[0]);
  if (r.status !== 302 || !pairs.length) throw Error('Fixture login failed');
  return pairs.map(c => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), domain: DOMAIN, path: '/' }; });
}
async function seed(table, rows) {
  const data = await mustWrite(table, admin.from(table).insert(rows).select('id'));
  data.forEach(r => remember(table, r.id)); return data;
}
async function user(tag) {
  const email = `vgc-${tag}-${Date.now()}@arenas-test.dev`;
  const { user } = await mustWrite('fixture user', admin.auth.admin.createUser({ email, password: PW, email_confirm: true,
    user_metadata: { name: 'Goal Chart Tester', sports: ['running'], timezone: TZ } }));
  remember('auth', user.id); return { id: user.id, email };
}
async function open(u, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  await context.addCookies(await login(u.email));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/profile#stats');
  await page.waitForSelector('#gvw-streak');
  return { context, page, errors };
}
const api = (page, url) => page.evaluate(async url => {
  const r = await fetch(url); if (!r.ok) throw Error('API ' + r.status); return r.json();
}, BASE + url);
async function parity(page, goals) {
  for (const period of ['weekly', 'monthly', 'custom']) {
    const rows = goals.filter(g => g.period === period && g.type !== 'streak');
    for (const type of ['frequency', 'duration', 'distance'].filter(t => rows.some(g => g.type === t))) {
      await page.locator(`.gvw-panel[data-period="${period}"] .gvw-tab[data-type="${type}"]`).click();
      const result = await page.evaluate(({ period, goals }) => {
        const host = document.querySelector(`.gvw-chart[data-period="${period}"]`);
        const shell = host.querySelector('.gc-shell');
        const max = +shell.dataset.gcScaleMax, top = +shell.dataset.gcPlotTop, bottom = +shell.dataset.gcPlotBottom;
        return goals.every(g => {
          const group = host.querySelector(`.gc-group[data-goal-id="${g.id}"]`);
          if (!group) return false;
          const a = group.querySelector('.gc-actual'), t = group.querySelector('.gc-goal'), e = group.querySelector('.gc-expected');
          const distance = g.type === 'distance';
          const actual = distance ? g.progressKm : g.progress, target = distance ? g.targetKm : g.target;
          const expected = distance ? g.expectedKm : g.expectedProgress;
          return +a.dataset.value === actual && +t.dataset.value === target && +e.dataset.value === expected &&
            Math.abs(+e.getAttribute('y1') - (bottom - expected / max * (bottom - top))) < 0.05 &&
            Math.abs(+a.getAttribute('height') - actual / max * (bottom - top)) < 0.05 &&
            group.querySelector('.gc-status').dataset.status === (g.isComplete ? 'done' : g.onTrack ? 'on' : 'behind');
        });
      }, { period, goals: rows.filter(g => g.type === type) });
      check(`${period}/${type}: target, actual, expected position, proportional height and pace match API`, result);
    }
  }
}
try {
  if (fs.existsSync(MANIFEST)) throw Error('Stale manifest: clean only its recorded fixtures before rerunning');
  const u = await user('goals'), empty = await user('empty');
  const today = dayKey(new Date(), TZ);
  const goal = (type, sport, target_value, period = 'weekly', extra = {}) => ({
    user_id: u.id, type, sport, target_value, period, status: 'active', start_date: today, ...extra
  });
  await seed('activities', [
    ...Array.from({ length: 5 }, () => ({ sport: 'running', distance: '1 mi', duration: '00:30:00' })),
    { sport: 'cycling', distance: '10 km', duration: '01:00:00' }
  ].map(a => ({ ...a, user_id: u.id, title: 'Goal chart fixture', date: new Date().toISOString() })));
  await seed('goals', [
    goal('frequency', 'cycling', 4), goal('frequency', 'running', 5),
    goal('duration', null, 10, 'monthly'), goal('distance', 'running', 20, 'monthly', { unit: 'mi' }),
    goal('streak', null, 7)
  ]);
  browser = await launchBrowser();
  for (const width of [360, 414, 1280]) {
    const { page, context, errors } = await open(u, width);
    const { active } = await api(page, '/api/goals');
    const stats = await api(page, '/api/profile/stats');
    check(`${width}: weekly chart precedes goals, streak and sport cards`, await page.evaluate(() => {
      const nodes = [document.querySelector('#sp-weekly-card'), document.querySelector('#gvw-card'), document.querySelector('#gvw-streak')];
      return nodes.every(Boolean) && nodes.slice(1).every((n, i) => nodes[i].compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
    check(`${width}: panels weekly/monthly, Custom absent`, await page.locator('.gvw-panel').evaluateAll(ps => ps.map(p => p.dataset.period).join(',') === 'weekly,monthly'));
    check(`${width}: tabs visible only for present goal types`, await page.locator('.gvw-tab').evaluateAll(ts =>
      ts.map(t => t.closest('.gvw-panel').dataset.period + ':' + t.dataset.type).join(',') === 'weekly:frequency,monthly:duration,monthly:distance'));
    check(`${width}: first available tab selected independently`, await page.locator('.gvw-tab.on').evaluateAll(ts => ts.map(t => t.dataset.type).join(',') === 'frequency,duration'));
    check(`${width}: shared scale makes 1-of-4 and 5-of-5 proportional`, await page.evaluate(() => {
      const bars = [...document.querySelectorAll('.gvw-panel[data-period="weekly"] .gc-actual')];
      const one = bars.find(b => +b.dataset.value === 1), five = bars.find(b => +b.dataset.value === 5);
      return bars.length === 2 && one && five && Math.abs(+one.getAttribute('height') / +five.getAttribute('height') - 0.2) < 0.001;
    }));
    await parity(page, active);
    check(`${width}: miles target and original-unit tooltip`, await page.evaluate(() => {
      const panel = document.querySelector('.gvw-panel[data-period="monthly"]');
      return +panel.querySelector('.gc-goal').dataset.value === 20 * 1.609 && /20.*mi/.test(panel.textContent);
    }));
    check(`${width}: weekly selection survives monthly changes`, await page.locator('.gvw-panel[data-period="weekly"] .gvw-tab.on').getAttribute('data-type') === 'frequency');
    check(`${width}: strip equals exact API days, today outlined`, await page.locator('.gvw-day').evaluateAll((nodes, strip) =>
      nodes.length === 7 && nodes.every((n, i) => n.dataset.date === strip[i].date &&
        (n.dataset.active === 'true' || n.dataset.active === '1') === strip[i].active &&
        n.classList.contains('today') === strip[i].isToday && n.classList.contains('future') === strip[i].isFuture), stats.weekStrip));
    check(`${width}: active-today copy and goal tile`, /Nice — you've logged today/.test(await page.locator('#gvw-streak').innerText()) && await page.locator('.gvw-tile-goal').count() === 1);
    check(`${width}: calendar link uses app base`, await page.locator('#gvw-streak a').first().getAttribute('href') === '/html/calendar');
    check(`${width}: no old target squares or streak bars`, await page.locator('.gvw-sq,.gvw-heat-row').count() === 0);
    check(`${width}: no overflow or errors`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && errors.length === 0);
    await context.close();
  }
  // Reuse owned rows: five weekly sessions, duplicate sports, then Custom.
  const { data: rows } = await admin.from('goals').select('id').eq('user_id', u.id).order('id');
  for (let i = 0; i < rows.length; i++) await mustWrite('five-group fixture', admin.from('goals').update({
    type: 'frequency', sport: i < 2 ? 'running' : ['cycling', 'swimming', null][i - 2], target_value: i + 6,
    period: 'weekly', unit: null
  }).eq('id', rows[i].id));
  {
    const { page, context } = await open(u, 360);
    const { active } = await api(page, '/api/goals');
    await parity(page, active);
    check('360: five groups share one chart', await page.locator('.gc-group').count() === 5);
    check('duplicates append targets and Any sport keeps registry-independent label', await page.locator('.gc-label').evaluateAll(ns => {
      const labels = ns.map(n => n.dataset.fullLabel);
      return labels.some(l => /Running · 6/.test(l)) && labels.some(l => /Running · 7/.test(l)) && labels.some(l => /Any sport/.test(l));
    }));
    check('360: printed numbers never overlap', await page.locator('.gc-value').evaluateAll(ns => {
      const r = ns.map(n => n.getBoundingClientRect());
      return r.every((a, i) => r.every((b, j) => i >= j || Math.min(a.right, b.right) - Math.max(a.left, b.left) < 0.5 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < 0.5));
    }));
    await context.close();
  }
  await mustWrite('custom fixture', admin.from('goals').update({ period: 'custom', start_date: addDaysToKey(today, -3), end_date: addDaysToKey(today, 10) }).eq('id', rows[4].id));
  {
    const { page, context } = await open(u);
    check('Custom panel appears only when custom goal exists', await page.locator('.gvw-panel[data-period="custom"]').count() === 1);
    await parity(page, (await api(page, '/api/goals')).active);
    await context.close();
  }
  {
    const { page, context } = await open(empty, 360);
    check('no-goals and no-activities: compact CTA plus zero streak block', await page.locator('.gvw-empty-cta').count() === 1 && /Log an activity to start a streak/.test(await page.locator('#gvw-streak').innerText()));
    const loaded = page.waitForResponse(r => r.url().endsWith('/api/goals') && r.request().method() === 'GET');
    await page.locator('.gvw-empty-cta').click();
    await loaded;
    await page.waitForFunction(() => !document.getElementById('goals-body').textContent.includes('Loading goals'));
    check('Set a goal opens AND loads Goals tab', await page.locator('#tab-goals').isVisible());
    await context.close();
  }
  // Sport-scoped streaks remain separate from the global streak.
  for (let i = 0; i < rows.length; i++) await mustWrite('streak scope fixture', admin.from('goals').update({
    type: 'streak', sport: [null, 'running', 'cycling', 'swimming', null][i], target_value: i === 0 ? 1 : 5,
    period: 'monthly', unit: null, end_date: null
  }).eq('id', rows[i].id));
  {
    const { page, context } = await open(u, 414);
    const { active } = await api(page, '/api/goals');
    check('streak-only goals: empty chart CTA, all five streak goals retained', await page.locator('.gvw-empty-cta').count() === 1 && await page.locator('.gvw-tile-goal,.gvw-sgoal').count() === 5);
    check('sport streak values/pace are server scoped, swimming remains zero', await page.evaluate(goals => goals.every(g => {
      const el = document.querySelector(`#gvw-streak [data-goal-id="${g.id}"]`);
      return el && el.textContent.includes(String(g.target)) && (g.sport !== 'swimming' || el.textContent.includes('0'));
    }), active));
    await context.close();
  }
} catch (e) { failures++; console.error('FAIL', e.stack); }
finally {
  if (browser) await browser.close();
  const clean = makeCleanup();
  for (const { type, id } of ids.slice().reverse()) {
    if (type !== 'auth') await clean.cw(type, admin.from(type).delete().eq('id', id));
  }
  for (const { type, id } of ids) if (type === 'auth') await clean.cw('auth fixture', admin.auth.admin.deleteUser(id));
  if (ids.length && !clean.failed()) fs.rmSync(MANIFEST, { force: true });
  failures += clean.count();
}
console.log(`${checks - failures}/${checks} GOAL CHART CHECKS PASSED; failures=${failures}`);
process.exitCode = failures ? 1 : 0;