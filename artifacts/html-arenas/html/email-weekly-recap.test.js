const assert = require('node:assert/strict');
const test = require('node:test');
const { renderRecapEmail } = require('./email-weekly-recap');
const { chromium } = require('playwright-core');
const { execFileSync } = require('node:child_process');

const links = {
  recapUrl: 'https://realarenas.com/recaps/2026-09-28',
  unsubscribeUrl: 'https://realarenas.com/email/unsubscribe/recap?t=signed',
  settingsUrl: 'https://realarenas.com/my-profile?tab=settings',
  privacyUrl: 'https://realarenas.com/privacy',
  logoUrl: 'https://www.realarenas.com/icons/icon-192.png'
};

function recap({ distance = 13.4, points = 47, chart = { metric: 'feelings', series: [{ label: 'Motivated', values: [2, 4] }, { label: 'Strong', values: [1, 0] }] }, prose = 'Great work.' } = {}) {
  const evidence = [
    { path: 'last12Weeks.weekly.10.activityCount', value: 3 },
    { path: 'last12Weeks.weekly.10.durationHours', value: 1.9 }
  ];
  const findings = [
    { type: 'metric', path: 'last12Weeks.weekly.10.activityCount', value: 3 },
    { type: 'metric', path: 'last12Weeks.weekly.10.durationHours', value: 1.9 }
  ];
  if (distance != null) evidence.push({ path: 'last12Weeks.weekly.10.distanceKm', value: distance });
  if (distance != null) findings.push({ type: 'metric', path: 'last12Weeks.weekly.10.distanceKm', value: distance });
  if (points != null) evidence.push({ path: 'last12Weeks.weekly.10.points', value: points });
  if (points != null) findings.push({ type: 'metric', path: 'last12Weeks.weekly.10.points', value: points });
  return { status: 'generated', week_start: '2026-09-28', timezone: 'America/Los_Angeles', prose, findings: { findings, evidence }, chart };
}

function recapWithExtras() {
  const row = recap();
  row.chart.extras = {
    sportSplit: [
      { sport: 'running', label: 'Running', color: '#e85d04', sessions: 2, hours: 1.4, km: 13.4 },
      { sport: 'yoga', label: 'Yoga', color: '#7462b6', sessions: 1, hours: 0.5, km: 0 }
    ],
    hoursBySport: {
      labels: Array.from({ length: 12 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 6, 13 + index * 7));
        return date.toISOString().slice(0, 10);
      }),
      relative: [],
      series: [
        { sport: 'running', label: 'Running', color: '#e85d04', values: [0, 0.01, 0.4, 0, 0.8, 0, 0, 1, 0, 0, 0, 1.4] },
        { sport: 'yoga', label: 'Yoga', color: '#7462b6', values: [0, 0, 0.1, 0, 0.2, 0, 0, 0, 0, 0, 0, 0.5] }
      ],
      totals: [0, 0.01, 0.5, 0, 1, 0, 0, 1, 0, 0, 0, 1.9]
    }
  };
  return row;
}

test('stored extras render split after metrics and 12-week chart after prose, including text totals', () => {
  const email = renderRecapEmail(recapWithExtras(), {}, links);
  assert.ok(email.html.indexOf('Sessions') < email.html.indexOf('Last week by sport'));
  assert.ok(email.html.indexOf('Last week by sport') < email.html.indexOf('white-space:pre-line'));
  assert.ok(email.html.indexOf('white-space:pre-line') < email.html.indexOf('Hours per week — last 12 weeks'));
  assert.match(email.text, /Running — 2 sessions, 1\.4 h, 13\.4 km/);
  assert.match(email.text, /Yoga — 1 session, 0\.5 h\n/);
  assert.match(email.text, /Jul 13: 0 h\nJul 20: 0\.01 h/);
  assert.doesNotMatch(email.html, /<svg|<canvas|data:image/i);
  assert.equal((email.text.match(/^... \d{1,2}: [\d.]+ h$/gm) || []).length, 12);
  const cells = email.html.match(/<td width="8\.33%" valign="bottom"[^>]*>.*?<\/td>/g) || [];
  assert.equal(cells.length, 12);
  assert.doesNotMatch(cells[0], /background-color:/, 'zero week is an empty slot');
  assert.match(cells[1], /height:2px;background-color:#e85d04/, 'tiny nonzero segment has a two-pixel minimum');
  assert.match(cells[11], /background-color:#e85d04.*background-color:#7462b6/);
});

test('legacy rows and empty stored split add no new sections', () => {
  const old = renderRecapEmail(recap(), {}, links);
  assert.doesNotMatch(old.html + old.text, /Last week by sport|Hours per week — last 12 weeks/);
  const row = recapWithExtras();
  row.chart.extras.sportSplit = [];
  const email = renderRecapEmail(row, {}, links);
  assert.doesNotMatch(email.html + email.text, /Last week by sport/);
  assert.match(email.html, /Hours per week — last 12 weeks/);
});

test('stored sport labels are escaped in text nodes and invalid colors cannot enter CSS', () => {
  const row = recapWithExtras();
  row.chart.extras.sportSplit[0].label = '<img src=x onerror=alert(1)>';
  row.chart.extras.hoursBySport.series[0].label = 'Run</span><script>alert(1)</script>';
  const email = renderRecapEmail(row, {}, links);
  assert.match(email.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(email.html, /Run&lt;\/span&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(email.html, /<script>|<img src=x/);
  row.chart.extras.hoursBySport.series[0].color = 'red;position:fixed';
  assert.throws(() => renderRecapEmail(row, {}, links), /invalid stored sport color/);
  row.chart.extras.hoursBySport.series[0].color = '#e85d04';
  row.chart.extras.hoursBySport.labels[0] = '"><script>alert(1)</script>';
  assert.throws(() => renderRecapEmail(row, {}, links), /invalid stored week start/);
});

test('email chart stays within 320px and 600px widths with alternate dates on narrow screens', async () => {
  const executablePath = process.env.CHROMIUM_BIN || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    const html = renderRecapEmail(recapWithExtras(), {}, links).html;
    for (const width of [320, 600]) {
      await page.setViewportSize({ width, height: 850 });
      await page.setContent(html);
      const geometry = await page.evaluate(() => {
        const chart = [...document.querySelectorAll('table')].find((table) =>
          table.querySelectorAll('td[title]').length === 12);
        const box = chart.getBoundingClientRect();
        return {
          scrollWidth: document.documentElement.scrollWidth,
          chartLeft: box.left, chartRight: box.right,
          visibleDates: [...chart.querySelectorAll('.recap-week-label-odd')].filter((label) =>
            getComputedStyle(label).display !== 'none').length,
          slots: chart.querySelectorAll('td[title]').length
        };
      });
      assert.ok(geometry.scrollWidth <= width, `${width}px document overflow: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.chartLeft >= 0 && geometry.chartRight <= width, `${width}px chart overflow`);
      assert.equal(geometry.visibleDates, width === 320 ? 0 : 6);
      assert.equal(geometry.slots, 12);
    }
    const malicious = recapWithExtras();
    malicious.chart.extras.sportSplit[0].label = '<img src=x onerror=alert(1)>';
    malicious.chart.extras.hoursBySport.series[0].label = '</span><script>window.emailInjected = true</script>';
    await page.setContent(renderRecapEmail(malicious, {}, links).html);
    assert.deepEqual(await page.evaluate(() => ({
      injected: Boolean(window.emailInjected),
      scripts: document.querySelectorAll('script').length,
      images: document.querySelectorAll('img').length
    })), { injected: false, scripts: 0, images: 1 });
  } finally {
    await browser.close();
  }
});

test('weekly recap email renders stored full snapshot and a cross-month subject', () => {
  const email = renderRecapEmail(recap(), { email: 'ignored@example.com' }, links);
  assert.equal(email.subject, 'Your week in training — Sep 28–Oct 4');
  assert.match(email.html, /Sessions/);
  assert.match(email.html, /1\.9 h/);
  assert.match(email.html, /13\.4 km/);
  assert.match(email.html, /47 pts/);
  assert.match(email.text, /Most of your sessions felt motivated or strong\./);
  assert.match(email.html, /width="600"/);
  assert.doesNotMatch(email.html, /<svg|data:image/i, 'does not embed chart images');
});

test('weekly recap email omits absent stored distance and points without recomputing', () => {
  const email = renderRecapEmail(recap({ distance: null, points: null }), { name: 'mutable user' }, links);
  assert.doesNotMatch(email.html, /Distance/);
  assert.doesNotMatch(email.html, /Points/);
  assert.doesNotMatch(email.text, /unavailable/i);
});

test('weekly recap email omits feelings line when no stored feelings chart exists', () => {
  const email = renderRecapEmail(recap({ chart: null }), {}, links);
  assert.doesNotMatch(email.text, /most recorded feelings/i);
});

test('weekly recap email uses the selected current-week metric, never a comparison value', () => {
  const row = recap();
  row.findings.findings.push({
    type: 'comparison',
    leftPath: 'last12Weeks.weekly.10.durationHours',
    leftValue: 1.9,
    rightPath: 'last12Weeks.weekly.9.durationHours',
    rightValue: 88
  });
  row.findings.evidence.unshift({ path: 'last12Weeks.weekly.9.durationHours', value: 88 });
  row.findings.findings.find((finding) => finding.path === 'last12Weeks.weekly.10.durationHours').value = undefined;
  const email = renderRecapEmail(row, {}, links);
  assert.match(email.text, /Hours: 1\.9 h/);
  assert.doesNotMatch(email.text, /88 h/);
});

test('weekly recap email escapes stored prose, chart labels, and supplied URLs', () => {
  const maliciousLinks = { ...links, recapUrl: 'https://realarenas.com/recaps/2026-09-28?x=<script>' };
  const row = recap({
    prose: '<script>alert("x")</script>',
    chart: { metric: 'feelings', title: '<script>', series: [{ label: 'Motivated', values: [3] }] }
  });
  row.findings.findings.push({
    type: 'goal_projection',
    value: { sport: '<script>alert("x")</script>', type: 'frequency', period: 'weekly',
      target: { value: 1, unit: 'session' }, onTrack: true }
  });
  const email = renderRecapEmail(row, {}, maliciousLinks);
  assert.match(email.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
});