import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { calendarGeometryExpr } from './lib/calendar-geometry.mjs';

function probe({ width = 1280, panelLeft = 850, panelBottom = 1000, tileRows = true, textRight = 200, clipped = false } = {}, options = {}) {
  const box = (left, right, top = 0, bottom = 1000) => ({ left, right, top, bottom, width: right - left, height: bottom - top });
  const element = r => ({
    getClientRects: () => [r], getBoundingClientRect: () => r,
    style: { visibility: 'visible', overflowX: 'visible' }, querySelector: () => null
  });
  const root = element(box(0, 800));
  const modal = element(box(panelLeft, panelLeft + (width > 1024 ? 360 : width), 200, panelBottom));
  const pane = element(box(0, width));
  pane.querySelector = () => modal;
  pane.textContent = 'Nothing on this day';
  const cell = element(box(0, 200));
  const pill = element(box(0, 200));
  pill.closest = () => cell;
  pill.parentElement = cell;
  pill.style.overflowX = clipped ? 'hidden' : 'visible';
  const text = { textContent: 'unbroken-long-title', parentElement: pill };
  const tiles = Array.from({ length: 5 }, (_, i) => element(box(0, 100, tileRows ? Math.floor(i / 3) * 80 : 0, 80)));
  const document = {
    querySelector: selector => ({ '#cal-root': root, '#day-panel': pane })[selector],
    querySelectorAll: selector => selector.includes('cal-stats') ? tiles : selector === '.cp' ? [pill] : [],
    createTreeWalker: () => {
      let visited = false;
      return { currentNode: text, nextNode() { if (visited) return false; visited = true; return true; } };
    },
    createRange: () => ({ selectNodeContents() {}, getClientRects: () => [box(0, textRight)] })
  };
  return vm.runInNewContext(calendarGeometryExpr(options), {
    document, innerWidth: width, innerHeight: 1000,
    getComputedStyle: el => el.style, NodeFilter: { SHOW_TEXT: 4 }
  });
}
test('docked geometry detects grid/panel overlap', () => {
  assert.equal(probe({}, { panel: true }).ok, true);
  assert.equal(probe({ panelLeft: 700 }, { panel: true }).ok, false);
});
test('mobile panel must reach viewport bottom', () => {
  assert.equal(probe({ width: 360, panelLeft: 0 }, { panel: true }).ok, true);
  assert.equal(probe({ width: 360, panelLeft: 0, panelBottom: 900 }, { panel: true }).ok, false);
});
test('stats must wrap at 360', () => {
  assert.equal(probe({ width: 360 }, { stats: true }).ok, true);
  assert.equal(probe({ width: 360, tileRows: false }, { stats: true }).ok, false);
});
test('unclipped painted text escape fails despite contained element boxes', () => {
  const result = probe({ textRight: 350 });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(), /painted text escapes/);
});
test('intentional clipped ellipsis is not painted overflow', () => {
  assert.equal(probe({ textRight: 350, clipped: true }).ok, true);
});