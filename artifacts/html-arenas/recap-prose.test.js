'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderRecapProse, resolveRecapExtras } = require('./recap-prose');
const { escapeHtml } = require('./email-transport');

function extrasContext(sports = []) {
  return { last12Weeks: { weekly: Array.from({ length: 12 }, (_, i) => ({
    weekStart: new Date(Date.UTC(2026, 6, 6 + i * 7)).toISOString().slice(0, 10),
    relative: i === 10 ? 'last_week' : i === 11 ? 'this_week' : `${11 - i}_weeks_ago`,
    durationHours: i === 10 ? sports.reduce((sum, sport) => sum + sport.durationHours, 0) : 0,
    sports: i === 10 ? sports : []
  })) } };
}

test('extras snapshot mixed sports by hours, using the shared registry and resolver', () => {
  const context = extrasContext([
    { sport: 'running', sessions: 2, durationHours: 1.2, distanceKm: 10 },
    { sport: 'yoga', sessions: 1, durationHours: 2, distanceKm: 0 }
  ]);
  const before = JSON.stringify(context);
  const extras = resolveRecapExtras(context);
  assert.deepEqual(extras.sportSplit.map((item) => item.sport), ['yoga', 'running']);
  assert.equal(extras.sportSplit[0].hours, 2);
  assert.equal(extras.sportSplit[0].km, 0);
  assert.equal(extras.sportSplit[1].km, 10);
  assert.equal(extras.hoursBySport.totals[10], 3.2);
  assert.equal(extras.hoursBySport.totals[9], 0);
  assert.equal(extras.hoursBySport.labels.length, 11);
  assert.equal(extras.hoursBySport.labels.at(-1), context.last12Weeks.weekly[10].weekStart);
  assert.equal(extras.hoursBySport.relative.length, 11);
  assert.equal(extras.hoursBySport.relative.at(-1), 'last_week');
  assert.ok(!extras.hoursBySport.relative.includes('this_week'));
  for (const series of extras.hoursBySport.series) {
    const sport = require('./sports').SPORTS.find((item) => item.id === series.sport);
    assert.equal(series.color, sport.colors.text);
    assert.equal(series.label, sport.label);
    assert.equal(series.values.length, 11);
  }
  assert.equal(JSON.stringify(context), before);
});

test('extras support a single sport and preserve raw precision', () => {
  const extras = resolveRecapExtras(extrasContext([
    { sport: 'cycling', sessions: 1, durationHours: 1.234, distanceKm: 23.456 }
  ]));
  assert.equal(extras.sportSplit[0].hours, 1.234);
  assert.equal(extras.sportSplit[0].km, 23.456);
  assert.equal(extras.hoursBySport.series.length, 1);
  assert.equal(extras.hoursBySport.series[0].values[10], 1.234);
});

test('current-week activity is excluded without changing the shared 12-week resolver', () => {
  const context = extrasContext([{ sport: 'running', sessions: 1, durationHours: 2, distanceKm: 10 }]);
  context.last12Weeks.weekly[11].sports = [{ sport: 'running', sessions: 1, durationHours: 99, distanceKm: 99 }];
  context.last12Weeks.weekly[11].durationHours = 99;
  const extras = resolveRecapExtras(context).hoursBySport;
  assert.equal(extras.labels.length, 11);
  assert.equal(extras.labels.at(-1), context.last12Weeks.weekly[10].weekStart);
  assert.equal(extras.totals.at(-1), 2);
  assert.ok(!extras.totals.includes(99));
  assert.ok(!extras.relative.includes('this_week'));
  const shared = require('./ai-insights').resolveChartSeries({
    type: 'chart', metric: 'durationHours', period: 'weekly',
    evidence: 'last12Weeks.weekly', stackBySport: true
  }, context);
  assert.equal(shared.labels.length, 12);
  assert.equal(shared.totals.at(-1), 99);
});

test('no activities retains eleven completed zero slots and empty split; malformed snapshots fail explicitly', () => {
  const extras = resolveRecapExtras(extrasContext());
  assert.deepEqual(extras.sportSplit, []);
  assert.deepEqual(extras.hoursBySport.totals, Array(11).fill(0));
  assert.deepEqual(extras.hoursBySport.series, []);
  const context = extrasContext([{ sport: 'running', sessions: 1, durationHours: NaN, distanceKm: 0 }]);
  assert.throws(() => resolveRecapExtras(context), /invalid sport data/);
  assert.throws(() => resolveRecapExtras({}), /twelve weeks/);
});

function envelope({
  sessions = 3, hours = 2.4, distance = 8.6, points = 42,
  delta = 2.4, limitations = [], goal = null, calendar = null
} = {}) {
  const findings = [
    { type: 'metric', path: 'last12Weeks.weekly.10.activityCount', value: sessions },
    { type: 'metric', path: 'last12Weeks.weekly.10.durationHours', value: hours }
  ];
  if (distance != null) findings.push({ type: 'metric', path: 'last12Weeks.weekly.10.distanceKm', value: distance });
  if (points != null) findings.push({ type: 'metric', path: 'last12Weeks.weekly.10.points', value: points });
  if (delta != null) findings.push({
    type: 'comparison', leftPath: 'last12Weeks.weekly.10.durationHours',
    rightPath: 'last12Weeks.weekly.9.durationHours', delta
  });
  if (goal) findings.push({ type: 'goal_projection', value: goal });
  if (calendar) findings.push(calendar);
  return { findings, limitations };
}

const meta = {
  weekStart: '2026-09-07',
  chart: { metric: 'feelings', series: [{ label: 'Motivated', values: [3, 1] }, { label: 'Strong', values: [2] }] }
};

test('golden founder Sept 7–13 findings render deterministically', () => {
  // Read-only source: the actual founder row was inspected before this
  // sanitized fixture was committed. It deliberately contains no emailDelivery
  // payload, recipient, token, user id, or prose.
  const founder = {
    findings: [
      { path: 'last12Weeks.weekly.10.activityCount', type: 'metric', value: 3 },
      { path: 'last12Weeks.weekly.10.durationHours', type: 'metric', value: 1.9 },
      { path: 'last12Weeks.weekly.10.distanceKm', type: 'metric', value: 13.4 },
      { type: 'comparison', leftPath: 'last12Weeks.weekly.10.durationHours', leftValue: 1.9, rightPath: 'last12Weeks.weekly.9.durationHours', rightValue: 2.9 },
      { type: 'chart', metric: 'feelings', period: 'weekly', evidence: 'last12Weeks.feelings' },
      { type: 'goal_projection', value: { type: 'frequency', sport: 'weightlifting', period: 'weekly', target: { unit: 'sessions', value: 4 }, onTrack: true } }
    ]
  };
  const chart = { metric: 'feelings', series: [{ label: 'Motivated', values: [25] }, { label: 'Strong', values: [13] }] };
  assert.equal(renderRecapProse(founder, { weekStart: '2026-09-07', chart }),
    'Last week (Sep 7–13) you logged 3 sessions, 1.9 hours and 13.4 km — about an hour less than the week before. Most of your sessions felt motivated or strong. Your weightlifting frequency goal (4 sessions per week) is on track for this period.');
});

test('sentence template variants use only finding snapshot values', () => {
  const cases = [
    ['no distance / low history', envelope({ distance: null, delta: 2.4, limitations: ['INSUFFICIENT_TREND_DATA'] }),
      'Last week (Sep 7–13) you logged 3 sessions, 2.4 hours for 42 points.'],
    ['no hours with distance', envelope({ hours: null, distance: 8.6, delta: null }),
      'Last week (Sep 7–13) you logged 3 sessions and 8.6 km for 42 points.'],
    ['one hour delta', envelope({ delta: 1 }), 'Last week (Sep 7–13) you logged 3 sessions, 2.4 hours and 8.6 km for 42 points — about an hour more than the week before.'],
    ['zero delta', envelope({ delta: 0 }), 'Last week (Sep 7–13) you logged 3 sessions, 2.4 hours and 8.6 km for 42 points — the same as the week before.'],
    ['two point four hour delta', envelope({ delta: 2.4 }), 'Last week (Sep 7–13) you logged 3 sessions, 2.4 hours and 8.6 km for 42 points — 2.4 hours more than the week before.'],
    ['negative delta', envelope({ delta: -2.4 }), 'Last week (Sep 7–13) you logged 3 sessions, 2.4 hours and 8.6 km for 42 points — 2.4 hours less than the week before.'],
    ['negative rounding boundary', envelope({ delta: -1.05 }), 'Last week (Sep 7–13) you logged 3 sessions, 2.4 hours and 8.6 km for 42 points — 1.1 hours less than the week before.'],
    ['negative about-hour boundary', envelope({ delta: -0.95 }), 'Last week (Sep 7–13) you logged 3 sessions, 2.4 hours and 8.6 km for 42 points — about an hour less than the week before.'],
    ['singular session', envelope({ sessions: 1, hours: null, distance: null, points: null, delta: null }),
      'Last week (Sep 7–13) you logged 1 session.']
  ];
  for (const [name, findings, expected] of cases) {
    assert.equal(renderRecapProse(findings, { weekStart: meta.weekStart }), expected, name);
  }
});

test('feelings ties, goal pace, and calendar count use stored values', () => {
  const findings = envelope({
    delta: null,
    goal: { sport: 'running', type: 'distance', period: 'monthly', target: { value: 50, unit: 'km' }, onTrack: false },
    calendar: { type: 'calendar_event_list', path: 'calendar.events.items', filter: { month: '2026-09' } }
  });
  findings.evidence = [
    { path: 'calendar.events.byMonth.0', value: { month: '2026-09', count: 3 } },
    { path: 'calendar.events.items.0', value: { date: '2026-09-14' } },
    { path: 'calendar.events.items.1', value: { date: '2026-09-16' } },
    { path: 'calendar.events.items.2', value: { date: '2026-09-20' } }
  ];
  const prose = renderRecapProse(findings, {
    weekStart: meta.weekStart,
    chart: { metric: 'feelings', series: [{ label: 'Strong', values: [2] }, { label: 'Motivated', values: [2] }] }
  });
  assert.equal(prose,
    'Last week (Sep 7–13) you logged 3 sessions, 2.4 hours and 8.6 km for 42 points. Most of your sessions felt motivated or strong. Your running distance goal (50 km per month) is behind pace for this period. Coming up this week: 3 events.');
  const onePlan = envelope({ delta: null, calendar: { type: 'calendar_plan_list', path: 'calendar.plannedSessions.items', filter: { month: '2026-09' } } });
  onePlan.evidence = [
    { path: 'calendar.plannedSessions.byMonth.0', value: { month: '2026-09', plannedCount: 1 } },
    { path: 'calendar.plannedSessions.items.4', value: { date: '2026-09-15', status: 'planned' } }
  ];
  assert.match(renderRecapProse(onePlan, { weekStart: meta.weekStart }),
    /Coming up this week: 1 planned session\.$/);
});

test('canonical calendar evidence omits a month count when an item is outside the coming week', () => {
  const findings = envelope({
    delta: null,
    calendar: { type: 'calendar_event_list', path: 'calendar.events.items', filter: { month: '2026-09' } }
  });
  findings.evidence = [
    { path: 'calendar.events.byMonth.0', value: { month: '2026-09', count: 3 } },
    { path: 'calendar.events.items.0', value: { date: '2026-09-15' } },
    { path: 'calendar.events.items.1', value: { date: '2026-09-16' } },
    { path: 'calendar.events.items.2', value: { date: '2026-09-28' } }
  ];
  assert.doesNotMatch(renderRecapProse(findings, { weekStart: meta.weekStart }), /Coming up this week/);
});

test('canonical calendar summary retains a validated twenty-item coming-week count after Q&A display caps evidence at ten', () => {
  const findings = envelope({
    delta: null,
    calendar: { type: 'calendar_event_list', path: 'calendar.events.items', filter: { month: '2026-09' } }
  });
  findings.evidence = [
    { path: 'calendar.events.byMonth.0', value: { month: '2026-09', count: 20, truncated: false } },
    ...Array.from({ length: 10 }, (_, index) => ({
      path: `calendar.events.items.${index}`, value: { date: '2026-09-15' }
    }))
  ];
  assert.match(renderRecapProse(findings, { weekStart: meta.weekStart }), /Coming up this week: 20 events\.$/);
});

test('calendar timestamps use the recap timezone while literal date keys stay literal', () => {
  const findings = envelope({
    delta: null,
    calendar: { type: 'calendar_event_list', path: 'calendar.events.items', filter: { month: '2026-09' } }
  });
  findings.evidence = [
    { path: 'calendar.events.byMonth.0', value: { month: '2026-09', count: 1, truncated: false } },
    { path: 'calendar.events.items.0', value: { date: '2026-09-21T01:00:00.000Z' } }
  ];
  assert.match(renderRecapProse(findings, {
    weekStart: meta.weekStart, timezone: 'America/Los_Angeles'
  }), /Coming up this week: 1 event\.$/);
  assert.doesNotMatch(renderRecapProse(findings, {
    weekStart: meta.weekStart, timezone: 'UTC'
  }), /Coming up this week/);
});

test('empty findings falls back, and HTML escaping remains at the HTML boundary', () => {
  assert.equal(renderRecapProse([], { weekStart: '2026-09-07', storedProse: 'Stored legacy prose.' }), 'Stored legacy prose.');
  const prose = renderRecapProse(envelope({
    delta: null,
    goal: { sport: '<script>alert(1)</script>', type: 'frequency', period: 'weekly', target: { value: 1, unit: 'session' }, onTrack: true }
  }), { weekStart: meta.weekStart });
  assert.match(prose, /<script>alert\(1\)<\/script>/, 'plain text remains literal');
  assert.doesNotMatch(escapeHtml(prose), /<script>/, 'HTML boundary escapes literal text');
});

test('nonempty malformed findings fail rather than falling back to model prose', () => {
  assert.throws(() => renderRecapProse({
    findings: [{ type: 'metric', path: 'last12Weeks.weekly.10.durationHours', value: 2 }]
  }, { weekStart: '2026-09-07', storedProse: 'Do not use this.' }), /required session metric/);
  assert.throws(() => renderRecapProse(envelope({ delta: null }), {
    weekStart: 'bad-date', storedProse: 'Do not use this.'
  }), /valid week start/);
  assert.throws(() => renderRecapProse({ findings: { not: 'an array' } }, {
    weekStart: '2026-09-07', storedProse: 'Do not use this.'
  }), /must be an array/);
});