// Seed-free athletes directory geometry helper (companion to
// scripts/verify-mobile-geometry.js, which main owns). Exports:
//   ATHLETES_SELECTORS   stable hooks for the page + shared component
//   athletesFixtures()   synthetic directory payload (no real users, no DB)
//   athletesGeometry()   browser-only probe; serialize via athletesGeometryExpr
// Pure: no server, credentials, cookies or network writes.

export const ATHLETES_SELECTORS = {
  hero: '.athletes-hero',
  heroImage: '.athletes-hero-bg',
  toolbar: '#athletes-toolbar',
  showAll: '[data-show="all"]',
  showFollowing: '[data-show="following"]',
  search: '#search-input',
  count: '#athlete-count',
  sort: '#athlete-sort',
  viewGrid: '#vt-grid',
  viewList: '#vt-list',
  sportChips: '#athlete-sport-chips',
  sportChip: id => `#athlete-sport-chips [data-sport="${id}"]`,
  grid: '#athlete-grid',
  card: '#athlete-grid .adc-card',
  banner: '#athlete-grid .adc-banner',
  bannerImg: '#athlete-grid .adc-banner-img',
  followBtn: '#athlete-grid .adc-follow-btn',
  // Page globals (inline handlers): setView('grid'|'list'), setShow(el,'all'|'following'),
  // handleSearch(text), setSort(value), setSport('all'|registryId).
  handlers: ['setView', 'setShow', 'handleSearch', 'setSort', 'setSport']
};

const NAMES = [
  ['Maren Okafor-Lindqvist', 'Bergen'], ['Tomás Ferreira', 'Porto'], ['Aiyana Redcloud', 'Boulder'],
  ['Keoni Kahananui', 'Hilo'], ['Priya Ramaswamy', 'Pune'], ['Lukas Brandstätter', 'Innsbruck'],
  ['Sade Adeyemi', 'Lagos'], ['Hiro Tanabe', 'Sapporo'], ['Ines Carvalho', 'Lisbon'],
  ['Dmitri Volkov', 'Tbilisi'], ['Grace Mwangi', 'Nairobi'], ['Oskar Nyberg', 'Umeå'],
  ['Valentina Ríos', 'Medellín']
];
const SPORTS_SETS = [
  ['running', 'cycling', 'swimming', 'hiking', 'yoga', 'climbing'], // 6 → 3 chips + "+3"
  ['cycling'], ['climbing', 'hiking', 'running'], [], ['swimming', 'snowboarding', 'swimming'], // dup + legacy
  ['running', 'yoga', 'pilates', 'tennis', 'golf'], ['basketball'], ['hiking', 'running'],
  ['tennis', 'pickleball', 'padel'], ['weightlifting', 'Strength'], ['running'], ['hockey', 'football'], ['yoga']
];

// registry: array of registry ids (from sports.js). Banner variants:
// 'ok' (served by harness), 'missing' (404 → gradient fallback), null.
export function athletesFixtures({ registry, bannerUrl = '/html/__fixture/banner-card.webp', total } = {}) {
  const known = new Set(registry || []);
  const athletes = NAMES.map(([name, city], i) => {
    const sports = SPORTS_SETS[i];
    const sportsRegistry = [...new Set(sports.filter(s => known.has(s)))];
    const banner = i % 4 === 0 ? 'ok' : i % 4 === 1 ? 'missing' : null;
    return {
      id: `fixture-${String(i + 1).padStart(2, '0')}`,
      name: i === 0 ? 'Maren Okafor-Lindqvist Featherstonehaugh-Vanderbilt' : name,
      avatar_url: null, bio: i === 2 ? 'Trail runs before work, bouldering after.' : '',
      location: i === 0 ? 'Bergen, Vestland — Fjordside Training Collective, Western Norway' : (i === 3 ? '' : city),
      countryName: '', stateName: '', state: '',
      sports, sportsRegistry, sportsCount: sportsRegistry.length,
      banner_url: banner === 'ok' ? bannerUrl : banner === 'missing' ? '/html/__fixture/missing-banner.webp' : null,
      banner_card_url: banner === 'ok' ? bannerUrl : banner === 'missing' ? '/html/__fixture/missing-card.webp' : null,
      initials: name.split(' ').map(w => w[0]).join('').slice(0, 2),
      createdAt: new Date(Date.UTC(2026, 0, 1 + i * 9)).toISOString(),
      postCount: [47, 3, 128, 0, 19, 64, 7, 22, 1, 35, 88, 11, 5][i],
      followerCount: [212, 9, 87, 0, 41, 133, 18, 56, 2, 73, 164, 27, 14][i],
      isFollowing: [1, 4, 7, 10].includes(i)
    };
  });
  return { athletes, athletesTotal: total == null ? athletes.length : total };
}

// Browser-only probe. view: 'grid'|'list'. Returns { failures, stats }.
export function athletesGeometry({ view = 'grid' } = {}) {
  const T = 1.5, failures = [];
  const r = el => el.getBoundingClientRect();
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const inside = (a, b) => a.left >= b.left - T && a.right <= b.right + T && a.top >= b.top - T && a.bottom <= b.bottom + T;
  if (document.documentElement.scrollWidth > innerWidth + T) failures.push('page-level horizontal overflow');
  const grid = document.querySelector('#athlete-grid');
  if (!grid) return { failures: ['#athlete-grid missing'], stats: {} };
  const cards = [...grid.querySelectorAll('.adc-card')];
  const banners = grid.querySelectorAll('.adc-banner').length;
  if (view === 'list' && banners) failures.push(`list view rendered ${banners} banner elements`);
  if (view === 'grid' && cards.length && banners !== cards.length) failures.push('grid card missing banner strip');
  const gr = r(grid);
  cards.forEach((card, i) => {
    const c = r(card);
    if (c.left < -T || c.right > innerWidth + T) failures.push(`card ${i} escapes viewport`);
    if (c.left < gr.left - T || c.right > gr.right + T) failures.push(`card ${i} escapes grid`);
    for (const sel of ['.adc-follow-btn', '.adc-name', '.adc-location', '.adc-av', '.adc-stats']) {
      const el = card.querySelector(sel);
      if (!visible(el)) { failures.push(`card ${i} ${sel} missing/hidden`); continue; }
      if (!inside(r(el), c)) failures.push(`card ${i} ${sel} not contained`);
    }
    card.querySelectorAll('.adc-pill').forEach(p => {
      if (visible(p) && !inside(r(p), c) && getComputedStyle(p.parentElement).overflow === 'visible')
        failures.push(`card ${i} chip not contained`);
    });
    const chips = card.querySelectorAll('.adc-pill:not(.adc-pill-more)').length;
    if (chips > 3) failures.push(`card ${i} shows ${chips} chips (max 3)`);
  });
  const tb = document.querySelector('#athletes-toolbar');
  if (tb) [...tb.querySelectorAll('.f-pill, select, input, .vt-btn')].filter(visible).forEach(el => {
    const b = r(el);
    if (el.closest('#athlete-sport-chips')) return; // horizontal scroller by design on mobile
    if (b.left < -T || b.right > innerWidth + T) failures.push(`toolbar control escapes viewport: ${el.id || el.textContent.trim()}`);
  });
  return { ok: failures.length === 0, failures, stats: { cards: cards.length, banners } };
}

export const athletesGeometryExpr = options => `(${athletesGeometry.toString()})(${JSON.stringify(options || {})})`;
