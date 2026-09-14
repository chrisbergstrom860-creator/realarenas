// Browser-only fixtures for proving the container-mounted Insights module.
// These deliberately have no server, model, database, auth, or seeded-data
// dependency.  Keep the historical implementation pinned to the extraction
// baseline instead of reading a mutable working-tree profile page.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASELINE = 'ee99f48';
const PROFILE_PATH = 'artifacts/html-arenas/html/arenas-my-profile.html';

export function baselineProfile() {
  return execFileSync('git', ['show', `${BASELINE}:${PROFILE_PATH}`], {
    cwd: path.join(ROOT, '..', '..'),
    encoding: 'utf8'
  });
}

export function currentModule() {
  const file = path.join(ROOT, 'html', 'arenas-insights.js');
  if (!fs.existsSync(file)) {
    throw new Error(`Expected extracted Insights module at ${file}`);
  }
  return fs.readFileSync(file, 'utf8');
}

export function baselineCss() {
  return execFileSync('git', ['show', `${BASELINE}:artifacts/html-arenas/html/arenas.css`], {
    cwd: path.join(ROOT, '..', '..'),
    encoding: 'utf8'
  });
}

export function currentCss() {
  return fs.readFileSync(path.join(ROOT, 'html', 'arenas.css'), 'utf8');
}

export function currentAiCss() {
  const source = currentCss();
  const start = source.indexOf('.ai2-hero-band');
  if (start < 0) throw new Error('Static Insights CSS was not found');
  // The extracted block ends at the next stylesheet section.  This includes
  // its mobile media rules, which are intentionally after the base chart
  // rules in arenas.css.
  const nextSection = source.indexOf('\n/*', start + 1);
  return source.slice(start, nextSection < 0 ? source.length : nextSection);
}

export function baselineAiCss(source = baselineProfile()) {
  const start = source.indexOf('st.textContent = `');
  const aiStart = source.indexOf('.ai2-hero-band', start);
  const end = source.indexOf('`;', aiStart);
  if (start < 0 || aiStart < 0 || end < 0) {
    throw new Error('Baseline AI Insights injected CSS was not found');
  }
  return source.slice(aiStart, end);
}

export function normalizeCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
}

export function profileShellCss(source = baselineProfile()) {
  const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
  if (!styles.length) throw new Error('Baseline profile shell styles were not found');
  return styles.join('\n');
}

export function legacyInsightsScript(source = baselineProfile()) {
  const marker = '// ── AI INSIGHTS TAB ──';
  const markerIndex = source.indexOf(marker);
  const opening = source.lastIndexOf('<script', markerIndex);
  const start = source.indexOf('>', opening) + 1;
  const end = source.indexOf('</script>', markerIndex);
  if (markerIndex < 0 || opening < 0 || start < 1 || end < 0) {
    throw new Error('Baseline AI Insights script was not found');
  }
  return source.slice(start, end);
}

export const proofFixtures = {
  daily: {
    question: 'Show my daily training sessions.',
    chart: {
      metric: 'sessions', unit: 'sessions', period: 'daily',
      title: 'Sessions per day — last 12 weeks', caption: '',
      labels: Array.from({ length: 84 }, (_, i) => dayAt('2026-07-01', i)),
      series: [{ key: 'sessions', label: 'Sessions', color: '#E6B800',
        values: Array.from({ length: 84 }, (_, i) => i % 11 === 0 ? 4 : i % 5 === 0 ? 1 : 0) }]
    }
  },
  stackedWeekly: {
    question: 'Show my weekly sessions by sport.',
    chart: {
      metric: 'sessions', unit: 'sessions', period: 'weekly',
      title: 'Sessions per week by sport', caption: 'Includes every logged sport',
      labels: Array.from({ length: 12 }, (_, i) => dayAt('2026-07-06', i * 7)),
      series: [
        { key: 'running', label: 'Running', color: '#E66A3C', values: [3, 1, 0, 2, 3, 1, 4, 0, 2, 1, 3, 2] },
        { key: 'cycling', label: 'Cycling', color: '#3178C6', values: [1, 2, 3, 0, 1, 2, 0, 3, 1, 2, 0, 1] },
        { key: 'weightlifting', label: 'Weightlifting', color: '#7655A6', values: [0, 2, 1, 3, 0, 1, 2, 1, 3, 0, 1, 2] }
      ]
    }
  },
  feelings: {
    question: 'Show my feelings each week.',
    chart: {
      metric: 'feelings', unit: 'count', period: 'weekly',
      title: 'Feeling counts per week — last 12 weeks', caption: '',
      labels: Array.from({ length: 12 }, (_, i) => dayAt('2026-07-06', i * 7)),
      series: [
        { key: 'strong', label: 'Strong', color: '#2F855A', values: [1, 0, 2, 1, 0, 3, 1, 0, 2, 1, 0, 1] },
        { key: 'motivated', label: 'Motivated', color: '#D69E2E', values: [0, 2, 1, 0, 1, 0, 2, 1, 0, 2, 1, 0] },
        { key: 'easy', label: 'Easy', color: '#3182CE', values: [2, 1, 0, 1, 2, 0, 1, 2, 1, 0, 2, 1] },
        { key: 'tired', label: 'Tired', color: '#718096', values: [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2] },
        { key: 'sore', label: 'Sore', color: '#DD6B20', values: [1, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1] },
        { key: 'struggled', label: 'Struggled', color: '#C53030', values: [0, 1, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0] }
      ]
    }
  }
};

for (const fixture of Object.values(proofFixtures)) {
  fixture.chart.totals = fixture.chart.labels.map((_, index) =>
    fixture.chart.series.reduce((sum, item) => sum + item.values[index], 0));
}

function dayAt(start, offset) {
  const date = new Date(start + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export async function setProofPage(page, { css, width = 414, moduleSource, legacySource } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(`<!doctype html><html><head><style>${profileShellCss()}\n${css}</style>
    <style>#insights-proof-nav,#insights-proof-topbar{display:none!important}</style></head>
    <body><div class="app">
    <header class="topbar" id="insights-proof-topbar" aria-hidden="true"></header>
    <main class="main" id="main-content">
    <button type="button" id="htab-insights" style="display:none">AI Insights</button>
    <div class="tab-content active proof-tab" id="tab-insights">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:var(--border);background:white;flex-wrap:wrap">
        <div><div style="font-size:13px;font-weight:600">AI Insights</div><div style="font-size:11px;color:var(--gray-500);margin-top:1px">Ask descriptive questions about the training data you’ve logged</div></div>
        <div id="ai-insights-usage" style="font-size:11px;color:var(--gray-500)"></div>
      </div>
      <div id="ai-insights-body"><div style="padding:40px;text-align:center;font-size:13px;color:var(--gray-400)">Loading AI Insights…</div></div>
    </div></main></div>
    <!-- This is a shell-layout trigger only.  It has no content or handlers. -->
    <nav class="bottom-nav" id="insights-proof-nav" aria-hidden="true"></nav></body></html>`);
  await page.evaluate(() => {
    window.BASE = '';
    window.ARENAS_DATA = { gating: { aiInsightsPro: true } };
    window.setTab = () => {};
    window.__insightsProofRequests = [];
    window.fetch = async (url, init = {}) => {
      // page.setContent() has the opaque about:blank origin, so resolve the
      // module's relative BASE-prefixed endpoints against a fixed in-memory
      // origin rather than location.href.
      const pathname = new URL(String(url), 'http://insights-proof.invalid').pathname;
      if (pathname.endsWith('/status')) {
        return new Response(JSON.stringify({ used: 2, limit: 30, remaining: 28, resetDate: '2026-10-01' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (pathname.endsWith('/hero-stats')) {
        return new Response(JSON.stringify({
          stats: [
            { icon: 'hours', value: '14.5', label: 'Hours this month' },
            { icon: 'activities', value: '8', label: 'Activities this month' }
          ],
          suggestions: [
            { icon: 'hours', category: 'Training', question: 'How many hours have I trained?' },
            { icon: 'activities', category: 'Activity', question: 'How many activities have I logged?' },
            { icon: 'streak', category: 'Consistency', question: 'What is my current streak?' }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (pathname.endsWith('/ai-insights')) {
        const payload = JSON.parse(init.body || '{}');
        const fixture = window.__insightsProofFixture;
        window.__insightsProofRequests.push(payload);
        return new Response(JSON.stringify({
          answer: 'Your recorded training is shown in this verified chart.',
          evidence: [{ path: 'recorded activities' }],
          limitations: [],
          chart: fixture && fixture.chart,
          historyTurn: { question: payload.question || '', answer: 'signed proof turn', token: 'proof' },
          usage: { used: 3, limit: 30, remaining: 27, resetDate: '2026-10-01' }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected proof request: ${pathname}`);
    };
  });
  if (legacySource) {
    await page.addScriptTag({ content: legacySource });
    await page.evaluate(() => document.getElementById('htab-insights')?.click());
  } else if (moduleSource) {
    await page.addScriptTag({ content: moduleSource });
    await page.evaluate(() => {
      if (!window.ArenasInsights || typeof window.ArenasInsights.mount !== 'function') {
        throw new Error('ArenasInsights.mount was not exported by arenas-insights.js');
      }
      window.ArenasInsights.mount(document.getElementById('tab-insights'), {
        base: '', proEntitled: true
      });
    });
  } else {
    throw new Error('A legacy script or extracted module source is required');
  }
  await page.locator('#tab-insights textarea').waitFor();
}

export async function submitProofFixture(page, fixture) {
  await page.evaluate((next) => { window.__insightsProofFixture = next; }, fixture);
  const host = page.locator('#tab-insights');
  await host.locator('textarea').fill(fixture.question);
  await host.locator('form').evaluate((form) => form.requestSubmit());
  await host.locator('svg[role="img"]').waitFor();
}

// ID values are intentionally absent from this projection: generated
// per-mount label/description IDs are permitted, but changing a legacy
// identifier into a class changes this tree and therefore fails the proof.
export async function classTree(page) {
  return page.locator('#tab-insights').evaluate((host) => {
    const visit = (node) => ({
      tag: node.tagName.toLowerCase(),
      classes: [...node.classList].sort(),
      children: [...node.children].map(visit)
    });
    return [...host.children].map(visit);
  });
}