// E2E for the "Goals vs actual" card on Stats & PRs:
//  - Values come from /api/goals enrichment ONLY — every chart bar's
//    data-value must equal the API's target/progress EXACTLY, and the printed
//    numbers must equal the Goals tab's own rendered "X of Y" strings
//    (shared __goalFmt formatting — the acceptance bar).
//  - View switcher: Weekly (3 period=weekly goals), Monthly (EMPTY — honest
//    copy + all three pills still visible), Overall (all 5 incl. streak +
//    custom, which appear nowhere else).
//  - Exceeded goal renders uncapped (actual bar taller than goal bar).
//  - Zero-progress goal renders a stub bar with value 0.
//  - Mobile 360/380/414: horizontal-bar layout, no page overflow.
//  - A user with activities but NO goals: no card at all.
//  - Zero console errors everywhere. Cleanup in finally.
import { launchBrowser } from './lib/mobile-geometry.js';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE_URL = `https://${DOMAIN}/html`;
const EMAIL = 'vgc-goals@arenas-test.dev';
const EMAIL2 = 'vgc-nogoals@arenas-test.dev';
const PW = 'ArenasTest!234';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

async function loginCookies(email) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const raw = (setC || []).filter(Boolean).map((c) => c.split(';')[0]);
  if (r.status !== 302 || !raw.length) throw new Error('login failed for ' + email);
  return raw.map((pair) => {
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: DOMAIN, path: '/' };
  });
}

const localKey = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

(async () => {
  let uid = null, uid2 = null; let browser = null;
  try {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of (data && data.users) || []) if (u.email === EMAIL || u.email === EMAIL2) await admin.auth.admin.deleteUser(u.id);
    const mk = async (email, name, handle) => {
      const { data: c, error } = await admin.auth.admin.createUser({
        email, password: PW, email_confirm: true,
        user_metadata: { name, handle, sports: ['running'] }
      });
      if (error) throw new Error('createUser: ' + error.message);
      return c.user.id;
    };
    uid = await mk(EMAIL, 'Goal Chart Tester', 'vgc_goals');
    uid2 = await mk(EMAIL2, 'No Goals Tester', 'vgc_nogoals');

    // Activities: 3 runs TODAY (in this week + this month + streak feed), a
    // 2h ride today. Today always lies inside both current windows.
    const acts = [
      { sport: 'running', distance: '5 km', duration: '00:30:00' },
      { sport: 'running', distance: '7.5 km', duration: '00:45:00' },
      { sport: 'running', distance: '3 km', duration: '00:20:00' },
      { sport: 'cycling', distance: '30 km', duration: '02:00:00' }
    ].map((a) => ({ ...a, user_id: uid, title: 'GC seed ' + a.sport, date: new Date().toISOString() }));
    // 4 more short sessions today → frequency goal (5) EXCEEDED at 8.
    for (let i = 0; i < 4; i++) acts.push({ user_id: uid, sport: 'running', title: 'GC rep ' + i, distance: '1 km', duration: '00:05:00', date: new Date().toISOString() });
    const { error: aErr } = await admin.from('activities').insert(acts);
    if (aErr) throw new Error('activities: ' + aErr.message);
    // Activities for the no-goals user too (stats render, no card).
    await admin.from('activities').insert({ user_id: uid2, sport: 'running', title: 'NG run', distance: '4 km', duration: '00:25:00', date: new Date().toISOString() });

    // 5 goals (the active cap): 3 weekly, 0 monthly (Monthly view must be
    // EMPTY), streak + custom (Overall-only).
    const goals = [
      { user_id: uid, type: 'distance', sport: 'running', unit: 'km', target_value: 40, period: 'weekly', status: 'active', start_date: localKey(0) },
      { user_id: uid, type: 'frequency', sport: null, target_value: 5, period: 'weekly', status: 'active', start_date: localKey(0) }, // exceeded (8 sessions)
      { user_id: uid, type: 'duration', sport: 'cycling', target_value: 6, period: 'weekly', status: 'active', start_date: localKey(0) },
      { user_id: uid, type: 'streak', sport: null, target_value: 14, period: 'monthly', status: 'active', start_date: localKey(0) }, // streak: Overall only, even with monthly period
      { user_id: uid, type: 'distance', sport: 'swimming', unit: 'km', target_value: 10, period: 'custom', status: 'active', start_date: localKey(-3), end_date: localKey(10) } // zero progress
    ];
    const { error: gErr } = await admin.from('goals').insert(goals);
    if (gErr) throw new Error('goals: ' + gErr.message);

    // API truth (same session the page will use).
    const cookies = await loginCookies(EMAIL);
    const cookieHeader = cookies.map((c) => c.name + '=' + c.value).join('; ');
    const api = await (await fetch(BASE_URL + '/api/goals', { headers: { cookie: cookieHeader } })).json();
    const active = api.active || [];
    check('api: 5 active goals', active.length === 5, String(active.length));
    const byType = {};
    for (const g of active) byType[g.type + ':' + (g.sport || '')] = g;
    check('api: frequency goal exceeded', (byType['frequency:'] || {}).progress > 5, JSON.stringify(byType['frequency:']));
    check('api: swimming custom goal zero progress', (byType['distance:swimming'] || {}).progress === 0, JSON.stringify(byType['distance:swimming']));

    browser = await launchBrowser();
    const openStats = async (width, email) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addCookies(await loginCookies(email || EMAIL));
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`https://${DOMAIN}/html/profile#stats`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#sp-stats-body', { timeout: 15000 });
      await page.waitForFunction(() => {
        const b = document.getElementById('sp-stats-body');
        return b && b.textContent.trim() !== 'Loading' && b.children.length > 0;
      }, null, { timeout: 15000 });
      return { context, page, errors };
    };

    const readBars = (page) => page.evaluate(() => {
      const out = {};
      document.querySelectorAll('#gvw-card .gvw-item').forEach((item) => {
        const id = item.getAttribute('data-goal-id');
        out[id] = {};
        item.querySelectorAll('.gvw-bar').forEach((b) => {
          out[id][b.getAttribute('data-kind')] = { value: Number(b.getAttribute('data-value')), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width };
        });
      });
      return out;
    });

    // ── Desktop 1280: Overall view — every value exactly matches the API ──
    {
      const { context, page, errors } = await openStats(1280);
      await page.waitForSelector('#gvw-card', { timeout: 15000 });
      const bars = await readBars(page);
      check('@1280 overall: 5 goal pairs rendered', Object.keys(bars).length === 5, String(Object.keys(bars).length));
      for (const g of active) {
        const pair = bars[g.id];
        const ok = pair && pair.goal && pair.actual && pair.goal.value === Number(g.target) && pair.actual.value === Number(g.progress);
        check(`@1280 values match API for ${g.type}:${g.sport || 'any'}`, !!ok, JSON.stringify({ pair, target: g.target, progress: g.progress }));
      }
      // Exceeded: actual bar strictly taller than goal bar (uncapped).
      const ex = bars[(byType['frequency:'] || {}).id];
      check('@1280 exceeded goal: actual bar taller than goal bar', ex && ex.actual.h > ex.goal.h, JSON.stringify(ex));
      // Zero progress: stub still visible (>=2px) with value 0.
      const zero = bars[(byType['distance:swimming'] || {}).id];
      check('@1280 zero-progress: stub bar with value 0', zero && zero.actual.value === 0 && zero.actual.h >= 2, JSON.stringify(zero));

      // ── Goals-tab equality (the acceptance bar): chart printed numbers ==
      //    Goals tab rendered "X of Y" strings, per goal id ──
      const chartText = await page.evaluate(() => {
        const out = {};
        document.querySelectorAll('#gvw-card .gvw-item').forEach((item) => {
          const vals = Array.from(item.querySelectorAll('.gvw-bar')).map((b) => {
            // printed label: desktop = prev sibling div, mobile = row trailing span
            const col = b.closest('div[style*="flex-direction:column"]');
            const lbl = col ? col.querySelector('div') : null;
            return lbl ? lbl.textContent.trim() : '';
          });
          out[item.getAttribute('data-goal-id')] = vals; // [goalText, actualText]
        });
        return out;
      });
      await page.evaluate(() => document.getElementById('htab-goals').click());
      await page.waitForFunction(() => document.querySelectorAll('#tab-goals [onclick^="archiveGoal"]').length >= 5, null, { timeout: 15000 });
      const goalsTab = await page.evaluate(() => {
        const out = {};
        document.querySelectorAll('#tab-goals [onclick^="archiveGoal"]').forEach((btn) => {
          const id = btn.getAttribute('onclick').match(/'([^']+)'/)[1];
          const card = btn.closest('div[style*="border-radius"]').parentElement.closest('div[style*="border"]') || btn.closest('div');
          // find the "X of Y unit" mono span inside the goal card
          let node = btn;
          while (node && !/\bof\b/.test(node.textContent)) node = node.parentElement;
          const m = node ? node.textContent.match(/([\d.,]+) of ([\d.,]+)/) : null;
          if (m) out[id] = { actual: m[1], goal: m[2] };
        });
        return out;
      });
      let matched = 0;
      for (const g of active) {
        const ct = chartText[g.id], gt = goalsTab[g.id];
        if (ct && gt && ct[0] === gt.goal && ct[1] === gt.actual) matched++;
        else console.log('  detail ' + g.type + ':' + (g.sport || 'any') + ' chart=' + JSON.stringify(ct) + ' goalsTab=' + JSON.stringify(gt));
      }
      check('@1280: chart strings equal Goals-tab rendered strings (5/5)', matched === 5, matched + '/5');
      check('@1280: zero console errors', errors.length === 0, errors.join(' | '));

      // ── View switcher ──
      await page.evaluate(() => document.getElementById('htab-stats').click());
      await page.waitForSelector('#gvw-card');
      await page.evaluate(() => setGoalView('weekly'));
      let n = await page.locator('#gvw-card .gvw-item').count();
      check('weekly view: 3 goals', n === 3, String(n));
      const weeklyIds = await page.evaluate(() => Array.from(document.querySelectorAll('#gvw-card .gvw-item')).map((i) => i.getAttribute('data-goal-id')));
      check('weekly view: excludes streak + custom', !weeklyIds.includes(byType['streak:'].id) && !weeklyIds.includes(byType['distance:swimming'].id));
      await page.evaluate(() => setGoalView('monthly'));
      const emptyTxt = await page.locator('#gvw-empty').textContent().catch(() => '');
      check('monthly view: honest empty copy', /No monthly goals/.test(emptyTxt), emptyTxt.slice(0, 60));
      const pills = await page.locator('#gvw-card .gvw-pill').count();
      check('monthly view: all 3 pills still visible', pills === 3, String(pills));
      await page.evaluate(() => setGoalView('overall'));
      n = await page.locator('#gvw-card .gvw-item').count();
      check('back to overall: 5 goals', n === 5, String(n));
      await context.close();
    }

    // ── Mobile widths: horizontal layout, values match, no overflow ──
    for (const w of [360, 380, 414]) {
      const { context, page, errors } = await openStats(w);
      await page.waitForSelector('#gvw-card', { timeout: 15000 });
      const bars = await readBars(page);
      check(`@${w}: 5 pairs`, Object.keys(bars).length === 5, String(Object.keys(bars).length));
      let allMatch = true;
      for (const g of active) {
        const p = bars[g.id];
        if (!p || p.goal.value !== Number(g.target) || p.actual.value !== Number(g.progress)) allMatch = false;
      }
      check(`@${w}: all values match API`, allMatch);
      // Horizontal layout: bars are wider than tall.
      const first = bars[active[0].id];
      check(`@${w}: horizontal bars`, first.goal.w > first.goal.h, JSON.stringify(first.goal));
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`@${w}: no horizontal overflow`, overflowX <= 1, String(overflowX));
      check(`@${w}: zero console errors`, errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // ── No-goals user: stats render, no card ──
    {
      const { context, page, errors } = await openStats(1280, EMAIL2);
      await page.waitForFunction(() => document.querySelectorAll('#sp-stats-body > div').length > 0, null, { timeout: 15000 });
      const card = await page.locator('#gvw-card').count();
      check('no-goals user: card absent', card === 0, String(card));
      check('no-goals user: zero console errors', errors.length === 0, errors.join(' | '));
      await context.close();
    }
  } catch (e) {
    failures++;
    console.log('  FAIL (exception) ' + e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const id of [uid, uid2]) {
      if (!id) continue;
      await admin.from('goals').delete().eq('user_id', id);
      await admin.from('activities').delete().eq('user_id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
