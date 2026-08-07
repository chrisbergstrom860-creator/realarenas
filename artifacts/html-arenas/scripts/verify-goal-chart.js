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
import { mustWrite, makeCleanup } from './lib/checked-writes.js';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
const { computeStreaks, dayKey, zoneMidnightUtc } = createRequire(import.meta.url)('../tzdate.js');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE_URL = `https://${DOMAIN}/html`;
const EMAIL = 'vgc-goals@arenas-test.dev';
const EMAIL2 = 'vgc-nogoals@arenas-test.dev';
const EMAIL3 = 'vgc-streak@arenas-test.dev';
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
  let uid = null, uid2 = null, uid3 = null; let browser = null;
  try {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of (data && data.users) || []) if ([EMAIL, EMAIL2, EMAIL3].includes(u.email)) await mustWrite('pre-cleanup deleteUser ' + u.email, admin.auth.admin.deleteUser(u.id));
    const mk = async (email, name, handle, extraMeta) => {
      const { data: c, error } = await admin.auth.admin.createUser({
        email, password: PW, email_confirm: true,
        user_metadata: { name, handle, sports: ['running'], ...(extraMeta || {}) }
      });
      if (error) throw new Error('createUser: ' + error.message);
      return c.user.id;
    };
    uid = await mk(EMAIL, 'Goal Chart Tester', 'vgc_goals');
    uid2 = await mk(EMAIL2, 'No Goals Tester', 'vgc_nogoals');
    // Streak-scoping user in a non-UTC zone (day-boundary case is real).
    uid3 = await mk(EMAIL3, 'Streak Scope Tester', 'vgc_streak', { timezone: 'America/New_York' });

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
    await mustWrite('no-goals user activity seed', admin.from('activities').insert({ user_id: uid2, sport: 'running', title: 'NG run', distance: '4 km', duration: '00:25:00', date: new Date().toISOString() }));

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

    const readHeat = (page) => page.evaluate(() => {
      const out = {};
      document.querySelectorAll('#gvw-card .gvw-heat-row').forEach((r) => {
        out[r.getAttribute('data-goal-id')] = {
          target: Number(r.getAttribute('data-target')),
          progress: Number(r.getAttribute('data-progress')),
          squares: r.querySelectorAll('.gvw-sq').length,
          filled: r.querySelectorAll('.gvw-sq[data-filled="1"]').length,
          value: (r.querySelector('.gvw-heat-value') || {}).textContent || '',
          label: (r.textContent || '').replace(/\s+/g, ' ')
        };
      });
      return out;
    });
    const readPanels = (page) => page.evaluate(() =>
      Array.from(document.querySelectorAll('#gvw-card .gvw-panel')).map((p) => ({
        period: p.getAttribute('data-period'),
        goals: p.querySelectorAll('.gvw-item').length,
        title: (Array.from(p.children).pop() || {}).textContent || ''
      })));

    const streakGoal = byType['streak:'];
    const nonStreak = active.filter((g) => g.type !== 'streak');

    // ── Desktop 1280: sectioned panels — every value exactly matches the API ──
    {
      const { context, page, errors } = await openStats(1280);
      await page.waitForSelector('#gvw-card', { timeout: 15000 });
      // Panels: weekly(3) + custom(1) render, monthly (no goals) is ABSENT.
      const panels = await readPanels(page);
      check('@1280 panels: weekly(3) + custom(1), monthly absent',
        panels.length === 2 && panels[0].period === 'weekly' && panels[0].goals === 3 && panels[1].period === 'custom' && panels[1].goals === 1,
        JSON.stringify(panels));
      check('@1280 panel titles: uppercase Weekly/Custom treatment', /Weekly/.test(panels[0].title) && /Custom/.test(panels[1].title), JSON.stringify(panels.map((p) => p.title)));
      check('@1280 pills gone (no view switcher)', await page.locator('#gvw-card .gvw-pill').count() === 0);
      // Position: bottom of the tab — last card in the body, below Weekly activity.
      const pos = await page.evaluate(() => {
        const body = document.getElementById('sp-stats-body');
        const card = document.getElementById('gvw-card');
        const txt = body.textContent;
        return { last: body.lastElementChild === card, afterWeekly: txt.indexOf('Weekly activity') < txt.indexOf('Goals vs actual') };
      });
      check('@1280 position: card is LAST, below Weekly activity', pos.last && pos.afterWeekly, JSON.stringify(pos));
      const bars = await readBars(page);
      check('@1280: 4 bar pairs (streak leaves the bar sections)', Object.keys(bars).length === 4, String(Object.keys(bars).length));
      for (const g of nonStreak) {
        const pair = bars[g.id];
        const ok = pair && pair.goal && pair.actual && pair.goal.value === Number(g.target) && pair.actual.value === Number(g.progress);
        check(`@1280 values match API for ${g.type}:${g.sport || 'any'}`, !!ok, JSON.stringify({ pair, target: g.target, progress: g.progress }));
      }
      // Heat map: the monthly-period streak goal renders as squares, one row.
      const heat = await readHeat(page);
      const hr = heat[streakGoal.id];
      check('@1280 heat: streak row with target squares, progress filled',
        Object.keys(heat).length === 1 && hr && hr.squares === Number(streakGoal.target) && hr.filled === Math.min(Number(streakGoal.progress), Number(streakGoal.target)),
        JSON.stringify(heat));
      check('@1280 heat: "N of M" matches API', hr && hr.value.trim() === `${streakGoal.progress} of ${streakGoal.target}`, hr && hr.value);
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
      for (const g of nonStreak) {
        const ct = chartText[g.id], gt = goalsTab[g.id];
        if (ct && gt && ct[0] === gt.goal && ct[1] === gt.actual) matched++;
        else console.log('  detail ' + g.type + ':' + (g.sport || 'any') + ' chart=' + JSON.stringify(ct) + ' goalsTab=' + JSON.stringify(gt));
      }
      check('@1280: chart strings equal Goals-tab rendered strings (4/4)', matched === 4, matched + '/4');
      // Heat "N of M" equals the Goals-tab rendered strings for the streak goal.
      const sgt = goalsTab[streakGoal.id];
      check('@1280: heat value string equals Goals-tab strings', sgt && hr.value.trim() === `${sgt.actual} of ${sgt.goal}`, JSON.stringify({ heat: hr.value, goalsTab: sgt }));
      check('@1280: zero console errors', errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // ── Sport-scoped streak goals (uid3, America/New_York) ──
    // Days: running today + "yesterday" logged at 23:30 NY (= today's UTC
    // date — the boundary case), cycling-ONLY 2 days ago, running 3 days ago.
    //  any-sport streak = 4 · running = 2 (broken by the cycling-only day
    //  even though the user trained) · cycling = 0 (last day too old) ·
    //  swimming = 0 (never logged — must NOT fall back to sport-blind).
    {
      const TZ3 = 'America/New_York';
      const todayK = dayKey(new Date(), TZ3);
      const dk = (off) => { // ISO timestamp at NY noon, `off` days back
        const mid = zoneMidnightUtc(dayKey(new Date(Date.now() + off * 86400000), TZ3));
        return new Date(mid.getTime() + 12 * 3600000).toISOString();
      };
      const boundary = new Date(zoneMidnightUtc(todayK).getTime() - 30 * 60000).toISOString(); // 23:30 NY yesterday
      const acts3 = [
        { sport: 'running', date: dk(0), title: 'run today' },
        { sport: 'running', date: boundary, title: 'run 23:30 NY yesterday' },
        { sport: 'cycling', date: dk(-2), title: 'ride only' },
        { sport: 'running', date: dk(-3), title: 'run -3' }
      ].map((a) => ({ ...a, user_id: uid3, distance: '5 km', duration: '00:30:00' }));
      const { error: a3Err } = await admin.from('activities').insert(acts3);
      if (a3Err) throw new Error('acts3: ' + a3Err.message);
      // any-sport target 3 < streak 4 → the OVERSHOOT row ("4 of 3", squares
      // full but the number carries the excess). Plus one monthly frequency
      // goal so uid3 exercises a period panel alongside the heat map.
      const { error: g3Err } = await admin.from('goals').insert([
        { user_id: uid3, type: 'streak', sport: null, target_value: 3, period: 'monthly', status: 'active', start_date: localKey(0) },
        { user_id: uid3, type: 'streak', sport: 'running', target_value: 5, period: 'monthly', status: 'active', start_date: localKey(0) },
        { user_id: uid3, type: 'streak', sport: 'cycling', target_value: 3, period: 'monthly', status: 'active', start_date: localKey(0) },
        { user_id: uid3, type: 'streak', sport: 'swimming', target_value: 5, period: 'monthly', status: 'active', start_date: localKey(0) },
        { user_id: uid3, type: 'frequency', sport: null, target_value: 20, period: 'monthly', status: 'active', start_date: localKey(0) }
      ]);
      if (g3Err) throw new Error('goals3: ' + g3Err.message);

      // Independent expectations from the SAME shared helper (one boundary rule).
      const expAny = computeStreaks(acts3, TZ3).currentStreak;
      const expBySport = (s) => computeStreaks(acts3.filter((a) => a.sport === s), TZ3).currentStreak;
      check('streak seed: any-sport expectation is 4', expAny === 4, String(expAny));
      check('streak seed: running expectation is 2 (broken by cycling-only day)', expBySport('running') === 2, String(expBySport('running')));

      const ck3 = await loginCookies(EMAIL3);
      const hdr3 = { cookie: ck3.map((c) => c.name + '=' + c.value).join('; ') };
      const api3 = await (await fetch(BASE_URL + '/api/goals', { headers: hdr3 })).json();
      const by3 = {};
      for (const g of api3.active || []) by3[g.type + ':' + (g.sport || 'any')] = g;
      check('streak any-sport progress matches helper (4)', by3['streak:any'] && by3['streak:any'].progress === expAny, JSON.stringify(by3['streak:any']));
      check('streak running progress = 2 (sport-scoped, gap breaks it)', by3['streak:running'] && by3['streak:running'].progress === 2, JSON.stringify(by3['streak:running']));
      check('streak cycling progress = 0 (last day too old)', by3['streak:cycling'] && by3['streak:cycling'].progress === 0, JSON.stringify(by3['streak:cycling']));
      check('streak swimming progress = 0 (never logged — no sport-blind fallback)', by3['streak:swimming'] && by3['streak:swimming'].progress === 0, JSON.stringify(by3['streak:swimming']));

      // Profile display + feed sidebar remain sport-blind and unchanged.
      const stats3 = await (await fetch(BASE_URL + '/api/profile/stats?period=all&weeks=12', { headers: hdr3 })).json();
      check('profile stats current streak unchanged (sport-blind 4)', stats3.streaks && stats3.streaks.current === expAny, JSON.stringify(stats3.streaks));
      const feedHtml = await (await fetch(BASE_URL + '/feed', { headers: hdr3 })).text();
      const fm = feedHtml.match(/"currentStreak":(\d+)/);
      check('feed sidebar streak unchanged (sport-blind 4)', fm && Number(fm[1]) === expAny, fm && fm[1]);

      // Surfaces: heat map rows, monthly panel, Goals tab titles, Overview.
      const { context, page, errors } = await openStats(1280, EMAIL3);
      await page.waitForSelector('#gvw-card', { timeout: 15000 });
      const heat3 = await readHeat(page);
      check('heat: 4 streak rows, no streak bar pairs', Object.keys(heat3).length === 4 && Object.keys(await readBars(page)).length === 1, JSON.stringify(Object.keys(heat3)));
      const row3 = (k) => heat3[(by3[k] || {}).id];
      check('heat: running row labeled "Running … Streak (days)"', row3('streak:running') && /Running — Streak \(days\)/.test(row3('streak:running').label), JSON.stringify(row3('streak:running')));
      check('heat: any-sport row labeled "Any sport … Streak (days)"', row3('streak:any') && /Any sport — Streak \(days\)/.test(row3('streak:any').label));
      // OVERSHOOT (user-pinned): 4-day streak vs target 3 → all 3 squares full
      // but the text reads "4 of 3", never a clamped "3 of 3".
      const ov = row3('streak:any');
      check('heat OVERSHOOT: all squares full, text "4 of 3" not clamped', ov && ov.squares === 3 && ov.filled === 3 && ov.value.trim() === '4 of 3' && !/^3 of 3$/.test(ov.value.trim()), JSON.stringify(ov));
      const run3 = row3('streak:running');
      check('heat: running 2 of 5 → 2 yellow, 3 gray', run3 && run3.squares === 5 && run3.filled === 2 && run3.value.trim() === '2 of 5', JSON.stringify(run3));
      const swim3 = row3('streak:swimming');
      check('heat RESET: swimming 0 of 5 → all squares gray', swim3 && swim3.squares === 5 && swim3.filled === 0 && swim3.value.trim() === '0 of 5', JSON.stringify(swim3));
      // Monthly panel renders alongside the heat map with the frequency pair.
      const panels3 = await readPanels(page);
      const freq3 = by3['frequency:any'];
      const bars3 = await readBars(page);
      check('monthly panel: frequency goal pair matches API', panels3.length === 1 && panels3[0].period === 'monthly' && bars3[freq3.id] && bars3[freq3.id].actual.value === Number(freq3.progress) && bars3[freq3.id].goal.value === Number(freq3.target), JSON.stringify({ panels3, pair: bars3[freq3.id], freq3 }));
      await page.evaluate(() => document.getElementById('htab-goals').click());
      await page.waitForFunction(() => document.querySelectorAll('#tab-goals [onclick^="archiveGoal"]').length >= 5, null, { timeout: 15000 });
      const goalsTxt = await page.evaluate(() => document.getElementById('tab-goals').textContent);
      check('Goals tab: "5-day running streak" title', /5-day running streak/.test(goalsTxt));
      // "3-day streak" (no sport word between) can only come from the
      // any-sport goal; the cycling goal renders "3-day cycling streak".
      check('Goals tab: any-sport title stays "3-day streak"', /3-day streak/.test(goalsTxt));
      await page.evaluate(() => document.getElementById('htab-overview').click());
      await page.waitForFunction(() => /streak/i.test((document.getElementById('tab-overview') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
      const ovTxt = await page.evaluate(() => (document.getElementById('tab-overview') || {}).textContent || '');
      check('Overview mini-card renders a streak goal title', /-day (\w+ )?streak/.test(ovTxt), ovTxt.slice(0, 120));
      check('streak surfaces: zero console errors', errors.length === 0, errors.join(' | '));
      await context.close();

      // ── Large target at 360px: fixed 14px squares WRAP, no shrink/overflow ──
      await mustWrite('streak goal target update', admin.from('goals').update({ target_value: 40 }).eq('id', by3['streak:running'].id));
      const m = await openStats(360, EMAIL3);
      await m.page.waitForSelector('#gvw-card .gvw-heat-row', { timeout: 15000 });
      const wrap = await m.page.evaluate((gid) => {
        const row = document.querySelector('.gvw-heat-row[data-goal-id="' + gid + '"]');
        const sqs = Array.from(row.querySelectorAll('.gvw-sq'));
        const rects = sqs.map((s) => s.getBoundingClientRect());
        return { n: sqs.length, w: rects[0].width, rows: new Set(rects.map((r) => Math.round(r.top))).size };
      }, by3['streak:running'].id);
      check('@360 wrap: 40 squares stay 14px across multiple rows', wrap.n === 40 && Math.round(wrap.w) === 14 && wrap.rows >= 2, JSON.stringify(wrap));
      const ovX = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check('@360 wrap: no horizontal overflow', ovX <= 1, String(ovX));
      check('@360 wrap: zero console errors', m.errors.length === 0, m.errors.join(' | '));
      await m.context.close();
    }

    // ── Mobile widths: horizontal layout, values match, no overflow ──
    for (const w of [360, 380, 414]) {
      const { context, page, errors } = await openStats(w);
      await page.waitForSelector('#gvw-card', { timeout: 15000 });
      const bars = await readBars(page);
      check(`@${w}: 4 pairs + streak heat row`, Object.keys(bars).length === 4 && Object.keys(await readHeat(page)).length === 1, String(Object.keys(bars).length));
      // Stacked panels on phones: weekly + custom present, monthly absent.
      const mPanels = await readPanels(page);
      check(`@${w}: stacked panels weekly+custom only`, mPanels.map((p) => p.period).join(',') === 'weekly,custom', JSON.stringify(mPanels));
      let allMatch = true;
      for (const g of nonStreak) {
        const p = bars[g.id];
        if (!p || p.goal.value !== Number(g.target) || p.actual.value !== Number(g.progress)) allMatch = false;
      }
      check(`@${w}: all values match API`, allMatch);
      // Horizontal layout: bars are wider than tall.
      const first = bars[active[0].id];
      check(`@${w}: horizontal bars`, first.goal.w > first.goal.h, JSON.stringify(first.goal));
      const mPos = await page.evaluate(() => {
        const body = document.getElementById('sp-stats-body');
        return body.lastElementChild === document.getElementById('gvw-card') && body.textContent.indexOf('Weekly activity') < body.textContent.indexOf('Goals vs actual');
      });
      check(`@${w}: card last, below Weekly activity`, mPos);
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
    const clean = makeCleanup();
    for (const id of [uid, uid2, uid3]) {
      if (!id) continue;
      await clean.cw('goals for ' + id, admin.from('goals').delete().eq('user_id', id));
      await clean.cw('activities for ' + id, admin.from('activities').delete().eq('user_id', id));
      await clean.cw('auth user ' + id, admin.auth.admin.deleteUser(id));
    }
    if (clean.failed()) failures += clean.count();
  }
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
