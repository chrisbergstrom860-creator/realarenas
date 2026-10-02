// Seed-free unit tests for the athletes geometry helper + shared card render.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { athletesFixtures, athletesGeometryExpr, ATHLETES_SELECTORS } from './lib/athletes-geometry.mjs';

const require = createRequire(import.meta.url);
const { SPORTS } = require('../sports.js');
const registry = SPORTS.map(s => s.id);

function loadCards() {
  const byId = Object.fromEntries(SPORTS.map(s => [s.id, s]));
  const ctx = vm.createContext({ window: { ARENAS_SPORTS: SPORTS, ARENAS_SPORTS_BY_ID: byId,
    avatarHtml: (u, n, c) => `<div class="${c}"></div>` }, document: { addEventListener() {} } });
  vm.runInContext(readFileSync(new URL('../html/arenas-athlete-cards.js', import.meta.url), 'utf8'), ctx);
  return ctx.window.ArenasAthleteCards;
}

test('fixtures cover 0/1/3/5+ registry sports, legacy exclusion and banner states', () => {
  const { athletes, athletesTotal } = athletesFixtures({ registry });
  assert.equal(athletes.length, 13); assert.equal(athletesTotal, 13);
  const counts = athletes.map(a => a.sportsCount);
  for (const n of [0, 1, 3]) assert.ok(counts.includes(n));
  assert.ok(counts.some(n => n >= 5));
  assert.ok(athletes.every(a => a.sportsRegistry.every(s => registry.includes(s))));
  assert.equal(athletes[4].sportsCount, 1, 'duplicate + legacy snowboarding excluded');
  assert.equal(athletesFixtures({ registry, total: 71 }).athletesTotal, 71);
});

test('grid card has a banner strip; list row has none; chips cap at 3 + "+N"', () => {
  const C = loadCards();
  const [a] = athletesFixtures({ registry }).athletes;
  const grid = C.cardHTML(a, 0, 0, false, 'grid');
  const list = C.cardHTML(a, 0, 0, false, 'list');
  assert.match(grid, /class="adc-banner"/); assert.match(grid, /loading="lazy"/); assert.match(grid, /width="640" height="160"/);
  assert.doesNotMatch(list, /adc-banner/);
  assert.equal((grid.match(/class="adc-pill"/g) || []).length, 3);
  assert.match(grid, /adc-pill-more">\+3</);
  assert.doesNotMatch(grid, /·/, 'location line no longer lists sports');
});

test('available sports are registry sports declared among listed athletes, registry order', () => {
  const C = loadCards();
  const ids = C.availableSports(athletesFixtures({ registry }).athletes).map(s => s.id);
  assert.deepEqual(ids, registry.filter(id => ids.includes(id)));
  assert.ok(!ids.includes('snowboarding') && !ids.includes('padel'));
});

test('Following + empty search says "No athletes match your search"; total note survives', () => {
  const C = loadCards();
  const grid = { innerHTML: '', className: '', addEventListener() {} }, count = {};
  const athletes = athletesFixtures({ registry }).athletes;
  const inst = C.mount({ athletes, total: 71, gridEl: grid, countEl: count,
    getFilters: () => ({ show: 'following', query: 'zzzz', sport: 'all', view: 'list' }) });
  inst.render();
  assert.match(grid.innerHTML, /No athletes match your search/);
  assert.equal(count.textContent, 'Showing 0 of 71 — refine with search');
});

test('geometry expression serializes and selectors expose page handlers', () => {
  assert.doesNotThrow(() => new vm.Script(athletesGeometryExpr({ view: 'list' })));
  assert.deepEqual(ATHLETES_SELECTORS.handlers, ['setView', 'setShow', 'handleSearch', 'setSort', 'setSport']);
});
