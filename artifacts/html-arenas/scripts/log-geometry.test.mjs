import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { logGeometryExpr } from './lib/log-geometry.mjs';

function probe({
  width = 1280, expanded = false, sideLeft, sideTop, textRight,
  controlRight, clamp = false, unexpectedClip = false, overlap = false,
  hiddenText = false, stale = false, scrollWidth = width, missingToggle = false,
  wrongTracks = false
} = {}, options = {}) {
  const desktop = width > 1024;
  const box = (left, right, top = 100, bottom = 500) => ({
    left, right, top, bottom, width: right - left, height: bottom - top
  });
  const element = (r, parentElement = null, props = {}) => ({
    getClientRects: () => [r], getBoundingClientRect: () => r,
    parentElement, id: '', tagName: 'DIV', textContent: '',
    style: { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' },
    matches: () => false, closest: () => null, querySelector: () => null, querySelectorAll: () => [],
    ...props
  });
  const form = element(box(14, desktop ? 800 : width - 14));
  const main = element(box(0, width));
  main.style.gridTemplateColumns = wrongTracks ? '800px' : desktop ? '786px 340px' : `${width - 28}px`;
  const side = element(box(sideLeft ?? (desktop ? 850 : 14), desktop ? 1190 : width - 14,
    sideTop ?? (desktop ? 100 : 520), desktop ? 500 : 920));
  const preview = element(rectFor(side), side);
  preview.style.display = desktop || expanded ? 'block' : 'none';
  const toggle = element(box(14, width - 14, 520, 560), side, {
    getAttribute: () => String(expanded)
  });
  toggle.style.display = desktop ? 'none' : 'block';
  const title = { value: 'Long unbroken running title' };
  const notes = { value: 'N'.repeat(500) };
  const cardTitle = element(box(860, 1180, 110, 130), preview, {
    textContent: stale ? 'Stale title' : title.value
  });
  const cardNotes = element(box(desktop ? 860 : 24, desktop ? 1180 : width - 24,
    desktop ? 140 : 580, desktop ? 170 : 610), preview, { textContent: notes.value });
  if (clamp || unexpectedClip) {
    cardNotes.style.overflowY = 'hidden';
    cardNotes.style.webkitLineClamp = clamp ? '3' : 'none';
    cardNotes.matches = selector => clamp && selector === '.fa-notes.clamped';
  }
  preview.querySelector = selector => ({ '.ac-title': cardTitle, '.fa-notes': cardNotes })[selector];
  const control = element(box(24, controlRight ?? (desktop ? 180 : 160), 150, 180), form, { id: 'future-duration-control' });
  form.querySelectorAll = () => [control];
  const label = element(box(24, desktop ? 400 : width - 24, 200, 230), form);
  if (hiddenText) label.style.opacity = '0';
  const labelNode = { textContent: 'Visible form label', parentElement: label };
  const other = element(box(24, desktop ? 400 : width - 24, 240, 270), form);
  const otherNode = { textContent: 'Second form label', parentElement: other };
  const noteNode = { textContent: notes.value, parentElement: cardNotes };
  const ranges = new Map([
    [labelNode, [box(24, textRight ?? 150, 200, 215)]],
    [otherNode, [box(24, 150, overlap ? 200 : 240, overlap ? 215 : 255)]],
    [noteNode, [box(desktop ? 860 : 24, desktop ? 1100 : width - 24,
      desktop ? 140 : 580, desktop ? 240 : 680)]]
  ]);
  const document = {
    documentElement: { scrollWidth },
    querySelector: selector => ({
      '.main': main, '#log-form': form, '#log-side': side, '#log-preview': preview,
      '#log-preview-toggle': missingToggle ? null : toggle,
      '#act-sport-chips [data-sport="running"].selected': {},
      '#act-sport-fields-body': label, '#act-title': title, '#act-notes': notes
    })[selector],
    createTreeWalker: surface => {
      const nodes = surface === form ? [labelNode, otherNode] : clamp || unexpectedClip ? [noteNode] : [];
      let index = 0;
      return { currentNode: null, nextNode() { this.currentNode = nodes[index++]; return !!this.currentNode; } };
    },
    createRange: () => {
      let node;
      return { selectNodeContents(value) { node = value; }, getClientRects: () => ranges.get(node) };
    }
  };
  return vm.runInNewContext(logGeometryExpr(options), {
    document, innerWidth: width, getComputedStyle: el => el.style,
    NodeFilter: { SHOW_TEXT: 4 }
  });
}

function rectFor(el) { return el.getBoundingClientRect(); }

test('selected-running readiness targets visible controls while mobile preview is collapsed', () => {
  const guard = readFileSync(new URL('./verify-mobile-geometry.js', import.meta.url), 'utf8');
  const state = guard.slice(guard.indexOf("name: 'selected-running'"), guard.indexOf("name: 'long-text-expanded-preview'"));
  assert.match(state, /waitFor: '#act-sport-fields-body #sf-distance'/);
  assert.doesNotMatch(state, /waitFor: '#log-preview/);
});

for (const width of [360, 380, 414, 1280, 1440, 1920]) {
  test(`log columns and expanded long-text preview at ${width}px`, () => {
    const result = probe({ width, expanded: true, clamp: true }, { populated: true, expanded: true, longText: true });
    assert.equal(result.ok, true, result.failures.join('\n'));
    assert.ok(result.controls > 0);
    assert.ok(result.paintedRuns > 0);
    assert.ok(result.intentionalClamps > 0);
  });
}
test('desktop column overlap is rejected', () => {
  assert.match(probe({ sideLeft: 700 }).failures.join(), /desktop columns overlap/);
  assert.match(probe({ wrongTracks: true }).failures.join(), /responsive grid columns/);
});
test('mobile side must follow the form rather than overlay it', () => {
  assert.match(probe({ width: 360, sideTop: 400 }).failures.join(), /not below/);
});
test('collapsed mobile preview stays hidden; expanded state is explicit', () => {
  assert.equal(probe({ width: 360 }).ok, true);
  assert.match(probe({ width: 360 }, { expanded: true }).failures.join(), /preview visibility|aria-expanded/);
});
test('unclipped text overflow fails even when element boxes are contained', () => {
  assert.match(probe({ textRight: 600 }).failures.join(), /painted text escapes text container/);
});
test('painted text overlap is rejected independently of element boxes', () => {
  assert.match(probe({ overlap: true }).failures.join(), /painted text overlaps/);
});
test('intentional notes clamp passes but arbitrary hidden notes clipping fails', () => {
  assert.equal(probe({ clamp: true }).ok, true);
  assert.match(probe({ unexpectedClip: true }).failures.join(), /unexpected vertical text clipping/);
});
test('hidden text does not create phantom painted overflow', () => {
  assert.equal(probe({ hiddenText: true, textRight: 1300 }).ok, true);
});
test('generic visible controls include future duration inputs', () => {
  assert.match(probe({ controlRight: 900 }).failures.join(), /visible control escapes/);
});
test('missing toggle, stale preview and page-level overflow cannot pass', () => {
  assert.match(probe({ missingToggle: true }).failures.join(), /preview hooks missing/);
  assert.match(probe({ stale: true }, { populated: true }).failures.join(), /preview title missing or stale/);
  assert.match(probe({ scrollWidth: 1500 }).failures.join(), /horizontal overflow/);
});