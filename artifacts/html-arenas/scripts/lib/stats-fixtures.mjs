// Deterministic /api/profile/stats fixtures in the PLANNED commit-2 shape
// (period windows, comparisons, multi-metric weekly buckets). Pure — no DB,
// no clock: "today" is pinned so harness screenshots are reproducible.
// Shared by scripts/shot-stats-redesign.mjs and the unit guards.

export const TODAY = '2026-03-18'; // a Wednesday — the final week is partial

const DAY = 86400000;
const key = (d) => d.toISOString().slice(0, 10);
const parse = (k) => new Date(k + 'T00:00:00Z');
const addDays = (k, n) => key(new Date(parse(k).getTime() + n * DAY));
const monday = (k) => { const d = parse(k); return addDays(k, -((d.getUTCDay() + 6) % 7)); };
const fmtLabel = (k) => parse(k).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Seeded PRNG so every run is identical.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const MIX = [
  { sport: 'cycling', p: 0.55, kmPerH: 27 },
  { sport: 'running', p: 0.7, kmPerH: 10.5 },
  { sport: 'weightlifting', p: 0.45, kmPerH: 0 },
  { sport: 'yoga', p: 0.25, kmPerH: 0 },
  { sport: 'swimming', p: 0.15, kmPerH: 2.6 }
];

export function windowFor(period, today = TODAY) {
  const end = addDays(today, 1); // exclusive
  let start;
  if (period === '6w') start = addDays(monday(today), -35);
  else if (period === '12w') start = addDays(monday(today), -77);
  else if (period === '6m' || period === '1y') {
    const t = parse(today);
    const back = period === '6m' ? 5 : 11;
    start = key(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - back, 1)));
  } else start = '2023-05-08';
  const days = Math.round((parse(end) - parse(start)) / DAY);
  return { start, end, days };
}

function bucket(r, start, end, isPartial) {
  const bySport = [];
  MIX.forEach((m) => {
    if (r() > m.p) return;
    const sessions = 1 + Math.floor(r() * 3);
    const hours = Math.round(sessions * (0.5 + r() * 1.3) * 10) / 10;
    const km = m.kmPerH ? Math.round(hours * m.kmPerH * 10) / 10 : 0;
    bySport.push({ sport: m.sport, hours, km, sessions });
  });
  bySport.sort((a, b) => b.hours - a.hours);
  const sum = (f) => Math.round(bySport.reduce((s, x) => s + x[f], 0) * 10) / 10;
  return { label: fmtLabel(start), start, end, isPartial, hours: sum('hours'), km: sum('km'), sessions: sum('sessions'), bySport };
}

export function statsFixture(period = '12w', opts = {}) {
  const today = opts.today || TODAY;
  const win = windowFor(period, today);
  const r = rng(opts.seed || 7);
  // Weekly buckets: Monday-start; first bucket clipped to window.start for
  // calendar periods, last bucket ends at tomorrow (exclusive), partial.
  const lastMon = monday(today);
  const firstMon = monday(win.start);
  const allWeeks = Math.round((parse(lastMon) - parse(firstMon)) / (7 * DAY)) + 1;
  const capped = allWeeks > 104;
  const n = Math.min(allWeeks, 104);
  const weeklyChart = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = addDays(lastMon, -7 * i);
    const start = s < win.start ? win.start : s;
    const isLast = i === 0;
    const end = isLast ? win.end : addDays(s, 7);
    const b = bucket(r, start, end, isLast && end !== addDays(s, 7));
    if (opts.emptyWeeks && i % 5 === 2) { b.hours = 0; b.km = 0; b.sessions = 0; b.bySport = []; }
    weeklyChart.push(b);
  }
  const agg = {};
  weeklyChart.forEach((w) => w.bySport.forEach((s) => {
    const a = agg[s.sport] || (agg[s.sport] = { sport: s.sport, sessions: 0, km: 0, hours: 0 });
    a.sessions += s.sessions; a.km += s.km; a.hours += s.hours;
  }));
  const sportBreakdown = Object.values(agg).map((a) => ({ ...a, km: Math.round(a.km * 10) / 10, hours: Math.round(a.hours * 10) / 10 }))
    .sort((a, b) => b.sessions - a.sessions);
  if (opts.withZeroSport) sportBreakdown.push({ sport: 'golf', sessions: 0, km: 0, hours: 0 });
  const activities = sportBreakdown.reduce((s, x) => s + x.sessions, 0);
  const totalKm = Math.round(sportBreakdown.reduce((s, x) => s + x.km, 0) * 10) / 10;
  const totalHours = Math.round(sportBreakdown.reduce((s, x) => s + x.hours, 0) * 10) / 10;

  let previous = null, comparison = null;
  if (period !== 'all') {
    const prevEnd = win.start;
    const prevStart = addDays(win.start, -win.days);
    const pa = opts.previousEmpty ? 0 : Math.round(activities * 0.86);
    const pk = opts.previousEmpty ? 0 : Math.round(totalKm * 1.07 * 10) / 10;
    const ph = opts.previousEmpty ? 0 : Math.round(totalHours * 0.93 * 10) / 10;
    previous = { start: prevStart, end: prevEnd, activities: pa, totalKm: pk, totalHours: ph };
    const pct = (cur, prev) => (prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10);
    comparison = { activitiesPct: pct(activities, pa), kmPct: pct(totalKm, pk), hoursPct: pct(totalHours, ph), previousEmpty: pa === 0 };
  }

  const allPrs = [
    { icon: '🏃', label: 'Longest run', value: '21.4 km', meta: '9 Nov 2025 · Harbour half' },
    { icon: '⚡', label: 'Fastest pace · run', value: '4:38 /km', meta: '2 Feb 2026 · Track 5k' },
    { icon: '🚴', label: 'Longest ride', value: '112.6 km', meta: '14 Sep 2025 · Ridgeline loop' },
    { icon: '⏱', label: 'Longest activity', value: '4h 52m', meta: '14 Sep 2025 · Cycling' },
    { icon: '📅', label: 'Biggest week', value: '13.7h', meta: 'Week of 8 Sep · 9 activities' },
    { icon: '📍', label: 'Biggest month', value: '46.2h', meta: 'September 2025 · across all sports' }
  ];
  const prs = opts.noCycling ? allPrs.filter((p) => p.label !== 'Longest ride') : allPrs;

  return {
    hero: { activities, totalKm, totalHours, totalPoints: 4821 },
    streaks: { current: 4, longest: 23, avgPerWeek: 3.4 },
    weekStrip: Array.from({ length: 7 }, (_, i) => {
      const k = addDays(monday(today), i);
      return { date: k, label: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i], active: i !== 1 && k <= today, isToday: k === today, isFuture: k > today };
    }),
    sportBreakdown,
    prs,
    weeklyChart,
    weeklyCoverage: { buckets: n, capped },
    chartWeeks: n,
    window: win,
    previous,
    comparison
  };
}

// Populated /api/goals `active` list (server-enriched shape, as consumed by
// the unchanged Goals vs actual card) — mirrors shot-goal-chart.mjs.
const g = (id, period, type, sport, target, progress, expected, extra = {}) => ({
  id, period, type, sport, target, progress, expectedProgress: expected,
  unit: type === 'distance' ? 'km' : type === 'duration' ? 'hours' : type === 'streak' ? 'days' : 'sessions',
  onTrack: progress >= expected, isComplete: progress >= target, ...extra
});
const dist = (o) => ({ ...o, targetKm: o.target, progressKm: o.progress, expectedKm: o.expectedProgress });
export function goalsFixture(variant = 'populated') {
  if (variant === 'empty') return [];
  return [
    g('w1', 'weekly', 'frequency', 'cycling', 4, 3, 2.3),
    g('w2', 'weekly', 'frequency', 'running', 5, 2, 2.9),
    g('w3', 'weekly', 'duration', null, 8, 5.4, 4.6),
    dist(g('w4', 'weekly', 'distance', 'cycling', 150, 96.4, 86)),
    g('m1', 'monthly', 'frequency', 'weightlifting', 12, 7, 6.8),
    g('m2', 'monthly', 'duration', null, 34, 19.5, 19.7),
    g('s1', 'weekly', 'streak', null, 7, 4, 4)
  ];
}
