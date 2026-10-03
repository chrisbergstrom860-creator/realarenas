// Unit tests for ArenasCharts.renderGrouped (pure string renderer; no browser,
// no network, no seeds). Target: scripts/goal-grouped-chart.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = process.env.INSIGHTS_JS || path.join(__dirname, '../html/arenas-insights.js');
function load(innerWidth) {
  const win = { innerWidth };
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), { window: win, document: {}, Array, Math, Number, String, isFinite });
  return win;
}
const W = load(1280);
const R = W.ArenasCharts.renderGrouped;
const attrs = (html, re) => [...html.matchAll(re)].map(m => m[1]);
const rects = (html, kind) => [...html.matchAll(new RegExp('<rect class="gc-bar gc-' + kind + '"[^>]*?data-value="([^"]+)"[^>]*?y="([^"]+)"[^>]*?height="([^"]+)"', 'g'))].map(m => ({ v: +m[1], y: +m[2], h: +m[3] }));

test('existing Insights renderer still exported and untouched', () => {
  assert.equal(typeof W.ArenasInsights.mount, 'function');
});
test('dynamic streak Calendar link respects both root deployment and preview base', () => {
  const html = fs.readFileSync(path.join(__dirname, '../html/arenas-my-profile.html'), 'utf8');
  const start = html.indexOf('  function gvwStreakHtml(stats) {');
  const end = html.indexOf('  // Draw every chart host', start);
  assert.ok(start > 0 && end > start);
  for (const base of ['', '/html']) {
    const ctx = vm.createContext({ window: { BASE: base }, goalsActive: [], esc: String, gvwFmt: () => ({ num: String }) });
    vm.runInContext(html.slice(start, end), ctx);
    const markup = ctx.gvwStreakHtml({ streaks: { current: 0, longest: 0 }, weekStrip: [] });
    assert.ok(markup.includes('href="' + base + '/calendar"'));
  }
});
test('unmeasurable width returns empty string', () => {
  assert.equal(R({ groups: [] }, 0), '');
});
test('shared scale: 1-of-4 and 5-of-5 are proportional on one axis', () => {
  const html = R({ integer: true, groups: [{ id: 'a', label: 'Run', goal: 4, actual: 1 }, { id: 'b', label: 'Ride', goal: 5, actual: 5 }] }, 600);
  const g = rects(html, 'goal'), a = rects(html, 'actual');
  assert.ok(Math.abs(g[0].h / g[1].h - 4 / 5) < 0.01);
  assert.ok(Math.abs(a[0].h / a[1].h - 1 / 5) < 0.01);
  assert.ok(Math.abs(a[1].h - g[1].h) < 0.01);
});
test('integer ticks for sessions', () => {
  const html = R({ integer: true, groups: [{ id: 'a', label: 'x', goal: 7, actual: 3 }] }, 500);
  const ticks = attrs(html, /class="ai-chart-axis-label"[^>]*>([^<]+)</g);
  ticks.forEach(t => assert.match(t, /^\d+$/));
  assert.ok(+ticks[ticks.length - 1] >= 7);
});
test('expected tick sits at expectedProgress on the shared scale', () => {
  const html = R({ groups: [{ id: 'a', label: 'x', goal: 10, actual: 2, expected: 5 }] }, 500);
  const top = +attrs(html, /data-gc-plot-top="([^"]+)"/g)[0], bottom = +attrs(html, /data-gc-plot-bottom="([^"]+)"/g)[0];
  const max = +attrs(html, /data-gc-scale-max="([^"]+)"/g)[0];
  const y = +attrs(html, /class="gc-expected"[^>]*?y1="([^"]+)"/g)[0];
  assert.ok(Math.abs(y - (bottom - (5 / max) * (bottom - top))) < 0.01);
  assert.equal(attrs(html, /class="gc-expected"[^>]*?data-value="([^"]+)"/g)[0], '5');
});
test('scale includes expected and no tick when expected missing', () => {
  const html = R({ groups: [{ id: 'a', label: 'x', goal: 2, actual: 1 }] }, 500);
  assert.ok(!html.includes('gc-expected'));
});
test('status text, tooltips and escaping', () => {
  const html = R({ groups: [
    { id: '1', label: '<b>', goal: 1, actual: 1, status: 'done', goalTip: 'Goal: 5 mi' },
    { id: '2', label: 'y', goal: 1, actual: 0, status: 'behind' },
    { id: '3', label: 'z', goal: 1, actual: 1, status: 'on' }] }, 600);
  assert.ok(html.includes('✓ Done') && html.includes('Behind') && html.includes('On pace'));
  assert.ok(html.includes('<title>Goal: 5 mi</title>'));
  assert.ok(!html.includes('<b>') && html.includes('&lt;b&gt;'));
});
test('5 groups at 360: labels truncated, value labels do not overlap', () => {
  const groups = ['🏃 Running', '🚴 Cycling', '🏊 Swimming', '🏋️ Weightlifting', '🏆 Any sport'].map((l, i) => ({ id: String(i), label: l, goal: 12.5, actual: 10.5 }));
  const html = R({ groups }, 330);
  const labels = attrs(html, /<\/title>([^<]*)<\/text>/g);
  assert.equal(labels.length, 5);
  assert.ok(labels.some(l => l.endsWith('…')));
  const xs = attrs(html, /class="gc-value"[^>]*?x="([^"]+)"/g).map(Number);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 4 * 9.5 * 0.6 - 0.01, 'value gap ' + (xs[i] - xs[i - 1]));
});
test('integer scale: huge targets stay ≤5 integer ticks, shared scale', () => {
  for (const goal of [3, 7, 43, 999, 12345, 7654321, 1e12]) {
    const html = R({ integer: true, groups: [{ id: 'a', label: 'x', goal, actual: Math.round(goal / 3) }, { id: 'b', label: 'y', goal: 1, actual: 2 }] }, 500);
    const ticks = attrs(html, /class="ai-chart-axis-label"[^>]*>([^<]*)</g).map(Number);
    assert.ok(ticks.length >= 2 && ticks.length <= 5, goal + ' ticks ' + ticks.length);
    assert.ok(ticks.every(Number.isInteger), 'integer ticks');
    assert.ok(ticks[ticks.length - 1] >= goal);
    assert.equal(Number(/data-gc-scale-max="([^"]+)"/.exec(html)[1]), ticks[ticks.length - 1]);
  }
});
test('keyboard/touch: focusable pairs with full summary', () => {
  const html = R({ unit: 'h', groups: [{ id: 'a', label: 'Run', goal: 4, actual: 2, expected: 3, status: 'behind' }] }, 500);
  assert.match(html, /<g class="gc-group" role="img" tabindex="0" aria-label="Run — Goal: 4 h\. Run — Actual: 2 h\. Run — Expected by today: 3 h\. Behind" data-gc-tip=/);
  assert.match(html, /<svg class="ai-chart-svg gc-svg" role="group"/);
});
