// PERMANENT GUARD: mobile geometry audit across all app-shell pages.
// Run: node scripts/verify-mobile-geometry.js        (seed → measure → cleanup)
//      --keep         skip cleanup (debugging)
//      --page <name>  audit only one page config
//
// Engine: scripts/lib/mobile-geometry.js. Asserts at 360/380/414px AND
// 1280/1440/1920px (desktop added with the shell-centering work):
//
// No known-failure exemptions — the guard must be fully green. (The former
// feed@desktop side-card clipping was fixed at the source: flex-shrink:0 on
// height-constrained rail children in arenas.css.)
//
// The full 6-width run exceeds a 5-minute shell window — run in halves:
//   GEO_WIDTHS=mobile | desktop | <comma list, e.g. 360,380>.
// To audit an exact comma-separated subset of named page specs:
//   GEO_PAGES=profile,weekly-recap-email-unsubscribe
//   - no element overflows its clipping container (overflow:hidden clip)
//   - no two text leaves' bounding boxes overlap
//   - every button inside the viewport AND hit-testable
//   - no page-level horizontal scroll; zero console/page errors
// SEED DENSITY IS THE POINT: empty surfaces cannot overflow, so every measured
// surface is seeded with content (long names/titles throughout) and the run
// reports RENDERED vs EMPTY per surface — an empty surface is UNMEASURED, not
// passing. Runs alongside verify-points-page.js / verify-km-consistency.js
// after any change to shell CSS, card renderers, or page templates.
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser, auditPage } from './lib/mobile-geometry.js';
import { mustWrite, makeCleanup } from './lib/checked-writes.js';

const require = createRequire(import.meta.url);
const { signRecapEmailToken } = require('../recap-email-token.js');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE = `https://${DOMAIN}/html`;
const PW = 'ArenasTest!234';

let failures = 0, assertions = 0;
const check = (name, ok, detail) => {
  assertions++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + JSON.stringify(detail).slice(0, 500)}`);
  if (!ok) failures++;
};

// ── users: 2 audited viewers + 8 fillers, all with LONG names ──
const LONGNAMES = [
  'Konstantina-Alexandra Papadimitriou-Vandenberg', 'Maximilian-Frederick Oyelaran-Whitcombe',
  'Anastasiya Yevgenievna Dobrovolskaya-Smith', 'Bartholomew Okonkwo-Fitzgerald III',
  'Wilhelmina Vasquez-Oppenheimer', 'Christopher-Sebastian Nakamura-Lindqvist',
  'Margarethe-Sophia Van Der Bergstromsson', 'Theodore Emmanuel Achterberg-Nkemelu'
];
const userDefs = { creator: 'Konstantina-Alexandra Papadimitriou-Vandenberg', member: 'Maximilian-Frederick Oyelaran-Whitcombe' };
for (let i = 0; i < 8; i++) userDefs['f' + i] = LONGNAMES[i % LONGNAMES.length] + ' ' + (i + 1);
const emails = Object.fromEntries(Object.keys(userDefs).map((k) => [k, `geo-${k}@arenas-test.dev`]));

const users = {};
let recapUnsubscribeToken = null;
async function mkUser(key) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key], password: PW, email_confirm: true,
    user_metadata: { name: userDefs[key], handle: 'geo_' + key, country: 'NO', state: 'Vestland',
      sports: ['running', 'cycling'],
      // Phase 2 geometry covers the dependent email control on an opted-in
      // Pro account. This guard never invokes the runner or email transport.
      prefs: key === 'creator' ? { weekly_recap: true, weekly_recap_email: true } : {} }
  });
  if (error) throw new Error(key + ': ' + error.message);
  users[key] = { id: data.user.id };
  createdUsers.push(data.user.id);
  saveManifest();
}
async function login(key) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(emails[key])}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const cookies = (setC || []).filter(Boolean).map((c) => {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: DOMAIN, path: '/' };
  });
  if (r.status !== 302 || !cookies.length) throw new Error('login failed: ' + key);
  users[key].cookies = cookies;
}
// Every created row is tracked the moment it exists, so cleanup (in the
// finally block below) removes everything even after a partial-seed crash.
// Persist the manifest after every create: a process killed between two
// awaits must still leave the next run enough information to clean itself up.
const MANIFEST = '/tmp/verify-mobile-geometry-manifest.json';
let priorManifest = {};
if (existsSync(MANIFEST)) {
  try {
    priorManifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch (e) {
    throw new Error(`fixture manifest is unreadable: ${e.message}`);
  }
}
const createdRows = Array.isArray(priorManifest.rows) ? priorManifest.rows : []; // { table, id } in creation order
const createdUsers = Array.isArray(priorManifest.users) ? priorManifest.users : []; // auth user ids
const saveManifest = () => writeFileSync(MANIFEST, JSON.stringify({
  rows: createdRows, users: createdUsers
}, null, 2) + '\n');
saveManifest();
async function ins(table, row) {
  const { data, error } = await admin.from(table).insert(row).select().maybeSingle();
  if (error) throw new Error(table + ': ' + error.message);
  if (data && data.id) createdRows.push({ table, id: data.id });
  else createdRows.push({ table, match: row });
  saveManifest();
  return data;
}
const day = 86400000;
const iso = (d) => new Date(Date.now() + d * day).toISOString();
const dt = (d) => iso(d).slice(0, 10);

// Browser-only AI Insights states. These never touch Supabase: the profile
// document's Pro flag and the three Insights fetches are intercepted in memory
// for the one geometry page below. Daily deliberately has exactly 84 bars;
// live contexts can legitimately stop earlier in the current week.
const chartDate = (start, offset) => {
  const date = new Date(start + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const dailyChartStub = {
  metric: 'sessions', unit: 'sessions', period: 'daily',
  title: 'Sessions per day — last 12 weeks', caption: '',
  labels: Array.from({ length: 84 }, (_, index) => chartDate('2026-01-01', index)),
  relative: [],
  series: [{ key: 'sessions', label: 'Sessions', color: '#FFD21E',
    values: Array.from({ length: 84 }, (_, index) => index % 9 === 0 ? 3 : index % 4 === 0 ? 1 : 0) }],
  totals: Array.from({ length: 84 }, (_, index) => index % 9 === 0 ? 3 : index % 4 === 0 ? 1 : 0)
};
const weeklyStackedChartStub = {
  metric: 'sessions', unit: 'sessions', period: 'weekly',
  title: 'Sessions per week — last 12 weeks', caption: '',
  labels: Array.from({ length: 12 }, (_, index) => chartDate('2026-06-22', index * 7)),
  relative: Array.from({ length: 12 }, (_, index) => `${11 - index}_weeks_ago`),
  series: [
    { key: 'running', label: 'Running', color: '#C2410C', values: [2, 0, 3, 1, 2, 4, 1, 2, 0, 3, 2, 1] },
    { key: 'cycling', label: 'Cycling', color: '#1E40AF', values: [1, 2, 0, 2, 1, 0, 3, 1, 2, 0, 1, 2] },
    { key: 'weightlifting', label: 'Weightlifting', color: '#713F12', values: [0, 1, 2, 0, 1, 1, 0, 2, 1, 1, 0, 1] },
    { key: 'pickleball', label: 'Pickleball', color: '#155E75', values: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] },
    { key: 'basketball', label: 'Basketball', color: '#A3412C', values: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1] },
    { key: 'hockey', label: 'Hockey', color: '#1E293B', values: [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0] }
  ]
};
weeklyStackedChartStub.totals = weeklyStackedChartStub.labels.map((_, index) =>
  weeklyStackedChartStub.series.reduce((sum, series) => sum + series.values[index], 0));
const insightResponseStub = (chart) => ({
  answer: 'Your recorded activity count was 42 in this detailed window.',
  chart,
  limitations: [],
  evidence: [{ path: chart.period === 'daily' ? 'last12Weeks.daily' : 'last12Weeks.weekly', value: null }],
  usage: { used: 1, remaining: 29, limit: 30, resetDate: '2026-10-01' }
});
// This is stored as a generated weekly_recap row for the creator during the
// regular geometry seed. Loading the real owner-scoped route verifies the
// page's server injection, shared renderer, navigation, and CSS together.
const storedRecapFixtureColumnProse =
  'You logged 4 sessions and 5.5 hours last week. Your recorded training data shows a steady week-over-week rhythm.';
const expectedStoredRecapDerivedProse =
  'Last week (Sep 7–13) you logged 4 sessions, 5.5 hours. Most of your sessions felt strong or tired.';
const storedRecapFixture = {
  weekStart: '2026-09-07',
  timezone: 'America/Los_Angeles',
  prose: storedRecapFixtureColumnProse,
  findings: {
    findings: [
      { type: 'metric', path: 'last12Weeks.weekly.10.activityCount', value: 4 },
      { type: 'metric', path: 'last12Weeks.weekly.10.durationHours', value: 5.5 },
      { type: 'chart', metric: 'feelings', period: 'weekly', evidence: 'last12Weeks.feelings' }
    ],
    limitations: ['Day-by-day and week-by-week detail is limited to the last 12 weeks.'],
    evidence: [
      { path: 'last12Weeks.weekly.10.activityCount', value: 4 },
      { path: 'last12Weeks.weekly.10.durationHours', value: 5.5 },
      { path: 'last12Weeks.feelings', value: null }
    ]
  },
  chart: {
    title: 'Feelings per week — last 12 weeks',
    metric: 'feelings',
    period: 'weekly',
    unit: 'count',
    caption: '',
    evidence: [{ path: 'last12Weeks.feelings', value: null }],
    labels: Array.from({ length: 12 }, (_, index) => chartDate('2026-06-22', index * 7)),
    relative: Array.from({ length: 12 }, (_, index) => `${11 - index}_weeks_ago`),
    series: [
      { key: 'strong', label: 'Strong', color: '#16A34A', values: [0, 1, 0, 1, 2, 0, 1, 0, 1, 1, 2, 1] },
      { key: 'tired', label: 'Tired', color: '#DC2626', values: [1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0] }
    ]
  }
};
if (storedRecapFixture.prose !== storedRecapFixtureColumnProse ||
    storedRecapFixture.prose === expectedStoredRecapDerivedProse) {
  throw new Error('weekly recap geometry fixture must preserve its legacy stored prose column');
}
storedRecapFixture.chart.totals = storedRecapFixture.chart.labels.map((_, index) =>
  storedRecapFixture.chart.series.reduce((sum, series) => sum + series.values[index], 0));
const setupInsightsStubs = async (page) => {
  await page.route(/\/html\/api\/profile\/ai-insights\/status(?:[?#]|$)/, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      used: 0, remaining: 30, limit: 30, resetDate: '2026-10-01'
    }) });
  });
  await page.route(/\/html\/api\/profile\/ai-insights\/hero-stats(?:[?#]|$)/, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      stats: [], suggestions: []
    }) });
  });
  await page.route(/\/html\/api\/profile\/ai-insights(?:[?#]|$)/, async (route) => {
    const post = route.request().postData() || '';
    const question = (() => { try { return JSON.parse(post).question || ''; } catch (_) { return ''; } })();
    const chart = /stacked/i.test(question) ? weeklyStackedChartStub : dailyChartStub;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(insightResponseStub(chart)) });
  });
};
// Insights is now a container-mounted module. Keep these selectors scoped to
// its tab and accept either the stable classes/data hooks or the generated
// per-mount ids (the module prefixes the legacy id names). The extracted
// module's data-ai-role hooks are the primary contract; suffix forms
// intentionally continue to match generated and legacy ids without making the
// guard depend on document-global ids.
const INSIGHTS_SCOPE_SELECTOR = '#tab-insights';
const INSIGHTS_FORM_SELECTOR = [
  'form.ai2-composer',
  'form.ai-insights-form',
  'form[data-ai-role="form"]',
  'form[data-ai-insights-form]',
  'form[id^="ai-insights-form"]',
  'form[id$="ai-insights-form"]',
  'form[id$="-form"]'
].join(', ');
const INSIGHTS_INPUT_SELECTOR = [
  'textarea.ai2-textarea',
  'textarea.ai-insights-question',
  'textarea[data-ai-role="question"]',
  'textarea[data-ai-insights-question]',
  'textarea[id^="ai-insights-question"]',
  'textarea[id$="ai-insights-question"]',
  'textarea[id$="-question"]'
].join(', ');
const INSIGHTS_THREAD_SELECTOR = [
  '[id^="ai-insights-thread"]',
  '[id$="ai-insights-thread"]',
  '[data-ai-role="thread"]',
  '[data-ai-insights-thread]',
  '.ai-insights-thread',
  '.ai2-thread',
  '[aria-live="polite"]',
  '[id$="-thread"]'
].join(', ');
const INSIGHTS_BODY_SELECTOR = [
  '[id^="ai-insights-body"]',
  '[id$="ai-insights-body"]',
  '[data-ai-role="body"]',
  '[data-ai-insights-body]',
  '.ai-insights-body',
  '.ai2-body',
  '[id$="-body"]'
].join(', ');
const scopedInsightsSelector = (selector) =>
  selector.split(', ').map((part) => `${INSIGHTS_SCOPE_SELECTOR} ${part}`).join(', ');
const INSIGHTS_BODY_SCOPED_SELECTOR = scopedInsightsSelector(INSIGHTS_BODY_SELECTOR);
const INSIGHTS_THREAD_SVG_SELECTOR = INSIGHTS_THREAD_SELECTOR.split(', ')
  .map((part) => `${INSIGHTS_SCOPE_SELECTOR} ${part} svg[aria-label*="Sessions per day"]`).join(', ');
const insightsChartGeometryCheck = (titlePart, legendLabels) => ({
  name: titlePart + ' chart fits its answer card and preserves its legend',
  js: `(() => {
    const panel = document.querySelector(${JSON.stringify(INSIGHTS_SCOPE_SELECTOR)});
    const thread = panel && panel.querySelector(${JSON.stringify(INSIGHTS_THREAD_SELECTOR)});
    const svg = [...(thread ? thread.querySelectorAll('svg[role="img"]') : [])]
      .find((node) => (node.getAttribute('aria-label') || '').includes(${JSON.stringify(titlePart)}));
    if (!svg) return { ok: false, missing: 'chart svg' };
    let box = svg.parentElement;
    while (box && !${JSON.stringify(legendLabels)}.every((label) => box.textContent.includes(label))) box = box.parentElement;
    if (!box) return { ok: false, missing: 'chart wrapper/legend' };
    const sr = svg.getBoundingClientRect(), br = box.getBoundingClientRect();
    const legend = ${JSON.stringify(legendLabels)}.map((label) => {
      const leaf = [...box.querySelectorAll('*')].find((node) => node.children.length === 0 && node.textContent.trim() === label);
      return leaf ? { label, rect: leaf.getBoundingClientRect().toJSON() } : { label, missing: true };
    });
    const mobile = innerWidth <= 768;
    const rows = new Set(legend.filter((entry) => !entry.missing).map((entry) => Math.round(entry.rect.top))).size;
    return {
      ok: sr.width <= br.width + 1 && sr.left >= br.left - 1 && sr.right <= br.right + 1 &&
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        legend.every((entry) => !entry.missing) && (!mobile || !legend.length || rows >= 2),
      svg: { width: sr.width, left: sr.left, right: sr.right },
      container: { width: br.width, left: br.left, right: br.right },
      overflow: document.documentElement.scrollWidth - innerWidth, mobile, legend, legendRows: rows
    };
  })()`
});
const insightsHeroTextVisibilityCheck = {
  name: 'full-bleed Insights hero keeps all meaningful text inside MAIN',
  js: `(() => {
    const main = document.querySelector('.main');
    const panel = document.querySelector(${JSON.stringify(INSIGHTS_SCOPE_SELECTOR)});
    const nodes = panel ? [...panel.querySelectorAll('.ai2-hero-title, .ai2-hero-body')] : [];
    if (!main || nodes.length !== 2) return { ok: false, main: !!main, textNodes: nodes.length };
    const mainRect = main.getBoundingClientRect();
    const text = nodes.map((node) => ({ tag: node.tagName, text: node.textContent.trim().slice(0, 60), rect: node.getBoundingClientRect().toJSON() }));
    return {
      ok: text.every((entry) => entry.rect.left >= mainRect.left - 1 && entry.rect.right <= mainRect.right + 1 &&
        entry.rect.width > 0 && entry.rect.height > 0),
      main: mainRect.toJSON(), text
    };
  })()`
};
const recapCardGeometryCheck = {
  name: 'stored recap renders deterministic copy, limitation, evidence, and a fitting chart',
  js: `(() => {
    const card = document.querySelector('.recap-answer-card');
    const prose = card && card.querySelector('.recap-prose');
    const limitation = card && card.querySelector('.recap-limitations li');
    const evidence = card ? [...card.querySelectorAll('.recap-evidence-badge')] : [];
    const svg = card && card.querySelector('.recap-chart svg[role="img"]');
    if (!card || !prose || !limitation || !svg) {
      return { ok: false, card: !!card, prose: !!prose, limitation: !!limitation, chart: !!svg, evidence: evidence.length };
    }
    const cr = card.getBoundingClientRect(), sr = svg.getBoundingClientRect();
    return {
      ok: prose.textContent.trim() === ${JSON.stringify(expectedStoredRecapDerivedProse)} &&
        limitation.textContent.includes(${JSON.stringify(storedRecapFixture.findings.limitations[0])}) &&
        evidence.length === ${storedRecapFixture.findings.evidence.length} &&
        sr.width > 0 && sr.left >= cr.left - 1 && sr.right <= cr.right + 1 &&
        document.documentElement.scrollWidth <= innerWidth + 1,
      prose: prose.textContent, limitation: limitation.textContent, evidence: evidence.map((item) => item.textContent),
      card: cr.toJSON(), chart: sr.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth
    };
  })()`
};
const recapEmailSettingsCheck = {
  name: 'Weekly recap email control is visible while weekly recap is enabled',
  js: `(() => {
    const control = document.querySelector('[data-pref="weekly_recap_email"], input[name="weekly_recap_email"], #weekly-recap-email');
    const copy = document.querySelector('#tab-settings')?.textContent || '';
    const rect = control && control.getBoundingClientRect();
    const style = control && getComputedStyle(control);
    return {
      ok: !!control && control.checked === true && !!rect && rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        copy.includes('Also email me the recap every Monday') &&
        copy.includes('Emails come from noreply@send.realarenas.com'),
      control: control && { tag: control.tagName, checked: control.checked, rect: rect && rect.toJSON(), display: style && style.display },
      copyPresent: copy.includes('Also email me the recap every Monday'),
      senderCopyPresent: copy.includes('Emails come from noreply@send.realarenas.com')
    };
  })()`
};
const recapEmailUnsubscribeCheck = {
  name: 'public weekly recap email unsubscribe page confirms the change',
  js: `(() => {
    const card = document.querySelector('.card');
    const link = card && [...card.querySelectorAll('a')].find((item) => item.textContent.trim() === 'Settings');
    return {
      ok: !!card && card.textContent.includes("You'll no longer receive weekly recap emails") && !!link,
      card: !!card, text: card && card.textContent.trim(), settingsLink: link && link.getAttribute('href')
    };
  })()`
};
const AI_SHEET_ROOT = '.ai-sheet-backdrop > .ai-sheet';
const AI_SHEET_THREAD = `${AI_SHEET_ROOT} [data-ai-role="thread"]`;
const AI_SHEET_DAILY_CHART = `${AI_SHEET_THREAD} svg[aria-label*="Sessions per day"]`;
const sheetBackdropCheck = {
  name: 'AI sheet backdrop covers the viewport and blocks outside-sheet hit tests',
  js: `(() => {
    const backdrop = document.querySelector('.ai-sheet-backdrop');
    const sheet = document.querySelector(${JSON.stringify(AI_SHEET_ROOT)});
    if (!backdrop || !sheet) return { ok: false, missing: !backdrop ? 'backdrop' : 'sheet' };
    const br = backdrop.getBoundingClientRect();
    const sr = sheet.getBoundingClientRect();
    const coversViewport = br.left <= 1 && br.top <= 1
      && br.right >= innerWidth - 1 && br.bottom >= innerHeight - 1;
    const candidates = [[1, 1], [innerWidth - 2, 1], [1, innerHeight - 2], [innerWidth - 2, innerHeight - 2]];
    const point = candidates.find(([x, y]) => !(x >= sr.left && x <= sr.right && y >= sr.top && y <= sr.bottom));
    const hit = point ? document.elementFromPoint(point[0], point[1]) : null;
    return {
      ok: coversViewport && !!point && hit === backdrop,
      backdrop: br.toJSON(), sheet: sr.toJSON(), point, hit: hit && (hit.id || hit.className || hit.tagName)
    };
  })()`
};
const sheetBehaviorCheck = {
  name: 'AI sheet has a real backdrop, locked body, composer, and cyclic Tab focus',
  js: `(() => {
    const backdrop = document.querySelector('.ai-sheet-backdrop');
    const sheet = document.querySelector(${JSON.stringify(AI_SHEET_ROOT)});
    const input = sheet && sheet.querySelector('[data-ai-role="question"]');
    const close = sheet && sheet.querySelector('.ai-sheet-close');
    const body = sheet && sheet.querySelector('.ai-sheet-body');
    const chart = sheet && sheet.querySelector(${JSON.stringify(AI_SHEET_DAILY_CHART)});
    const focusables = sheet ? [...sheet.querySelectorAll('button, input, textarea, select, [href], [tabindex]')]
      .filter((el) => !el.disabled && el.getClientRects().length && el.getAttribute('tabindex') !== '-1') : [];
    let shiftWrap = false, forwardWrap = false;
    if (focusables.length > 1) {
      focusables[0].focus();
      focusables[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      shiftWrap = document.activeElement === focusables[focusables.length - 1];
      focusables[focusables.length - 1].focus();
      focusables[focusables.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      forwardWrap = document.activeElement === focusables[0];
    }
    const bodyLocked = document.body.style.overflow === 'hidden';
    const bodyRect = body && body.getBoundingClientRect();
    const chartRect = chart && chart.getBoundingClientRect();
    const chartFitsBody = !!body && !!chart && !!bodyRect && !!chartRect
      && body.scrollWidth <= body.clientWidth + 1
      && chartRect.left >= bodyRect.left - 1 && chartRect.right <= bodyRect.right + 1;
    return {
      ok: !!backdrop && !!sheet && backdrop.classList.contains('ai-sheet-backdrop')
        && backdrop.contains(sheet) && sheet.getAttribute('aria-modal') === 'true'
        && !!input && !!close && bodyLocked && focusables.length >= 2 && shiftWrap && forwardWrap
        && chartFitsBody,
      backdrop: !!backdrop, sheet: !!sheet, composer: !!input, close: !!close,
      bodyOverflow: document.body.style.overflow, focusables: focusables.length, shiftWrap, forwardWrap,
      chartFitsBody, bodyScrollWidth: body && body.scrollWidth, bodyClientWidth: body && body.clientWidth
    };
  })()`
};
const sheetCloseFocusCheck = {
  name: 'closing the AI sheet restores trigger focus and body scrolling',
  js: `(() => {
    const trigger = document.querySelector('.bn-fab-ai');
    const backdrop = document.querySelector('.ai-sheet-backdrop');
    return {
      ok: !document.querySelector('.ai-sheet-backdrop')
        && document.body.style.overflow !== 'hidden'
        && !!trigger && document.activeElement === trigger,
      hadBackdrop: !!backdrop, bodyOverflowAfter: document.body.style.overflow,
      focused: document.activeElement && document.activeElement.className
    };
  })()`
};
const sheetRetainsThreadCheck = {
  name: 'reopening the AI sheet retains its answered chart thread',
  js: `(() => {
    const sheet = document.querySelector(${JSON.stringify(AI_SHEET_ROOT)});
    const thread = sheet && sheet.querySelector('[data-ai-role="thread"]');
    const text = thread ? thread.textContent : '';
    const chart = thread && thread.querySelector('svg[aria-label*="Sessions per day"]');
    return { ok: !!sheet && !!thread && !!chart && text.includes('recorded activity count was 42'), text: text.slice(0, 180), chart: !!chart };
  })()`
};
const composerVisualViewportCheck = {
  name: 'focused composer stays inside the reduced visual viewport',
  js: `(() => {
    const sheet = document.querySelector(${JSON.stringify(AI_SHEET_ROOT)});
    const input = sheet && sheet.querySelector('[data-ai-role="question"]');
    const form = sheet && sheet.querySelector('[data-ai-role="form"]');
    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0;
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const target = form || input;
    if (!target) return { ok: false, missing: 'composer' };
    const r = target.getBoundingClientRect();
    return {
      ok: !!vv && document.activeElement === input && r.bottom <= bottom + 2 && r.top >= top - 2,
      active: document.activeElement === input, rect: r.toJSON(),
      visualViewport: vv ? { top, bottom, height: vv.height } : null
    };
  })()`
};
const feedDesktopSheetCheck = {
  name: 'desktop feed does not create the mobile AI sheet',
  desktopOnly: true,
  js: `(() => ({ ok: !document.querySelector('.ai-sheet-backdrop'), backdrops: document.querySelectorAll('.ai-sheet-backdrop').length }))()`
};
const freeProfileNoAiCheck = {
  name: 'free filler profile has no AI entitlement or AI FAB',
  js: `(() => {
    const data = window.ARENAS_DATA || {};
    return {
      ok: data.gating?.aiInsightsPro !== true && !document.querySelector('.bn-fab-ai')
        && !document.querySelector('.ai-sheet-backdrop'),
      aiInsightsPro: data.gating?.aiInsightsPro, fab: !!document.querySelector('.bn-fab-ai'),
      sheet: !!document.querySelector('.ai-sheet-backdrop')
    };
  })()`
};
const pwaCardClearanceCheck = {
  name: 'real beforeinstallprompt PWA card clears both FABs',
  js: `(() => {
    const card = document.querySelector('#arenas-install-card');
    const cardRect = card && card.getBoundingClientRect();
    const fabs = [...document.querySelectorAll('.bn-fab, .bn-fab-ai')].filter((el) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    });
    const intersects = (a, b) => a && b && Math.min(a.right, b.right) > Math.max(a.left, b.left)
      && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
    return {
      ok: !!card && !!cardRect && cardRect.left >= -1 && cardRect.right <= innerWidth + 1
        && cardRect.top >= -1 && cardRect.bottom <= innerHeight + 1
        && fabs.every((fab) => !intersects(cardRect, fab.getBoundingClientRect())),
      card: cardRect ? cardRect.toJSON() : null,
      fabs: fabs.map((fab) => fab.getBoundingClientRect().toJSON())
    };
  })()`
};

// ── seed (dense) ──
let browser = null;
try {
for (const k of Object.keys(userDefs)) await mkUser(k);
await login('creator'); await login('member'); await login('f6');
const C = users.creator.id, M = users.member.id;
recapUnsubscribeToken = signRecapEmailToken(C, '2026-01-05T00:00:00.000Z', process.env.SESSION_SECRET);
const F = [...Array(8)].map((_, i) => users['f' + i].id);
console.log('MANIFEST users:', JSON.stringify(Object.fromEntries(Object.entries(users).map(([k, v]) => [k, v.id]))));

// The geometry guard must exercise the same server-resolved entitlement that
// real users receive. Track each paid row immediately so cleanup removes it
// before deleting its owning auth user, even after a partial-seed failure.
const makeProSubscription = (ownerId, label) => {
  const suffix = Date.now().toString(36) + '_' + label;
  const stripeSubscriptionId = 'sub_geo_' + suffix;
  return {
    owner_type: 'user', owner_id: ownerId, plan: 'pro', status: 'active',
    stripe_customer_id: 'cus_geo_' + suffix,
    stripe_subscription_id: stripeSubscriptionId,
    ever_paid: true, last_paid_subscription_id: stripeSubscriptionId,
    cancel_at_period_end: false
  };
};
const proSubscription = await ins('subscriptions', makeProSubscription(C, 'creator'));
const memberProSubscription = await ins('subscriptions', makeProSubscription(M, 'member'));
console.log('MANIFEST Pro subscriptions:', proSubscription?.id, memberProSubscription?.id);
await ins('weekly_recaps', {
  user_id: C,
  week_start: storedRecapFixture.weekStart,
  timezone: storedRecapFixture.timezone,
  window_start_utc: '2026-09-07T07:00:00.000Z',
  window_end_utc: '2026-09-14T07:00:00.000Z',
  status: 'generated',
  attempts: 1,
  findings: storedRecapFixture.findings,
  prose: storedRecapFixture.prose,
  chart: storedRecapFixture.chart,
  context_schema_version: 8,
  contract_version: 1,
  generated_at: new Date().toISOString()
});

const LONG = 'Late Autumn Ultra-Distance Trail Running Consistency and Elevation Gain Challenge';
const club = await ins('clubs', {
  name: 'Trans-Scandinavian Endurance and Alpine Expedition Society',
  handle: 'geoclub', sport: 'running', city: 'Ytre Snillfjordsbotn', owner_id: C,
  // Listed in the /clubs directory so the clubs page renders a worst-case
  // long-name + long-description card for the geometry pass.
  visibility: 'public',
  description: 'A club for extraordinarily committed long-distance mountain athletes crossing the Scandinavian ranges in all four seasons, with weekly structured sessions and an annual expedition.'
});
await ins('memberships', { user_id: C, club_id: club.id, role: 'admin' });
await ins('memberships', { user_id: M, club_id: club.id, role: 'member' });
for (const f of F.slice(0, 6)) await ins('memberships', { user_id: f, club_id: club.id, role: 'member' });

// follows: everyone follows creator; creator/member follow each other + fillers
for (const f of [...F, M]) await ins('follows', { follower_id: f, following_id: C });
for (const f of [M, ...F.slice(0, 5)]) await ins('follows', { follower_id: C, following_id: f });
await ins('follows', { follower_id: M, following_id: users.f0.id });

// challenges (long + short titles; populated participant lists)
const mkCh = async (by, title, vis, parts) => {
  const ch = await ins('challenges', { created_by: by, title, visibility: vis, sport: 'running',
    goal_type: 'distance', goal_target: 120, goal_unit: 'km', start_date: iso(-6), end_date: iso(18) });
  for (const p of parts) await ins('challenge_participants', { challenge_id: ch.id, user_id: p });
  return ch;
};
const chPriv = await mkCh(C, LONG, 'private', [C]);
await ins('challenge_invites', { challenge_id: chPriv.id, inviter_id: C, invitee_id: M });
const chShort = await mkCh(C, '5K Blitz', 'public', [C, M, ...F.slice(0, 3)]);
const chLong = await mkCh(C, LONG + ' II', 'public', [C, ...F.slice(0, 4)]);
const chByM = await mkCh(M, 'Dawn Patrol Weekly Sunrise Kilometre Accumulation Series', 'public', [M, users.f3.id]);
// A genuinely ended challenge keeps the Completed tab rendered with real API
// data. It is not discoverable and does not appear in the active friends view.
const chCompleted = await ins('challenges', {
  created_by: C,
  title: 'Completed Fjord-to-Fjord Distance Progress Challenge',
  visibility: 'public',
  sport: 'running',
  goal_type: 'distance',
  goal_target: 120,
  goal_unit: 'km',
  start_date: iso(-30),
  end_date: iso(-2)
});
await ins('challenge_participants', { challenge_id: chCompleted.id, user_id: C });
const CHALLENGES = [chPriv.id, chShort.id, chLong.id, chByM.id, chCompleted.id];

// activities: dense, multi-sport, long titles, spread over the month → feeds
// PRs, stats-4, calendar, leaderboards, club rollups, points, streaks.
const ACT_TITLE = 'Threshold intervals along the upper fjord switchbacks — long evening session with negative splits';
const sports = ['running', 'cycling', 'climbing', 'swimming', 'football', 'hiking', 'weightlifting',
  'yoga', 'golf', 'pickleball', 'basketball', 'hockey', 'tennis', 'pilates'];
const seededActivityUsers = [C, M, ...F.slice(0, 6)];
for (const [ui, u] of seededActivityUsers.entries()) {
  const activityCount = u === C ? sports.length : 6;
  for (let i = 0; i < activityCount; i++) {
    await ins('activities', {
      user_id: u, sport: sports[(ui + i) % sports.length],
      title: i % 2 ? ACT_TITLE : 'Short spin',
      date: dt(-(i * 4 + (ui % 3))), duration: '01:0' + (i % 6) + ':00',
      distance: (8 + i * 3.5) + ' km', notes: i % 3 ? ACT_TITLE : null
    });
  }
}
// Reverse equal-height case: one sport plus activity on every elapsed day in
// the four-week window makes the grid the naturally taller card. The public
// profile geometry pass proves By sport stretches up to it on desktop.
for (let i = 0; i < 28; i++) {
  await ins('activities', {
    user_id: F[7], sport: 'running', title: 'Full-grid running day ' + (i + 1),
    date: dt(-i), duration: '00:30:00', distance: '5 km'
  });
}
// earned achievements for creator → .achievement-grid renders earned rows
for (const b of ['first_steps', 'early_bird', 'regular', 'joined_club', 'challenger', 'hat_trick']) {
  await ins('achievements', { user_id: C, badge_id: b });
}
// goal for creator (Goals tab + overview mini-card)
await ins('goals', { user_id: C, type: 'distance', sport: 'running', target_value: 80, unit: 'km', period: 'weekly', status: 'active' });

// posts w/ kudos + comments (the flex action rows), long content
const POSTS = [];
for (const [u, txt] of [[C, ACT_TITLE + ' — felt strong through every rep, weather held up beautifully.'], [M, 'Completed the ' + LONG + ' opening block this morning!'], [users.f0.id, 'Short one.']]) {
  const p = await ins('posts', { user_id: u, content: txt, sport: 'running' });
  POSTS.push(p.id);
  for (const liker of [M, ...F.slice(0, 4)].filter((x) => x !== u)) await ins('post_likes', { post_id: p.id, user_id: liker });
  await ins('post_comments', { post_id: p.id, user_id: users.f1.id, content: 'Incredible consistency — that elevation profile looked absolutely brutal from the segment view!' });
  await ins('post_comments', { post_id: p.id, user_id: users.f2.id, content: 'Nice.' });
}
// events with RSVPs (long titles + location)
const EVENTS = [];
const OVERFLOW_EVENT_TITLE = 'GeometryGuardTitleTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT';
const OVERFLOW_EVENT_LOCATION = 'GeometryGuardLocationLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL';
const OVERFLOW_DESCRIPTION_TOKEN = 'GeometryGuardDescriptionTokenDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
const OVERFLOW_EVENT_DESCRIPTION = 'Permanent event overflow geometry fixture containing ' + OVERFLOW_DESCRIPTION_TOKEN;
if (OVERFLOW_EVENT_TITLE.length !== 80 || OVERFLOW_EVENT_LOCATION.length !== 120 || OVERFLOW_DESCRIPTION_TOKEN.length !== 60) {
  throw new Error('event overflow fixture lengths changed');
}
for (const [i, t] of ['Midnight-Sun Coastal Half-Marathon Preparation Long Run and Post-Run Waffle Social', 'Track Tuesday'].entries()) {
  const ev = await ins('events', { created_by: C, club_id: club.id, title: t, sport: 'running',
    event_type: 'training', date: iso(3 + i * 4), location: 'Ytre Snillfjordsbotn Community Athletics Track, North Entrance', visibility: 'club' });
  EVENTS.push(ev.id);
  for (const u of [M, ...F.slice(0, 4)]) await ins('event_rsvps', { event_id: ev.id, user_id: u, status: 'going' });
}
const evOverflow = await ins('events', {
  created_by: C, title: OVERFLOW_EVENT_TITLE, sport: 'running', event_type: 'training',
  date: iso(5), location: OVERFLOW_EVENT_LOCATION, description: OVERFLOW_EVENT_DESCRIPTION,
  visibility: 'public'
});
EVENTS.push(evOverflow.id);
await ins('event_rsvps', { event_id: evOverflow.id, user_id: M, status: 'going' });
// private invite-only event by creator → owner card shows the Invites button;
// invitees (M pending, f0 going) populate the manage overlay's list AND leave
// eligible followees (f1..f4) so the invite-more picker renders too.
const evPriv = await ins('events', { created_by: C, title: 'Invitational Fjordline Night Relay — Headlamp Pacing Practice and Team Selection Trial', sport: 'running',
  event_type: 'training', date: iso(6), location: 'Ytre Snillfjordsbotn Community Athletics Track, North Entrance', visibility: 'private' });
EVENTS.push(evPriv.id);
for (const u of [M, users.f0.id]) await ins('event_invites', { event_id: evPriv.id, invitee_id: u, inviter_id: C });
await ins('event_rsvps', { event_id: evPriv.id, user_id: users.f0.id, status: 'going' });
// Cover images on every seeded event so image-bearing variants of each
// surface are MEASURED (events-page banners incl. the mobile top band,
// calendar day-panel 44px thumbs, member-home 48px thumbs, feed RSVP 56px
// thumbs). Real objects in the private bucket — a broken <img> occupies no
// height and would silently un-measure the banner.
const sharp = (await import('sharp')).default;
const coverWebp = await sharp({ create: { width: 1200, height: 400, channels: 3, background: { r: 30, g: 90, b: 160 } } })
  .webp({ quality: 82 }).toBuffer();
for (const evId of EVENTS) {
  const objectPath = 'events/' + evId + '/' + Date.now() + '.webp';
  const { error: imgErr } = await admin.storage.from('event-images')
    .upload(objectPath, coverWebp, { contentType: 'image/webp', upsert: false });
  if (imgErr) throw new Error('event image seed: ' + imgErr.message);
  await mustWrite('event image pointer for event ' + evId, admin.from('events').update({ image_path: objectPath }).eq('id', evId));
}
// notifications for creator
for (const [a, ty, ti] of [[M, 'like', 'New kudos'], [users.f0.id, 'follow', 'New follower'], [users.f1.id, 'comment', 'New comment']]) {
  await ins('notifications', { user_id: C, actor_id: a, type: ty, title: ti, body: 'Geo seed notification body text' });
}
console.log('MANIFEST club:', club.id, 'challenges:', JSON.stringify(CHALLENGES), 'events:', JSON.stringify(EVENTS));

// ── page configs ──
// MODAL STATES ARE PART OF THIS GUARD: pages at rest never render their
// modals, so every modal is an unmeasured surface unless it has a step here.
// Convention for a modal step: { name, js: <open it>, waitFor: <overlay
// visible>, root: <the overlay id> } — root scopes the geometry audit to the
// modal (the engine deliberately keeps measuring inside the fixed overlay
// when it IS the root). New modals get a step entry, never a new script.
// NOTE the closers: static .modal-overlay modals close via closeModals();
// arenasOverlay-built overlays close via arenasOverlay.close(id).
const htab = (id) => `document.getElementById('htab-${id}').click()`;
const closeModals = `document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.remove('open'));`;
const closeOverlays = `['create-challenge-overlay','challenge-leaderboard-overlay','invite-manager-overlay','challenge-delete-overlay'].forEach((i) => window.arenasOverlay && arenasOverlay.close(i));`;
const athleteNav = (activeLabel = null, log = true, ai = log) => ({
  itemCount: 6, activeCount: activeLabel ? 1 : 0, activeLabel, log, ai
});
const dashboardNav = { itemCount: 5, activeCount: 1, activeLabel: 'Overview', log: false, ai: false };
const memberNav = { itemCount: 5, activeCount: 1, activeLabel: 'Overview', log: false, ai: false };
const memberLeaderboardNav = { itemCount: 4, activeCount: 1, activeLabel: 'Ranks', log: true, ai: false };
// Contract with the Challenges redesign: the band has one stable hook so its
// presence can be checked without coupling the guard to illustration markup.
// Accept the data hook as well so a class-name-only styling refactor cannot
// silently remove coverage.
const WHY_JOIN_SELECTOR = '.ch-why-join, [data-challenge-why-join]';
const whyJoinState = (name, expectedBands, expectedCards) => ({
  name,
  js: `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none'
        && s.visibility !== 'hidden' && s.opacity !== '0';
    };
    const bands = [...document.querySelectorAll(${JSON.stringify(WHY_JOIN_SELECTOR)})];
    const visibleBands = bands.filter(visible);
    const cards = [...document.querySelectorAll('#tab-mine .challenge-card')];
    const labels = ['Stay motivated', 'Compete with friends', 'Earn points', 'Build healthy habits'];
    const bandText = visibleBands.map((el) => el.textContent.replace(/\\s+/g, ' ').trim()).join(' ');
    const labelsPresent = labels.filter((label) => bandText.includes(label));
    const normalize = (value) => value.replace(/\\s+/g, ' ').trim();
    const headingMatches = visibleBands.flatMap((band) => [band, ...band.querySelectorAll('*')])
      .filter((el) => normalize(el.textContent || '') === 'Why join a challenge?');
    const headingPresent = headingMatches.length > 0;
    return {
      ok: bands.length === ${expectedBands} && visibleBands.length === ${expectedBands}
        && cards.length ${expectedCards === 0 ? '=== 0' : '> 0'}
        && (${expectedBands === 0 ? 'true' : 'headingPresent && labelsPresent.length === labels.length'}),
      bands: bands.length, visibleBands: visibleBands.length, cards: cards.length,
      headingPresent, headingCount: headingMatches.length, labelsPresent,
      expectedBands: ${expectedBands}, expectedCards: ${expectedCards}
    };
  })()`
});
const heroFullBleedState = (selector = '.ch-hero') => ({
  name: 'hero reaches both .main edges and fills the desktop content column',
  js: `(() => {
    const hero = document.querySelector(${JSON.stringify(selector)});
    const main = document.querySelector('.main');
    if (!hero || !main) return { ok: false, missing: !hero ? ${JSON.stringify(selector)} : '.main' };
    const h = hero.getBoundingClientRect();
    const m = main.getBoundingClientRect();
    const T = 1;
    // Full bleed cancels main's padding. Comparing only hero to main misses
    // a shrink-to-fit main: independently anchor desktop to the shell track.
    const app = main.parentElement;
    const tracks = getComputedStyle(app).gridTemplateColumns.split(' ').map(parseFloat);
    const desktop = window.innerWidth >= 1024;
    const columnLeft = desktop ? app.getBoundingClientRect().left + tracks[0] + tracks[1] : m.left;
    const columnRight = desktop ? columnLeft + tracks[2] : m.right;
    const fillsColumn = Math.abs(m.left - columnLeft) <= T && Math.abs(m.right - columnRight) <= T;
    return {
      ok: Math.abs(h.left - m.left) <= T && Math.abs(h.right - m.right) <= T && fillsColumn,
      hero: { left: h.left, right: h.right, width: h.width },
      main: { left: m.left, right: m.right, width: m.width },
      leftDelta: h.left - m.left, rightDelta: h.right - m.right,
      columnLeft, columnRight, fillsColumn
    };
  })()`
});
const PAGES = [
  { user: 'creator', name: 'weekly-recap', path: '/recaps', waitFor: '.recap-answer-card', root: 'body',
    surfaces: [
      { name: 'stored recap answer card', sel: '#weekly-recap-answer', min: 1 },
      // The shared renderer's .recap-evidence container includes its
      // "Verified data" label plus one .recap-evidence-badge per evidence row.
      { name: 'stored recap evidence', sel: '.recap-evidence',
        min: storedRecapFixture.findings.evidence.length + 1,
        max: storedRecapFixture.findings.evidence.length + 1 }
    ],
    checks: [recapCardGeometryCheck] },
  { user: 'creator', name: 'feed', path: '/feed', waitFor: '.feed-item-wrap', root: 'body', bottomNav: athleteNav('Feed'),
    setup: setupInsightsStubs,
    screenshot: { path: '/tmp/ask-ai-feed-both-fab-{width}.png', widths: [360, 414] },
    checks: [feedDesktopSheetCheck],
    // The feed hero's responsive picture intentionally paints beyond its
    // visual wrapper; preserve that existing baseline exception for every
    // newly-added feed state without exempting any sheet content.
    ignoreClipping: ['.feed-banner-visual picture', '.feed-banner-visual img'],
    surfaces: [
      { name: 'feed items', sel: '.feed-items', min: 3 },
      // The feed rail stacks beneath the feed on phones. Your week, streak,
      // and quick actions are always present; Suggested athletes is optional
      // when there are no eligible users.
      { name: 'right rail (side-col)', sel: '.side-col', min: 3, max: 4, mobileOnly: true }
    ],
    steps: [
      { name: 'ai-sheet-answer-chart',
        js: `(async () => {
          const fab = document.querySelector('.bn-fab-ai');
          if (!fab) throw new Error('AI FAB did not render for the Pro creator');
          fab.focus(); fab.click();
          for (let i = 0; i < 80 && !document.querySelector(${JSON.stringify(AI_SHEET_ROOT + ' [data-ai-role="question"]')}); i++) {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          const sheet = document.querySelector(${JSON.stringify(AI_SHEET_ROOT)});
          const input = sheet && sheet.querySelector('[data-ai-role="question"]');
          const form = sheet && sheet.querySelector('[data-ai-role="form"]');
          if (!input || !form) throw new Error('AI sheet composer did not render');
          input.value = 'Show my training day by day';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        })()`,
        waitFor: AI_SHEET_DAILY_CHART,
        root: AI_SHEET_ROOT,
        screenshot: {
          path: '/tmp/ask-ai-sheet-answer-chart-{width}.png',
          widths: [360, 414], scrollSelector: AI_SHEET_DAILY_CHART
        },
        checks: [sheetBehaviorCheck, sheetBackdropCheck], mobileOnly: true },
      { name: 'ai-sheet-close-focus',
        js: `document.querySelector(${JSON.stringify(AI_SHEET_ROOT + ' .ai-sheet-close')}).click()`,
        checks: [sheetCloseFocusCheck], mobileOnly: true },
      { name: 'ai-sheet-reopen-retain-thread',
        js: `(async () => {
          const fab = document.querySelector('.bn-fab-ai');
          if (!fab) throw new Error('AI FAB disappeared after sheet close');
          fab.click();
          for (let i = 0; i < 80 && !document.querySelector(${JSON.stringify(AI_SHEET_ROOT + ' [data-ai-role="thread"]')}); i++) {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        })()`,
        waitFor: AI_SHEET_ROOT,
        root: AI_SHEET_ROOT,
        checks: [sheetRetainsThreadCheck], mobileOnly: true },
      { name: 'ai-sheet-keyboard',
        viewport: { height: 420 },
        js: `(() => {
          const input = document.querySelector(${JSON.stringify(AI_SHEET_ROOT + ' [data-ai-role="question"]')});
          if (!input) throw new Error('AI sheet composer missing at reduced viewport');
          input.focus();
          window.dispatchEvent(new Event('resize'));
        })()`,
        root: AI_SHEET_ROOT,
        checks: [composerVisualViewportCheck, sheetBackdropCheck],
        screenshot: { path: '/tmp/ask-ai-keyboard-420-{width}.png', widths: [360, 414] }, mobileOnly: true },
      { name: 'ai-sheet-close-before-pwa',
        js: `(() => {
          const close = document.querySelector(${JSON.stringify(AI_SHEET_ROOT + ' .ai-sheet-close')});
          if (close) close.click();
        })()`, mobileOnly: true },
      { name: 'pwa-beforeinstallprompt',
        js: `(() => {
          const event = new Event('beforeinstallprompt', { bubbles: false, cancelable: true });
          event.prompt = () => Promise.resolve();
          event.userChoice = Promise.resolve({ outcome: 'dismissed' });
          window.dispatchEvent(event);
        })()`,
        waitFor: '#arenas-install-card',
        checks: [pwaCardClearanceCheck],
        screenshot: { path: '/tmp/ask-ai-pwa-card-{width}.png', widths: [360, 414] }, mobileOnly: true }
    ] },
  { user: 'creator', name: 'challenges', path: '/challenges', waitFor: '#tab-mine .challenge-card', root: 'body', bottomNav: athleteNav('Challenges'),
    surfaces: [{ name: 'mine cards', sel: '#tab-mine', min: 2 }],
    checks: [
      whyJoinState('populated My challenges omits the Why-join band', 0, 1),
      heroFullBleedState()
    ],
    steps: [
      { name: 'friends', js: `document.getElementById('tab-btn-friends').click()`, waitFor: '#tab-friends .challenge-card',
        surfaces: [{ name: 'friends cards', sel: '#tab-friends', min: 1, max: 1 }] },
      { name: 'completed', js: `document.getElementById('tab-btn-completed').click()`, waitFor: '#completed-list .challenge-card',
        surfaces: [{ name: 'completed cards', sel: '#completed-list', min: 1, max: 1 }] },
      { name: 'discover', js: `document.getElementById('tab-btn-discover').click()`, waitFor: '#discover-grid .challenge-card',
        surfaces: [{ name: 'discover cards', sel: '#discover-grid', min: 1 }] },
      // arenasOverlay-built modal states (runtime construction — trigger them,
      // there is no static markup). openCreateChallenge bypasses the Pro-lock
      // redirect deliberately: the overlay itself is what gets measured.
      { name: 'modal-create-challenge', js: closeOverlays + `window.openCreateChallenge()`,
        waitFor: '#create-challenge-overlay', root: '#create-challenge-overlay' },
      { name: 'modal-challenge-leaderboard', js: closeOverlays + `document.querySelector('[onclick^="viewLeaderboard"]').click()`,
        waitFor: '#challenge-leaderboard-overlay', root: '#challenge-leaderboard-overlay',
        surfaces: [{ name: 'challenge lb panel', sel: '#challenge-leaderboard-overlay > div', min: 2 }] },
      { name: 'modal-invite-manager', js: closeOverlays + `document.querySelector('[onclick^="openInviteManager"]').click()`,
        waitFor: '#invite-manager-overlay', root: '#invite-manager-overlay' },
      { name: 'modal-manage-challenge', js: closeOverlays + `document.querySelector('[onclick^="openDeleteChallenge"]').click()`,
        waitFor: '#challenge-delete-overlay', root: '#challenge-delete-overlay' }
    ] },
  // f6 is deliberately never added to a challenge: this is the permanent
  // empty-state identity, while the other seeded users exercise populated
  // cards and modal states above.
  { user: 'f6', name: 'challenges-empty', path: '/challenges', waitFor: '#tab-mine .ch-why-join, #tab-mine [data-challenge-why-join]', root: 'body', bottomNav: athleteNav('Challenges', true, false),
    surfaces: [{ name: 'empty mine with Why-join band', sel: '#tab-mine', min: 1 }],
    checks: [
      heroFullBleedState(),
      whyJoinState('empty My challenges shows the Why-join band', 1, 0)
    ] },
  { user: 'member', name: 'challenges-member', path: '/challenges', waitFor: '#tab-mine .challenge-card', root: 'body', bottomNav: athleteNav('Challenges'),
    surfaces: [{ name: 'mine cards (member)', sel: '#tab-mine', min: 1 }],
    steps: [{ name: 'discover', js: `document.getElementById('tab-btn-discover').click()`, waitFor: '#discover-grid .challenge-card',
      surfaces: [{ name: 'discover cards (member)', sel: '#discover-grid', min: 1 }] }] },
  { user: 'creator', name: 'events', path: '/events', waitFor: '#events-grid > *', root: 'body', bottomNav: athleteNav('Events'),
    // Going-attendee avatars overlap by design; fallback initials inherit the
    // same overlap, so exempt only that stack from the generic text-box rule.
    ignoreOverlap: ['.evx-avatar-stack'],
    surfaces: [
      { name: 'events grid', sel: '#events-grid', min: 2 },
      // Owner footer keeps Edit + Image + overflow reachable. Invites/Delete
      // live behind overflow and are exercised by the modal step below.
      { name: 'owner private card actions', sel: '#events-grid .evx-actions:has(> [aria-label="More event actions"])', min: 3 },
      // The redesigned mobile rail follows the event list and keeps all four
      // useful blocks: RSVP counts/history, Coming up, month calendar, and
      // the host card. Exactly four prevents accidental hiding or duplication.
      { name: 'right rail (sidebar-col)', sel: '.sidebar-col', min: 4, max: 4, mobileOnly: true }
    ],
    checks: [
      heroFullBleedState('.ev-hero'),
      { name: 'public max-length overflow fixture renders all text fields', js: `(() => {
        const cards = [...document.querySelectorAll('#events-grid .evx-card')];
        const card = cards.find((el) => el.querySelector('.evx-title')?.textContent.trim() === ${JSON.stringify(OVERFLOW_EVENT_TITLE)});
        if (!card) return { ok: false, missing: 'fixture card', renderedTitles: cards.map((el) => el.querySelector('.evx-title')?.textContent.trim()) };
        const main = card.querySelector('.evx-main');
        const title = card.querySelector('.evx-title');
        const location = [...card.querySelectorAll('.evx-meta span')].find((el) => el.textContent.trim() === ${JSON.stringify(OVERFLOW_EVENT_LOCATION)});
        const description = card.querySelector('.evx-description');
        const fitting = (el) => {
          if (!main || !el) return { ok: false, missing: !main ? 'main' : 'field' };
          const bounds = main.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
          const painted = lines.map((r) => ({
            left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10,
            leftOverflow: Math.max(0, Math.round((bounds.left - r.left) * 10) / 10),
            rightOverflow: Math.max(0, Math.round((r.right - bounds.right) * 10) / 10)
          }));
          return { ok: lines.length > 0 && lines.every((r) => r.left >= bounds.left - 1 && r.right <= bounds.right + 1),
            main: { left: Math.round(bounds.left * 10) / 10, right: Math.round(bounds.right * 10) / 10 },
            lines: painted };
        };
        const fields = {
          title: fitting(title),
          location: fitting(location),
          description: fitting(description?.textContent.trim() === ${JSON.stringify(OVERFLOW_EVENT_DESCRIPTION)} ? description : null)
        };
        return { ok: Object.values(fields).every((field) => field.ok), fields };
      })()` }
    ],
    steps: [
      { name: 'modal-create-event', js: `document.getElementById('create-event-btn').click()`,
        waitFor: '#evx-modal', root: '#evx-modal' },
      // Invite manager on the owner's private event card: invitee list (going
      // + pending w/ revoke) plus the invite-more picker and its send button.
      { name: 'modal-event-invites',
        // Batch C1: #evx-modal rides arenasOverlay — close via the primitive
        // (raw .remove() would leave a stale stack entry + locked scroll).
        js: `window.arenasOverlay.close('evx-modal'); window.arenasOverlay.close('evx-inv-modal');
             for (const more of document.querySelectorAll('[aria-label="More event actions"]')) {
               more.click();
               const invite = document.querySelector('#evx-owner-menu [onclick*="manageInvites"]');
               if (invite) { invite.click(); break; }
               window.arenasOverlay.close('evx-owner-menu');
             }`,
        waitFor: '#evx-inv-pick', root: '#evx-inv-modal',
        surfaces: [{ name: 'event invite manager', sel: '#evx-inv-modal > div', min: 2 }] },
      // Shared 3:1 crop overlay (arenas-crop.js on arenasOverlay). Driven via
      // the image hook — file pickers can't be automated here. Non-black test
      // image so the blank-export guard never trips on the seed.
      { name: 'modal-crop',
        js: `['evx-modal','evx-inv-modal','evx-owner-menu'].forEach((id) => window.arenasOverlay.close(id));
             document.querySelectorAll('#evx-img-modal').forEach((m) => m.remove());
             (() => { const c = document.createElement('canvas'); c.width = 300; c.height = 900;
               const x = c.getContext('2d'); x.fillStyle = '#B33A3A'; x.fillRect(0, 0, 300, 900);
               window.arenasCrop.open({ image: c.toDataURL(), onDone: () => {}, onCancel: () => {} }); })()`,
        waitFor: '#arenas-crop-overlay #ac-slider', root: '#arenas-crop-overlay',
        surfaces: [{ name: 'crop overlay panel', sel: '#arenas-crop-overlay > div', min: 4 }] }
    ] },
  { user: 'creator', name: 'leaderboards', path: '/leaderboards', waitFor: '.board-container', root: 'body', bottomNav: athleteNav('Ranks'),
    surfaces: [
      { name: 'overall board', sel: '.board-container', min: 1 },
      { name: 'podium region', sel: '.board-podium', min: 1 },
      { name: 'ranked-list region', sel: '.board-list', min: 1 }
    ],
    checks: [
      heroFullBleedState('.page-header'),
      { name: 'podium uses vertical cards only on narrow phones', js: `(() => {
        const cols = [...document.querySelectorAll('.podium-col')];
        if (cols.length < 2) return { ok: true, skipped: 'fewer than two ranked athletes' };
        const rects = cols.map((el) => el.getBoundingClientRect());
        const centers = rects.map((r) => r.left + r.width / 2);
        const xSpread = Math.max(...centers) - Math.min(...centers);
        const vertical = xSpread < 8 && new Set(rects.map((r) => Math.round(r.top))).size === rects.length;
        const horizontal = xSpread > Math.max(...rects.map((r) => r.width));
        const mobile = window.innerWidth <= 480;
        return { ok: mobile ? vertical : horizontal, mobile, xSpread,
          rects: rects.map((r) => ({ x: r.x, y: r.y, w: r.width })) };
      })()` }
    ],
    steps: [
      // Shared "How points work" modal (arenas-hpw-modal.js) — one
      // representative page; identical overlay on challenges/my-profile.
      { name: 'modal-hpw', js: `document.querySelector('.hpw-link').click()`,
        waitFor: '#hpw-modal-body', root: '#hpw-modal-overlay' }
    ] },
  { user: 'creator', name: 'profile', path: '/profile', waitFor: '.owner-activity-grid .activity-grid-row', root: 'body', bottomNav: athleteNav('Profile'),
    // Creator has a real active Individual Pro subscription seeded above.
    // Intercept only the Insights data requests so both chart variants are
    // deterministic while entitlement remains server-resolved.
    setup: setupInsightsStubs,
    // The 📷 edit badge deliberately sits ON the avatar circle (desktop
    // parity) — exempt the wrap from the text-overlap rule only.
    ignoreOverlap: ['.hero-av-wrap'],
    // On desktop only, the Insights introduction intentionally has a 16px
    // negative margin for its full-bleed background. The generic clip audit
    // still evaluates every descendant (including its title/body); only these
    // two wrapper boxes are exempt, with an explicit text-visibility check in
    // the Insights state below.
    ignoreClipping: ['.ai2-hero-band', '.ai2-hero'],
    surfaces: [
      { name: 'overview', sel: '#tab-overview', min: 1 },
      { name: 'owner four-week rows', sel: '.owner-activity-grid .activity-grid-rows', min: 4, max: 4 },
      { name: 'owner weekday headings', sel: '.owner-activity-grid .activity-grid-weekdays', min: 7, max: 7 }
    ],
    checks: [
      { name: 'owner grid is exactly 4 rows by 7 columns', js: `(() => {
        const rows = [...document.querySelectorAll('.owner-activity-grid .activity-grid-row')];
        const cells = rows.flatMap((row) => [...row.children]);
        return { ok: rows.length === 4 && cells.length === 28 && rows.every((row) => row.children.length === 7),
          rows: rows.length, cells: cells.length };
      })()` }
    ],
    steps: [
      { name: 'settings-weekly-recap-email', js: htab('settings'), waitFor: '#tab-settings',
        surfaces: [{ name: 'settings tab', sel: '#tab-settings', min: 1 }],
        checks: [recapEmailSettingsCheck] },
      { name: 'activities', js: htab('activities'), surfaces: [{ name: 'activities list', sel: '#tab-activities', min: 1 }] },
      // waitFor the goals-vs-actual bars: they arrive in the same innerHTML
      // assignment as the by-sport svgs, and the render now awaits the goals
      // fetch too — the step's 250ms settle alone is not enough.
      { name: 'stats', js: htab('stats'), waitFor: '#gvw-card .gvw-bar', surfaces: [
        { name: 'stats & PRs body', sel: '#sp-stats-body', min: 1 },
        // By-sport redesign: exactly the three chart SVGs (Sessions, Time,
        // Share of sessions) — weekly stack is divs, so svg count = charts.
        { name: 'by-sport chart svgs', sel: '#sp-stats-body svg[role="img"]', min: 3 },
        // Goals vs actual card (creator has a seeded weekly goal): header +
        // chart body must render at every width (the surface check counts
        // CHILDREN of the matched element, so target the card, not the bars).
        { name: 'goals vs actual card', sel: '#gvw-card', min: 2 }
      ] },
      { name: 'achievements', js: htab('achievements'), surfaces: [{ name: 'achievements tab', sel: '#tab-achievements .content-cols-full', min: 1 }] },
      { name: 'following', js: htab('following'), surfaces: [{ name: 'following grid', sel: '.following-grid', min: 2 }] },
      { name: 'goals', js: htab('goals'), surfaces: [{ name: 'goals tab', sel: '#tab-goals', min: 1 }] },
      { name: 'insights-daily-chart',
        js: `(async () => {
          document.getElementById('htab-insights').click();
          const panel = document.querySelector(${JSON.stringify(INSIGHTS_SCOPE_SELECTOR)});
          const find = (selector) => panel && panel.querySelector(selector);
          for (let i = 0; i < 40 && !find(${JSON.stringify(INSIGHTS_INPUT_SELECTOR)}); i++) {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          const input = find(${JSON.stringify(INSIGHTS_INPUT_SELECTOR)});
          if (!input) throw new Error('Insights composer did not render from in-memory stub');
          input.value = 'Show my training day by day';
          const form = find(${JSON.stringify(INSIGHTS_FORM_SELECTOR)});
          if (!form) throw new Error('Insights form did not render from in-memory stub');
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        })()`,
        waitFor: INSIGHTS_THREAD_SVG_SELECTOR,
        surfaces: [{ name: 'Insights composer', sel: INSIGHTS_BODY_SCOPED_SELECTOR, min: 1 }],
        checks: [
          insightsChartGeometryCheck('Sessions per day', []),
          insightsHeroTextVisibilityCheck
        ] },
      { name: 'insights-weekly-stacked-chart',
        js: `(() => { const panel = document.querySelector(${JSON.stringify(INSIGHTS_SCOPE_SELECTOR)});
          const input = panel && panel.querySelector(${JSON.stringify(INSIGHTS_INPUT_SELECTOR)});
          const form = panel && panel.querySelector(${JSON.stringify(INSIGHTS_FORM_SELECTOR)});
          if (!input || !form) throw new Error('Insights composer did not remain mounted between chart states');
          input.value = 'Show my stacked sessions by sport';
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        })()`,
        waitFor: INSIGHTS_THREAD_SELECTOR.split(', ')
          .map((part) => `${INSIGHTS_SCOPE_SELECTOR} ${part} svg[aria-label*="Sessions per week"]`).join(', '),
        checks: [insightsChartGeometryCheck('Sessions per week', ['Running', 'Cycling', 'Weightlifting', 'Pickleball', 'Basketball', 'Hockey'])] },
      // Live my-profile modals. (modal-comment is dead prototype markup with
      // no opener anywhere — not a reachable state, so not measured.)
      // Batch C2: avatar rides arenasOverlay too (root created per-open,
      // no .open class); close it via the primitive before the next step.
      { name: 'modal-avatar-photo', js: closeModals + `window.openAvatarModal()`,
        waitFor: '#modal-avatar-photo .modal-close', root: '#modal-avatar-photo' },
      { name: 'modal-banner-photo',
        js: `window.arenasOverlay.close('modal-avatar-photo'); window.openBannerModal()`,
        waitFor: '#modal-banner-photo .modal-close', root: '#modal-banner-photo' },
      // Batch B: these two open via window.arenasOverlay as well.
      { name: 'modal-delete-account',
        js: `window.arenasOverlay.close('modal-banner-photo'); window.openDeleteModal()`,
        waitFor: '#modal-delete-account .modal-close', root: '#modal-delete-account' },
      { name: 'modal-goal', js: `window.arenasOverlay.close('modal-delete-account'); ` + closeModals + `window.openGoalForm()`,
        waitFor: '#modal-goal .modal-close', root: '#modal-goal' }
    ] },
  { user: 'public', name: 'weekly-recap-email-unsubscribe',
    path: '/email/unsubscribe/recap?t=' + encodeURIComponent(recapUnsubscribeToken || ''),
    waitFor: '.card', root: 'body',
    surfaces: [{ name: 'unsubscribe confirmation card', sel: '.card', min: 1 }],
    checks: [recapEmailUnsubscribeCheck] },
  { user: 'f6', name: 'profile-free-no-ai', path: '/profile',
    waitFor: '.owner-activity-grid .activity-grid-row', root: 'body',
    bottomNav: athleteNav('Profile', true, false),
    // Same intentionally overlaid avatar edit badge as the Pro profile.
    ignoreOverlap: ['.hero-av-wrap'],
    surfaces: [{ name: 'free profile overview', sel: '#tab-overview', min: 1 }],
    checks: [freeProfileNoAiCheck] },
  { user: 'member', name: 'athlete-profile', path: '/athletes/' + C, bottomNav: athleteNav(),
    waitFor: '.activity-overview-split [data-activity-grid]', root: 'body',
    surfaces: [
      { name: 'public four-week rows', sel: '.activity-overview-split .activity-grid-rows', min: 4, max: 4 },
      { name: 'public weekday headings', sel: '.activity-overview-split .activity-grid-weekdays', min: 7, max: 7 },
      { name: 'public by-sport rows', sel: '[data-by-sport-card] div:has(> .public-sport-hours-row)', min: 1 }
    ],
    checks: [
      { name: 'public grid is exactly 4 rows by 7 columns', js: `(() => {
        const rows = [...document.querySelectorAll('.activity-overview-split .activity-grid-row')];
        const cells = rows.flatMap((row) => [...row.children]);
        const future = cells.filter((cell) => cell.dataset.state === 'future');
        return { ok: rows.length === 4 && cells.length === 28 && rows.every((row) => row.children.length === 7)
          && future.every((cell) => cell.children.length === 0),
          rows: rows.length, cells: cells.length, futureWithDots: future.filter((cell) => cell.children.length).length };
      })()` },
      { name: 'ALL-TIME ACTIVITIES stays on one unclipped line', js: `(() => {
        const el = document.querySelector('[data-stat-label="all-time-activities"]');
        if (!el) return { ok: false, missing: true };
        const range = document.createRange(); range.selectNodeContents(el);
        const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).length;
        return { ok: lines === 1 && el.scrollWidth <= el.clientWidth + 1,
          lines, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      })()` },
      { name: 'grid and By sport use the intended responsive row with equal desktop heights', js: `(() => {
        const grid = document.querySelector('.activity-overview-split [data-activity-grid]');
        const sport = document.querySelector('.activity-overview-split [data-by-sport-card]');
        const tracks = [...document.querySelectorAll('.public-sport-hours-track')];
        if (!grid || !sport || !tracks.length) return { ok: false, missing: true };
        const g = grid.getBoundingClientRect(), s = sport.getBoundingClientRect();
        const tracksWide = tracks.every((track) => track.getBoundingClientRect().width >= 24);
        const mobile = window.innerWidth <= 768;
        const layoutOk = mobile
          ? g.bottom <= s.top + 1 && Math.abs(g.width - s.width) <= 2
          : Math.abs(g.top - s.top) <= 2 && g.right <= s.left + 1 && Math.abs(g.width - s.width) <= 2;
        const equalDesktopHeight = mobile || Math.abs(g.height - s.height) <= 1;
        return { ok: layoutOk && tracksWide && equalDesktopHeight, mobile,
          grid: { x:g.x, y:g.y, width:g.width, height:g.height, bottom:g.bottom },
          sport: { x:s.x, y:s.y, width:s.width, height:s.height, bottom:s.bottom },
          heightDelta: Math.abs(g.height - s.height), trackWidths: tracks.map((track) => track.getBoundingClientRect().width) };
      })()` },
      { name: 'many-sport stretch leaves grid dots top-aligned with slack below', js: `(() => {
        const grid = document.querySelector('.activity-overview-split [data-activity-grid]');
        const body = grid && grid.querySelector('.activity-grid-body');
        const rows = [...document.querySelectorAll('.activity-overview-split .activity-grid-row')];
        if (!grid || !body || rows.length !== 4) return { ok: false, missing: true };
        const mobile = window.innerWidth <= 768;
        const gaps = rows.slice(1).map((row, i) => row.getBoundingClientRect().top - rows[i].getBoundingClientRect().bottom);
        const slackBelowBody = grid.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom;
        const naturalSpacing = gaps.every((gap) => Math.abs(gap - 11) <= 1);
        return { ok: naturalSpacing && (mobile || slackBelowBody > 20), mobile, gaps, slackBelowBody };
      })()` }
    ] },
  { user: 'member', name: 'athlete-profile-one-sport', path: '/athletes/' + F[7], bottomNav: athleteNav(),
    waitFor: '.activity-overview-split [data-activity-grid]', root: 'body',
    surfaces: [
      { name: 'one-sport full-grid rows', sel: '.activity-overview-split .activity-grid-rows', min: 4, max: 4 },
      { name: 'one-sport By sport row', sel: '[data-by-sport-card] div:has(> .public-sport-hours-row)', min: 1, max: 1 }
    ],
    checks: [
      { name: 'one-sport athlete fills every elapsed grid day', js: `(() => {
        const cells = [...document.querySelectorAll('.activity-overview-split .activity-grid-cell')];
        const elapsed = cells.filter((cell) => cell.dataset.state !== 'future');
        return { ok: cells.length === 28 && elapsed.length > 0 && elapsed.every((cell) => cell.dataset.state === 'active'),
          cells: cells.length, elapsed: elapsed.length, active: cells.filter((cell) => cell.dataset.state === 'active').length };
      })()` },
      { name: 'one-sport reverse case stretches By sport to the grid on desktop', js: `(() => {
        const grid = document.querySelector('.activity-overview-split [data-activity-grid]');
        const sport = document.querySelector('.activity-overview-split [data-by-sport-card]');
        if (!grid || !sport) return { ok: false, missing: true };
        const g = grid.getBoundingClientRect(), s = sport.getBoundingClientRect();
        const mobile = window.innerWidth <= 768;
        const layoutOk = mobile
          ? g.bottom <= s.top + 1 && Math.abs(g.width - s.width) <= 2
          : Math.abs(g.top - s.top) <= 2 && g.right <= s.left + 1 && Math.abs(g.width - s.width) <= 2
            && Math.abs(g.height - s.height) <= 1;
        const contentBottom = Math.max(...[...sport.children].map((child) => child.getBoundingClientRect().bottom));
        const slackBelowContent = s.bottom - contentBottom;
        return { ok: layoutOk && (mobile || slackBelowContent > 20), mobile,
          grid: { width:g.width, height:g.height, bottom:g.bottom },
          sport: { width:s.width, height:s.height, bottom:s.bottom }, slackBelowContent };
      })()` }
    ] },
  // Mobile defaults to WEEK view (no .cal-grid) — wait on the shell, then
  // audit week (default) plus an explicit switch to month.
  { user: 'creator', name: 'calendar', path: '/calendar', waitFor: '.main', root: 'body', bottomNav: athleteNav('Cal'),
    surfaces: [{ name: 'calendar body', sel: '.main', min: 1 }],
    steps: [
      { name: 'month', js: `(document.querySelector('[data-view="month"], #view-month') || [...document.querySelectorAll('button')].find((b) => /month/i.test(b.textContent)) || {click(){}}).click()`,
        surfaces: [{ name: 'month grid', sel: '.cal-grid', min: 7 }] },
      // Day panel on a seeded long-title day (mobile = bottom-sheet layout).
      { name: 'modal-day-panel', js: `window.openDayPanel('${dt(-4)}')`,
        waitFor: '#day-panel.open', root: '#day-panel',
        surfaces: [{ name: 'day panel body', sel: '#day-panel .modal-body', min: 1 }] }
    ] },
  { user: 'creator', name: 'athletes', path: '/athletes', waitFor: '#athlete-grid > *', root: 'body', bottomNav: athleteNav(),
    // NOTE: .rec-strip / .nearby-grid / .network-stats exist only as dead
    // prototype CSS — no DOM ever renders them, so they are not surfaces.
    surfaces: [{ name: 'directory cards', sel: '#athlete-grid', min: 4 }],
    steps: [
      { name: 'modal-athlete-profile', js: `document.querySelector('#athlete-grid .adc-card[data-clickable]').click()`,
        // Batch A: quick-view opens via window.arenasOverlay (root created
        // per-open, no .open class); panel ids are unchanged.
        waitFor: '#modal-profile #modal-banner', root: '#modal-profile' }
    ] },
  { user: 'member', name: 'clubs-directory', path: '/clubs', waitFor: '#club-grid > *', root: 'body', bottomNav: athleteNav(),
    surfaces: [{ name: 'club cards', sel: '#club-grid', min: 1 }] },
  { user: 'creator', name: 'log', path: '/log', waitFor: 'form, #act-form, .main', root: 'body', bottomNav: athleteNav(null, false),
    surfaces: [{ name: 'log form', sel: '.main', min: 1 }] },
  { user: 'creator', name: 'billing', path: '/billing', waitFor: '.main', root: 'body', bottomNav: athleteNav(),
    surfaces: [{ name: 'billing content', sel: '.main', min: 1 }] },
  // The ordinary Replit server intentionally has CLUB_PLAN_GATES_ENABLED unset,
  // so this geometry pass sees unlocked free-club analytics. It is not proof of
  // production entitlement or locked-state rendering; verify-club-pro-gates.js
  // owns those assertions on an explicitly gated child server.
  { user: 'creator', name: 'club-dashboard', path: '/clubs/dashboard?club=' + club.id, waitFor: '.main', root: 'body', bottomNav: dashboardNav,
    surfaces: [{ name: 'overview', sel: '.main', min: 1 }],
    steps: [
      { name: 'members', js: `setTab('members', document.querySelector('.nav-item'))`, surfaces: [{ name: 'members tab', sel: '#tab-members', min: 1 }] },
      { name: 'leaderboard', js: `setTab('leaderboard', document.querySelector('.nav-item'))`, surfaces: [{ name: 'lb tab', sel: '#tab-leaderboard', min: 1 }] },
      { name: 'events', js: `setTab('events', document.querySelector('.nav-item'))`, surfaces: [{ name: 'events tab', sel: '#tab-events', min: 1 }] },
      { name: 'feed', js: `setTab('feed', document.querySelector('.nav-item'))`, surfaces: [{ name: 'club feed tab', sel: '#tab-feed', min: 1 }] },
      { name: 'reports', js: `setTab('reports', document.querySelector('.nav-item'))`, surfaces: [{ name: 'reports tab', sel: '#tab-reports', min: 1 }] },
      // Live dashboard modals. (modal-event / modal-event-rsvp /
      // modal-challenge are dead prototype markup with no opener — the live
      // RSVP list is the runtime inline #rsvp-modal-overlay built by
      // viewEventRsvps.)
      // Batch C2: club-logo rides arenasOverlay (no .open class).
      { name: 'modal-club-logo', js: closeModals + `window.openClubLogoModal()`,
        waitFor: '#modal-club-logo .modal-close', root: '#modal-club-logo' },
      { name: 'modal-event-rsvps',
        js: `window.arenasOverlay.close('modal-club-logo'); ` + closeModals + `window.viewEventRsvps('${EVENTS[0]}')`,
        waitFor: '#rsvp-modal-overlay', root: '#rsvp-modal-overlay',
        surfaces: [{ name: 'rsvp list panel', sel: '#rsvp-modal-overlay > div', min: 2 }] }
     ] },
  { user: 'member', name: 'club-member-leaderboard', path: '/clubs/member/' + club.id + '/leaderboard',
    waitFor: '.lb-table', root: 'body', bottomNav: memberLeaderboardNav,
    surfaces: [{ name: 'member leaderboard table', sel: '.lb-table tbody', min: 1 }] },
  { user: 'member', name: 'club-member', path: '/clubs/member/' + club.id, waitFor: '.main', root: 'body', bottomNav: memberNav,
    surfaces: [
      { name: 'member home', sel: '.main', min: 1 },
      { name: 'member home content', sel: '#cm-content', min: 1 }
    ] }
];

// ── measure ──
const only = process.argv.includes('--page') ? process.argv[process.argv.indexOf('--page') + 1] : null;
const geoPagesSpecified = Object.prototype.hasOwnProperty.call(process.env, 'GEO_PAGES');
const geoPageNames = geoPagesSpecified
  ? String(process.env.GEO_PAGES).split(',').map((name) => name.trim())
  : null;
if (geoPagesSpecified && (!geoPageNames.length || geoPageNames.some((name) => !name))) {
  throw new Error('GEO_PAGES must name at least one exact page spec');
}
if (geoPageNames) {
  const knownPageNames = new Set(PAGES.map((cfg) => cfg.name));
  const unknown = geoPageNames.filter((name) => !knownPageNames.has(name));
  if (unknown.length) throw new Error(`GEO_PAGES contains unknown page spec(s): ${unknown.join(', ')}`);
  if (only && !geoPageNames.includes(only)) {
    throw new Error(`--page ${only} is not selected by GEO_PAGES`);
  }
}
const geoPageFilter = geoPageNames && new Set(geoPageNames);
browser = await launchBrowser();
const contexts = {};
for (const key of ['creator', 'member', 'f6']) {
  contexts[key] = await browser.newContext({ ignoreHTTPSErrors: true });
  await contexts[key].addCookies(users[key].cookies);
}
contexts.public = await browser.newContext({ ignoreHTTPSErrors: true });
const summary = [];
for (const cfg of PAGES) {
  if (only && cfg.name !== only) continue;
  if (geoPageFilter && !geoPageFilter.has(cfg.name)) continue;
  let out;
  try {
    out = await auditPage(contexts[cfg.user], BASE, cfg);
  } catch (e) {
    check(`${cfg.name}: page audited`, false, String(e).slice(0, 300));
    summary.push({ page: cfg.name, error: String(e).slice(0, 120) });
    continue;
  }
  console.log(`\n── ${cfg.name} (viewer: ${cfg.user}) ──`);
  for (const s of out.surfaceReport) {
    console.log(`   surface ${s.ok ? 'RENDERED' : (s.found ? 'EMPTY' : 'MISSING')}  ${s.name} (${s.children} children)`);
    check(`${cfg.name}: surface "${s.name}" rendered content (not an unmeasured empty state)`, s.ok, s);
  }
  for (const c of out.checksReport || []) {
    check(`${cfg.name}: ${c.name}`, c.ok, c.detail);
  }
  let pageFails = 0;
  for (const r of out.results) {
    for (const c of r.bottomNav?.checks || []) {
      check(`${r.tag}: ${c.name}`, c.ok, c.detail);
    }
    check(`${r.tag}: no page-level horizontal scroll`, r.hscroll <= 1, { hscroll: r.hscroll });
    check(`${r.tag}: nothing clipped inside a container`, !r.audit.missing && r.audit.clipped.length === 0, r.audit.clipped);
    check(`${r.tag}: no text bounding boxes overlap`, !r.audit.missing && r.audit.overlaps.length === 0, r.audit.overlaps);
    check(`${r.tag}: all buttons in-viewport and hit-testable`, !r.audit.missing && r.audit.offscreenButtons.length === 0, r.audit.offscreenButtons);
    pageFails += (r.bottomNav?.checks || []).filter((c) => !c.ok).length
      + (r.hscroll > 1) + (r.audit.missing || r.audit.clipped.length ? 1 : 0)
      + (r.audit.overlaps.length ? 1 : 0) + (r.audit.offscreenButtons.length ? 1 : 0);
  }
  check(`${cfg.name}: zero console/page errors`, out.errors.length === 0, out.errors.slice(0, 4));
  summary.push({ page: cfg.name, failedChecks: pageFails + (out.errors.length ? 1 : 0), surfacesEmpty: out.surfaceReport.filter((s) => !s.ok).length });
}
console.log('\nPER-PAGE SUMMARY:', JSON.stringify(summary, null, 1));

} finally {
  // ── cleanup: runs even after a partial-seed or mid-audit crash. Every
  // deletion is error-checked; any cleanup failure fails the whole run so
  // leaked seed accounts (deterministic emails + shared password) can never
  // pass silently. ──
  if (browser) await browser.close().catch(() => {});
  if (process.argv.includes('--keep')) {
    console.log('cleanup: SKIPPED (--keep) — seeds left in place');
  } else {
    const clean = makeCleanup();
    const del = (label, q) => clean.cw(label, q);
    // Child rows keyed off tracked parents first, then the rows themselves
    // (reverse creation order so FK children go before parents).
    for (const r of [...createdRows].reverse()) {
      if (r.table === 'challenges') {
        await del('challenge_invites', admin.from('challenge_invites').delete().eq('challenge_id', r.id));
        await del('challenge_participants', admin.from('challenge_participants').delete().eq('challenge_id', r.id));
      }
      if (r.table === 'events') {
        await del('event_rsvps', admin.from('event_rsvps').delete().eq('event_id', r.id));
        // Seeded cover-image objects (private bucket) — best-effort sweep.
        try {
          const { data: objs } = await admin.storage.from('event-images').list('events/' + r.id);
          if (objs && objs.length) await admin.storage.from('event-images')
            .remove(objs.map((o) => 'events/' + r.id + '/' + o.name));
        } catch (e) { console.log('event image sweep (ignored):', e.message); }
      }
      if (r.table === 'posts') {
        await del('post_likes', admin.from('post_likes').delete().eq('post_id', r.id));
        await del('post_comments', admin.from('post_comments').delete().eq('post_id', r.id));
      }
      if (r.id) await del(r.table, admin.from(r.table).delete().eq('id', r.id));
      else {
        let q = admin.from(r.table).delete();
        for (const [k, v] of Object.entries(r.match)) if (v !== null && typeof v !== 'object') q = q.eq(k, v);
        await del(r.table + ' (by match)', q);
      }
    }
    // Belt-and-braces sweep by user id, then the auth users themselves.
    for (const u of createdUsers) {
      for (const t of ['activities', 'achievements', 'goals', 'notifications', 'memberships', 'posts']) {
        await del(t + ' by user', admin.from(t).delete().eq('user_id', u));
      }
      await del('subscriptions by owner', admin.from('subscriptions').delete().eq('owner_id', u));
      await del('follows', admin.from('follows').delete().or(`follower_id.eq.${u},following_id.eq.${u}`));
      await del('notifications by actor', admin.from('notifications').delete().eq('actor_id', u));
    }
    for (const u of createdUsers) {
      await del('auth user ' + u, admin.auth.admin.deleteUser(u));
    }
    if (clean.failed()) {
      failures += clean.count();
      console.log(`cleanup: ${clean.count()} FAILURE(S) — residue may remain; manifest retained at ${MANIFEST}; run scripts/test-data-sweep.js`);
    } else {
      if (existsSync(MANIFEST)) unlinkSync(MANIFEST);
      console.log(`cleanup: ${createdRows.length} rows + ${createdUsers.length} users removed; manifest removed`);
    }
  }
}
console.log(failures ? `\n${failures} FAILURE(S) of ${assertions} assertions` : `\nALL PASS (${assertions} assertions)`);
process.exit(failures ? 1 : 0);
