// Browser-only assertions shared by the seeded guard and seed-free harness.
// No network, persistence, or app state mutation occurs in these probes.
export function calendarGeometry({ panel = false, empty = false, stats = false, month = false } = {}) {
  const failures = [];
  const visible = el => !!el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const rect = el => el.getBoundingClientRect();
  const inside = (a, b) => a.left >= b.left - 1.5 && a.right <= b.right + 1.5;
  const root = document.querySelector('#cal-root');
  const pane = document.querySelector('#day-panel');
  if (document.documentElement && document.documentElement.scrollWidth > innerWidth + 1.5)
    failures.push('page-level horizontal overflow');
  if (!visible(root)) failures.push('calendar root missing');
  if (panel) {
    if (!visible(pane)) failures.push('selected-day panel missing');
    else {
      const surface = pane.querySelector('#dp-sheet') || pane.firstElementChild || pane;
      const p = rect(surface), g = rect(root);
      if (innerWidth > 1024) {
        if (p.left < g.right - 1.5) failures.push('docked panel overlaps calendar');
        if (p.width < 280 || p.width > 410) failures.push('docked panel not ~360px');
      } else {
        if (p.left < -1.5 || p.right > innerWidth + 1.5 || Math.abs(p.bottom - innerHeight) > 2)
          failures.push('mobile panel is not a viewport-contained bottom sheet');
      }
      if (empty && !pane.textContent.includes('Nothing on this day')) failures.push('empty-day copy missing');
      if (!empty && !pane.querySelector('.dp-card')) failures.push('populated panel has no cards');
    }
  }
  if (stats) {
    const tiles = [...document.querySelectorAll('#cal-stats > *, .cal-stats > *')];
    if (tiles.length !== 5) failures.push(`expected five stats tiles, got ${tiles.length}`);
    if (innerWidth === 360 && new Set(tiles.map(el => Math.round(rect(el).top))).size < 2)
      failures.push('stats do not wrap at 360px');
    if (tiles.some(el => rect(el).right > innerWidth + 1.5 || rect(el).left < -1.5))
      failures.push('stats escape viewport');
    for (const tile of tiles) {
      for (const el of tile.querySelectorAll ? tile.querySelectorAll('.cs-val, .cs-sub') : []) {
        if (!inside(rect(el), rect(tile))) failures.push('stats content escapes tile');
      }
    }
  }
  const pills = [...document.querySelectorAll('.cp')].filter(visible);
  if (month && innerWidth > 1024 && !pills.length) failures.push('desktop month has no visible pills');
  let textRuns = 0;
  for (const item of [...pills, ...document.querySelectorAll('.dp-card')].filter(visible)) {
    const cell = item.closest('.cal-day, .ag-day') || item;
    if (!inside(rect(item), rect(cell))) failures.push('pill box escapes calendar cell');
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || !visible(node.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        textRuns++;
        // Range rectangles include text deliberately hidden by ellipsis.
        // Intersect actual clipping ancestors to test *painted* text, not
        // invisible glyphs; unbroken unclipped text must still fail.
        let left = r.left, right = r.right;
        for (let el = node.parentElement; el && el !== cell; el = el.parentElement) {
          if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(el).overflowX)) {
            const clip = rect(el); left = Math.max(left, clip.left); right = Math.min(right, clip.right);
          }
        }
        if (right > left && !inside({ left, right }, rect(cell)))
          failures.push(`painted text escapes cell: ${node.textContent.slice(0, 70)}`);
      }
    }
  }
  return { ok: !failures.length, failures, pills: pills.length, textRuns };
}

export const calendarGeometryExpr = options => `(${calendarGeometry.toString()})(${JSON.stringify(options)})`;