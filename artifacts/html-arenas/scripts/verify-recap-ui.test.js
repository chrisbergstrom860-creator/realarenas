// Non-seeded recap UI and preference contracts. This loads the real shared
// renderer in Chromium but never starts the application or touches Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchBrowser } from './lib/mobile-geometry.js';

const root = path.resolve(import.meta.dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'html/arenas-insights.js'), 'utf8');
const recapPageSource = fs.readFileSync(path.join(root, 'html/arenas-recaps.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'html/arenas.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const profile = fs.readFileSync(path.join(root, 'html/arenas-my-profile.html'), 'utf8');
const require = createRequire(import.meta.url);
const { runOne } = require('../jobs/recaps');

test('stored recap mount renders validated data and makes no live AI request', async () => {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 414, height: 874 } });
    await page.setContent(`<style>${css}</style><div id="host" style="width:360px"></div><script>${moduleSource}</script>`);
    await page.evaluate(() => {
      window.__recapFetches = 0;
      window.fetch = () => { window.__recapFetches += 1; return Promise.reject(new Error('stored recap must not fetch')); };
      window.ArenasInsights.mountStoredRecap(document.getElementById('host'), {
        prose: 'You logged 3 sessions last week.',
        limitations: ['Detailed training facts cover the last 12 weeks.'],
        evidence: [{ path: 'last12Weeks.weekly.10.activityCount' }],
        chart: {
          title: 'Recorded feelings per week — last 12 weeks',
          metric: 'feelings', period: 'weekly', unit: 'count',
          labels: ['2026-09-01'],
          series: [{ key: 'strong', label: 'Strong', color: '#16A34A', values: [1] }]
        }
      });
    });
    await page.locator('.recap-answer-card').waitFor();
    assert.equal(await page.locator('.recap-prose').textContent(), 'You logged 3 sessions last week.');
    assert.equal(await page.locator('.recap-evidence-badge').textContent(), 'last12Weeks.weekly.10.activityCount');
    assert.equal(await page.locator('.recap-chart svg').count(), 1);
    assert.equal(await page.evaluate(() => window.__recapFetches), 0);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

test('runner findings envelope round-trips a low-history limitation into the stored recap page without live AI', async () => {
  const storedCalls = [];
  const lowHistoryLimitation = 'Only one completed training week is available, so there is not enough history for a comparison.';
  const supabase = {
    async rpc(name, params) {
      if (name === 'claim_weekly_recap') {
        return {
          data: [{
            id: 'recap-1',
            attempts: 1,
            // The runner must return this exact claim value to finish.
            lease_until: params.p_lease_until
          }],
          error: null
        };
      }
      if (name === 'finish_weekly_recap') {
        storedCalls.push(params);
        return { data: [{ id: 'recap-1' }], error: null };
      }
      throw new Error(`unexpected RPC: ${name}`);
    },
    from(table) {
      assert.equal(table, 'notifications');
      return { upsert: async () => ({ error: null }) };
    }
  };
  const service = {
    async buildContextForUser() {
      return { schemaVersion: 'insights-context-v1' };
    },
    async runValidatedRequest() {
      return {
        answer: 'You logged one session last week. Keep logging to unlock week-over-week comparisons.',
        findings: [{ type: 'metric', path: 'last12Weeks.weekly.10.activityCount' }],
        chart: null,
        validated: {
          ok: true,
          limitations: [lowHistoryLimitation],
          evidence: [{ path: 'last12Weeks.weekly.10.activityCount' }]
        },
        usage: null
      };
    }
  };
  await runOne({
    supabase,
    service,
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      user_metadata: { prefs: { weekly_recap: true }, timezone: 'UTC' }
    },
    now: new Date('2026-09-14T09:00:00.000Z'),
    leaseNow: new Date('2026-09-14T09:00:00.000Z'),
    logger: () => {},
    entitlementCheck: async () => ({ eligible: true })
  });
  assert.equal(storedCalls.length, 1);
  // This is the precise JSON payload sent to finish_weekly_recap by the real
  // runner, not a separately hand-authored browser fixture.
  const stored = storedCalls[0];
  assert.deepEqual(stored.p_findings, {
    findings: [{ type: 'metric', path: 'last12Weeks.weekly.10.activityCount' }],
    limitations: [lowHistoryLimitation],
    evidence: [{ path: 'last12Weeks.weekly.10.activityCount' }]
  });

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 414, height: 874 } });
    const recap = {
      weekStart: '2026-09-07',
      weekEnd: '2026-09-13',
      timezone: 'UTC',
      prose: stored.p_prose,
      chart: stored.p_chart,
      limitations: stored.p_findings.limitations,
      evidence: stored.p_findings.evidence
    };
    await page.setContent(`<style>${css}</style><div id="weekly-recap-answer" style="width:360px"></div><script>${moduleSource}</script><script>window.ARENAS_RECAP=${JSON.stringify(recap)};window.__recapFetches=0;window.fetch=function(){window.__recapFetches+=1;return Promise.reject(new Error('stored recap must not fetch'));};</script><script>${recapPageSource}</script>`);
    await page.locator('.recap-answer-card').waitFor();
    assert.equal(await page.locator('.recap-prose').textContent(), recap.prose);
    assert.equal(await page.locator('.recap-limitations').textContent(), lowHistoryLimitation);
    assert.equal(await page.locator('.recap-evidence-badge').textContent(), 'last12Weeks.weekly.10.activityCount');
    assert.equal(await page.evaluate(() => window.__recapFetches), 0);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

test('weekly recap preference is opt-in and server-enforced for enabling', () => {
  assert.match(server, /'weekly_recap',\s*\/\/ opt-in Individual Pro scheduled recap generation/);
  assert.match(server, /const PREF_DEFAULTS = \{ weekly_recap: false,\s*weekly_recap_email: true \}/);
  assert.match(server, /async function writeUserPreference\(userId, key, value\)/);
  assert.match(server, /key === 'weekly_recap' && value === true && \(await getUserPlan\(userId\)\) !== 'pro'/);
  assert.match(server, /status\(403\)\.json\(\{ error: 'pro_required'/);
  assert.match(server, /await writeUserPreference\(req\.user\.id, key, value\)/);
  assert.match(profile, /Weekly AI recap/);
  assert.match(profile, /Every Monday morning, Arenas generates a summary of your previous week's training using AI Insights and notifies you in the app\. Only your own training data is used\./);
  assert.match(profile, /key === 'weekly_recap' \? prefs\[key\] === true/);
});

test('account export includes every self-owned recap with job metadata, while deletion removes them', () => {
  const exportQuery = server.match(/fetchAllRows\('weekly_recaps', q => q\.eq\('user_id', uid\),\s*'([^']+)'\)/);
  assert.ok(exportQuery, 'weekly recap export must be scoped to the requesting account');
  assert.doesNotMatch(exportQuery[0], /\.eq\('status',\s*'generated'\)/);
  for (const field of [
    'status', 'attempts', 'failure_reason', 'findings', 'prose', 'chart',
    'context_schema_version', 'contract_version', 'generated_at', 'created_at'
  ]) {
    assert.match(exportQuery[1], new RegExp(`\\b${field}\\b`));
  }
  assert.match(server, /await del\('weekly_recaps', q => q\.eq\('user_id', uid\)\);/);
});