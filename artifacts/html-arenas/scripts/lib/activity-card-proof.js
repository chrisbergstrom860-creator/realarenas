// Isolated browser fixture: real feed shell, CSS, collectors and shared helpers.
// No server, database, authentication, seeds or external requests.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { SPORTS: fixtureSports } = createRequire(import.meta.url)('../../sports.js');
export const widths = [360, 414, 1280];
export const proofDirectory = '/tmp/activity-card-extraction-proof';
export const baselineRef = '82a1d19297cc7d8a77b2a9dd5441312b6506a11c';

export function sources(ref) {
  const read = (file) => ref
    ? execFileSync('git', ['show', `${ref}:artifacts/html-arenas/${file}`], {
      cwd: ROOT, encoding: 'utf8'
    })
    : fs.readFileSync(path.join(ROOT, file), 'utf8');
  const { SPORTS, SPORT_ICONS, LEGACY_SPORT_EMOJI } = vm.runInNewContext(
    read('sports.js') + '\nmodule.exports', { module: { exports: {} } });
  const server = read('server.js');
  const avatar = server.match(/const AVATAR_HELPERS_SCRIPT = (`[\s\S]*?`);/);
  if (!avatar) throw new Error('Real avatar helper injection not found');
  const navStart = server.indexOf('function bnItem(');
  const navEnd = server.indexOf('const ATHLETE_NAV_ACTIVE', navStart);
  if (navStart < 0 || navEnd < 0) throw new Error('Real athlete navigation not found');
  const nav = vm.runInNewContext(server.slice(navStart, navEnd) + '\nathleteBottomNav("feed")');
  return {
    feed: read('html/arenas-feed.html'),
    css: read('html/arenas.css'),
    card: read('html/arenas-activity-card.js'),
    tiles: read('html/arenas-stat-tiles.js'),
    links: read('html/arenas-athlete-link.js'),
    time: read('html/arenas-time.js'),
    avatar: vm.runInNewContext(avatar[1], { SPORTS, SPORT_ICONS, LEGACY_SPORT_EMOJI }),
    nav: nav.replace('class="bottom-nav"', 'class="bottom-nav bn-has-fab"') +
      '<a class="bn-fab" aria-label="Log activity" onclick="nav(\'/log\')">➕</a>',
    icon: read('html/arenas-icon.svg'),
    sports: SPORTS
  };
}

// Broad body/header/footer states, including absent author and unknown sport.
export const activities = [
  { id: 'run', user_id: 'athlete-1', sport: 'running',
    author: { name: 'Alex & Jordan', profilePublic: true }, title: 'Morning coastal run',
    duration: '1:02:15', distance: '12.4 km', pace: '5:01/km', avg_hr: '145',
    elevation: '180 m', notes: 'An easy start.\nFinished strong.', feeling: 'strong',
    created_at: '2026-09-26T08:00:00Z', likeCount: 7, likedByMe: true },
  { id: 'swim', user_id: 'athlete-2', sport: 'swimming',
    author: { name: 'Sam Private', profilePublic: false }, title: '<script>alert("xss")</script>',
    duration: '40:00', distance: '2,000m', pace: '2:00/100m',
    notes: ('Long athlete-written notes <>&"\' with a newline.\n').repeat(12).slice(0, 500),
    feeling: 'easy', created_at: '2026-09-25T08:00:00Z', likeCount: 0 },
  { id: 'empty', sport: 'unknown', date: '2026-09-24T12:00:00Z', feeling: 'invalid' },
  ...fixtureSports.filter(s => !['running', 'swimming'].includes(s.id)).map((s, i) => ({
    id: 'sport-' + s.id, sport: s.id, user_id: 'athlete-3',
    author: { name: s.label + ' Athlete', profilePublic: true },
    title: s.label + ' session', duration: '45:00', notes: '', feeling: 'tired',
    created_at: '2026-09-23T08:00:00Z', likeCount: i
  }))
];

export function collectorScript(feed) {
  const start = feed.indexOf('function escFeedAct(');
  const end = feed.indexOf('// "X is going to <event>"', start);
  if (start < 0 || end < 0) throw new Error('Activity collector boundaries not found');
  return feed.slice(start, end);
}

export async function setProofPage(page, source, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/html/arenas-icon.svg') {
      return route.fulfill({ contentType: 'image/svg+xml', body: source.icon });
    }
    return route.abort();
  });
  // The actual shell is retained. Remove unrelated initialization, remote font
  // and asset loaders; apply the real shared stylesheet inline. This proof is
  // explicitly offline/fallback-font, consistently in both renditions.
  let html = source.feed.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');
  html = html.replace('</head>', '<style>' + source.css + '</style></head>')
    .replace('</body>', source.nav + '</body>');
  await page.setContent(html);
  await page.evaluate(({ sports, fixtures }) => {
    Date.now = () => Date.parse('2026-09-29T08:00:00Z');
    window.BASE = '/html';
    window.ARENAS_SPORTS_BY_ID = Object.fromEntries(sports.map(s => [s.id, s]));
    window.ARENAS_DATA = { userId: 'viewer', feedActivities: fixtures };
  }, { sports: source.sports, fixtures: activities });
  await page.addScriptTag({ content: source.avatar.replace(/^<script[^>]*>|<\/script>$/g, '') });
  for (const script of [source.links, source.time, source.tiles, source.card, collectorScript(source.feed)]) {
    await page.addScriptTag({ content: script });
  }
  await page.evaluate(() => {
    const host = document.getElementById('feed-items');
    host.replaceChildren();
    const items = collectActivityItems();
    items.sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    for (const item of items) host.appendChild(item.el);
    window.__proofItems = items.map(({ ts, id, el }) => ({ ts, id, type: el.dataset.type }));
  });
  await page.waitForTimeout(650);
}

export async function capture(page, source, width, label, expanded = false) {
  await setProofPage(page, source, width);
  if (expanded) await page.locator('.fa-notes-toggle').click();
  const result = await page.evaluate(() => ({
    html: document.getElementById('feed-items').innerHTML,
    tree: [...document.querySelectorAll('#feed-items *')].map(el => [el.tagName, el.className]),
    metadata: window.__proofItems,
    overflow: document.documentElement.scrollWidth - innerWidth
  }));
  const png = path.join(proofDirectory, `${label}-${expanded ? 'expanded' : 'collapsed'}-${width}.png`);
  await page.screenshot({ path: png, fullPage: true });
  return { ...result, png };
}