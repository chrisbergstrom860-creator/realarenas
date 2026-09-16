const assert = require('node:assert/strict');
const test = require('node:test');
const { renderRecapEmail } = require('./email-weekly-recap');

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