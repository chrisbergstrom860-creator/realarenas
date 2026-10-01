const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SPORTS } = require('./sports');

function renderer() {
  const calls = { links: [], times: [] };
  const window = {
    ARENAS_SPORTS_BY_ID: Object.fromEntries(SPORTS.map(s => [s.id, s])),
    athleteLinkAttrs(id, reachable) {
      calls.links.push([id, reachable]);
      return reachable && id ? ' data-athlete-link="' + id + '"' : '';
    },
    avatarHtml: () => '<div class="test-avatar">AA</div>',
    arenasTimeAgo(ts) { calls.times.push(ts); return '3d ago'; }
  };
  const context = vm.createContext({ window });
  for (const file of ['arenas-stat-tiles.js', 'arenas-activity-card.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'html', file), 'utf8'), context);
  }
  return { window, calls };
}

const activity = {
  id: 'activity-1', user_id: 'athlete-1', sport: 'running',
  author: { name: 'Alex & Jordan', profilePublic: true }, title: 'Coastal <run>',
  notes: 'Felt <strong> & steady', feeling: 'strong',
  duration: '1:02:15', distance: '12.4 km', pace: '5:01/km',
  created_at: '2026-09-26T08:00:00Z', date: '2026-09-20T12:00:00Z',
  likeCount: 7, likedByMe: true
};

test('full feed renderer preserves header, body order, timestamp and kudos action', () => {
  const { window, calls } = renderer();
  const html = window.activityCardHtml(activity, { preview: false });
  assert.ok(html.startsWith('<div class="post-note-card" style="padding:16px 18px">'));
  assert.equal((html.match(/data-athlete-link/g) || []).length, 2);
  assert.deepEqual(calls.links, [['athlete-1', true]]);
  assert.deepEqual(calls.times, [activity.created_at]);
  assert.match(html, /Alex &amp; Jordan/);
  assert.match(html, /class="pn-action liked" onclick="likeActivity\(this,'activity-1'\)">👍 7 kudos/);
  const order = ['ac-title', 'ac-stats-row', 'ac-notes-box', 'ac-feeling', 'pn-footer'];
  for (let i = 1; i < order.length; i++) assert.ok(html.indexOf(order[i - 1]) < html.indexOf(order[i]));
});

test('preview has Just now · Sport, no links or footer, and no link/time helper calls', () => {
  const { window, calls } = renderer();
  // Preview remains usable without the feed-only athlete-link/time helpers.
  delete window.athleteLinkAttrs;
  delete window.arenasTimeAgo;
  const html = window.activityCardHtml(activity, { preview: true });
  assert.match(html, /Just now · Running/);
  assert.doesNotMatch(html, /data-athlete-link|role="link"|tabindex=|<a\b|pn-footer|pn-action|likeActivity|kudos/);
  assert.match(html, /Alex &amp; Jordan/);
  assert.match(html, /Feeling: Strong/);
  assert.match(html, /12.4 km/);
  assert.deepEqual(calls, { links: [], times: [] });
});

test('default options retain feed mode and missing created_at uses date', () => {
  const { window, calls } = renderer();
  const html = window.activityCardHtml({ date: activity.date });
  assert.match(html, />Athlete<\/span>/);
  assert.match(html, /👍 0 kudos/);
  assert.deepEqual(calls.times, [activity.date]);
  assert.doesNotMatch(html, /ac-title|ac-stats-row|ac-notes-box|ac-feeling/);
});

test('preview metadata and sport pill are registry-driven for all 14 sports', () => {
  const { window } = renderer();
  assert.equal(SPORTS.length, 14);
  for (const sport of SPORTS) {
    const html = window.activityCardHtml({ sport: sport.id }, { preview: true });
    assert.ok(html.includes('Just now · ' + sport.label));
    assert.ok(html.includes(sport.colors.bg));
    assert.ok(html.includes(sport.emoji));
  }
});

test('unknown or missing sport stays neutral and metadata is escaped', () => {
  const { window } = renderer();
  const html = window.activityCardHtml({ sport: '<img src=x onerror=alert(1)>' }, { preview: true });
  assert.match(html, /Just now · &lt;img/);
  assert.match(html, /background:var\(--gray-100\)/);
  assert.doesNotMatch(html, /<img/);
  const empty = window.activityCardHtml({}, { preview: true });
  assert.match(empty, />Just now<\/div>/);
  assert.doesNotMatch(empty, /Just now ·/);
});

test('short and long notes retain escaping, clamp threshold and expansion action', () => {
  const { window } = renderer();
  const short = window.activityCardHtml(activity, { preview: true });
  assert.match(short, /Felt &lt;strong&gt; &amp; steady/);
  assert.doesNotMatch(short, /fa-notes-toggle| clamped/);
  for (const notes of ['x'.repeat(221), 'a\nb\nc\nd\ne']) {
    const long = window.activityCardHtml({ notes }, { preview: true });
    assert.match(long, /class="fa-notes clamped"/);
    assert.match(long, /onclick="toggleActivityNotes\(this\)">Show more/);
  }
  assert.doesNotMatch(window.activityCardHtml({ notes: '  \n' }), /ac-notes-box/);
});

test('feeling allowlist and legacy-insight suppression are unchanged', () => {
  const { window } = renderer();
  const html = window.activityCardHtml({ feeling: '<img>', ai_insight: 'Fabricated coach voice' }, { preview: true });
  assert.doesNotMatch(html, /ac-feeling|Fabricated coach voice/);
});

test('CommonJS feeling-label export is preserved', () => {
  const exported = require('./html/arenas-activity-card.js');
  assert.equal(exported.ACTIVITY_FEELING_LABELS.strong, 'Strong');
  assert.ok(Object.isFrozen(exported.ACTIVITY_FEELING_LABELS));
});