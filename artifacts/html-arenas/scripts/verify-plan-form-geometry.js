// Day-panel plan form geometry with the recurrence controls revealed:
// 360 / 380 / 414 (bottom sheet) and 1280 (desktop modal). Asserts no
// horizontal overflow inside the panel, all form fields within the panel box,
// and the live summary line visible + populated.
//   node artifacts/html-arenas/scripts/verify-plan-form-geometry.js

const { createClient } = require('@supabase/supabase-js');
const { launchBrowser } = require('./lib/mobile-geometry.js');

const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'ArenasTest!234';
const EMAIL = 'planform-geo@arenas-test.dev';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : '')); }
}

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (list && list.users) || []) if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id);
  const { data: created, error } = await admin.auth.admin.createUser({
    email: EMAIL, password: PW, email_confirm: true,
    user_metadata: { name: 'Planform Geo', handle: 'planform_geo' }
  });
  if (error) throw new Error(error.message);
  const uid = created.user.id;
  console.log('MANIFEST user:', uid);

  const lr = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PW)}`, redirect: 'manual'
  });
  const rawCookies = lr.headers.getSetCookie ? lr.headers.getSetCookie() : [lr.headers.get('set-cookie')];
  const cookies = rawCookies.map(c => {
    const [pair] = String(c).split(';');
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: 'localhost', path: '/' };
  });
  if (!cookies.length) throw new Error('login failed');

  const browser = await launchBrowser();
  try {
    for (const width of [360, 380, 414, 1280]) {
      const ctx = await browser.newContext({ viewport: { width, height: 860 }, ignoreHTTPSErrors: true });
      await ctx.addCookies(cookies);
      const page = await ctx.newPage();
      await page.goto(BASE_URL + '/calendar', { waitUntil: 'networkidle' });
      // Open today's day panel + create form, reveal the recurrence row.
      await page.evaluate(() => {
        const d = new Date();
        const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        window.openDayPanel(ymd);
      });
      await page.click('[data-cal-action="plan-new"]');
      await page.waitForSelector('#dpf-repeat');
      await page.selectOption('#dpf-repeat', 'weekly');
      await page.waitForSelector('#dpf-repeat-more', { state: 'visible' });
      await page.waitForSelector('#dpf-repeat-summary');
      const m = await page.evaluate(() => {
        const panel = document.querySelector('#day-panel .dp-card') || document.getElementById('day-panel');
        const pb = panel.getBoundingClientRect();
        const ids = ['dpf-date', 'dpf-repeat', 'dpf-until', 'dpf-sport', 'dpf-title', 'dpf-duration', 'dpf-notes'];
        const out = { panelW: pb.width, winW: window.innerWidth, docScrollW: document.documentElement.scrollWidth, overflows: [], summary: (document.getElementById('dpf-repeat-summary') || {}).textContent || '' };
        ids.forEach(id => {
          const el = document.getElementById(id);
          if (!el) { out.overflows.push(id + ':missing'); return; }
          const r = el.getBoundingClientRect();
          if (r.left < pb.left - 1 || r.right > pb.right + 1) out.overflows.push(id + ':' + Math.round(r.left) + '-' + Math.round(r.right) + ' vs ' + Math.round(pb.left) + '-' + Math.round(pb.right));
        });
        const sum = document.getElementById('dpf-repeat-summary').getBoundingClientRect();
        out.summaryVisible = sum.height > 0 && sum.right <= pb.right + 1;
        return out;
      });
      check(width + 'px: no page horizontal overflow', m.docScrollW <= width, m.docScrollW + ' > ' + width);
      check(width + 'px: all form fields inside the panel', m.overflows.length === 0, m.overflows.join('; '));
      check(width + 'px: live summary visible + populated', m.summaryVisible && /Creates \d+ sessions — every .+ through .+\./.test(m.summary), m.summary);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  await admin.auth.admin.deleteUser(uid);
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
