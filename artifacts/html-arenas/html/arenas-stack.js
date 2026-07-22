// Shared "Weekly activity" stacked-column builder for the Stats & PRs tab
// (and its visual harness). Each week's column is segmented by sport (hours
// per sport per week), colored from the sports registry — the same hexes the
// By-sport bars and pie use, one color system.
//
// Honesty rules carried over from the flat bars:
// - The total-hours value label on top labels the whole stack (unchanged).
// - Zero weeks keep the flat gray baseline tick, no fake column.
// - Segments render at their true proportion, however thin — no minimum
//   height inflation. Server-side largest-remainder tenths guarantee the
//   segments sum exactly to the labeled total.
//
// Includes a compact legend (swatch + emoji + name) of only the sports that
// actually appear in the visible range, ordered by total hours descending.
// Segment hover shows "Sport · Xh" via native title tooltips.
(function () {
  'use strict';

  // weekly: [{ label, hours, bySport: [{ sport, hours }] }] (dominant first)
  // colors: { sportId: { bar, icon, name } } from the sports registry
  // nWeeks: 6 | 12 | 24, narrow: viewport <= 480px
  window.buildWeeklyStack = function (weekly, colors, nWeeks, narrow) {
    var esc = function (t) {
      return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };
    var fallback = { bar: '#6B7280', icon: '🏅', name: '' };
    var maxH = Math.max.apply(null, weekly.map(function (w) { return w.hours; }).concat([0.5]));
    // Label thinning + bar sizing — identical to the historic flat chart.
    var labelEvery = nWeeks === 24 ? (narrow ? 4 : 2) : nWeeks === 12 ? (narrow ? 2 : 1) : 1;
    var barMaxW = nWeeks === 6 ? '64px' : nWeeks === 12 ? '40px' : '26px';

    var bars = weekly.map(function (w, i) {
      var isLast = i === weekly.length - 1;
      var stepsBack = weekly.length - 1 - i;
      var onGrid = isLast || stepsBack % labelEvery === 0;
      var bar;
      if (w.hours > 0) {
        // Stack bottom-up: dominant sport at the base (server sends dominant
        // first; a column lays out top-down, so reverse). flex-basis % of the
        // column height = true share of the week's total.
        var segs = (w.bySport || []).slice().reverse().map(function (s) {
          var c = colors[s.sport] || fallback;
          return '<div title="' + esc(c.name || s.sport) + ' · ' + s.hours + 'h" style="flex:0 0 ' + ((s.hours / w.hours) * 100).toFixed(3) + '%;background:' + c.bar + '"></div>';
        }).join('');
        if (!segs) segs = '<div style="flex:1;background:#FFD21E"></div>';
        bar = '<div style="width:100%;max-width:' + barMaxW + ';height:' + Math.max(4, Math.round((w.hours / maxH) * 78)) + '%;border-radius:3px 3px 0 0;overflow:hidden;display:flex;flex-direction:column">' + segs + '</div>';
      } else {
        // Zero week: honest flat baseline tick, never a fake column.
        bar = '<div style="width:100%;max-width:' + barMaxW + ';height:3px;border-radius:1px;background:var(--gray-200)"></div>';
      }
      return '' +
        '<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;justify-content:flex-end">' +
          (w.hours > 0 && onGrid ? '<div style="font-size:9px;font-family:var(--mono);font-weight:600;white-space:nowrap;color:' + (isLast ? 'var(--gray-900)' : 'var(--gray-500)') + '">' + w.hours + 'h</div>' : '') +
          bar +
          '<div style="font-size:8px;height:10px;line-height:10px;white-space:nowrap;color:' + (isLast ? 'var(--gray-600)' : 'var(--gray-400)') + ';font-weight:' + (isLast ? '600' : '400') + '">' + (onGrid ? (isLast ? 'Now' : esc(w.label)) : '') + '</div>' +
        '</div>';
    }).join('');

    // Legend: only the sports present in the visible range, by hours desc.
    var totals = {};
    var order = [];
    weekly.forEach(function (w) {
      (w.bySport || []).forEach(function (s) {
        if (!(s.sport in totals)) { totals[s.sport] = 0; order.push(s.sport); }
        totals[s.sport] += s.hours;
      });
    });
    order.sort(function (a, b) { return totals[b] - totals[a]; });
    var legend = order.map(function (id) {
      var c = colors[id] || fallback;
      // Readable legend scale (matches the pie legend): 14px swatch, 12px
      // label — small enough to stay compact, big enough to match colors to
      // segments at a glance.
      return '<div style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--gray-600)">' +
        '<span style="width:14px;height:14px;border-radius:3px;background:' + c.bar + ';flex-shrink:0"></span>' +
        c.icon + ' ' + esc(c.name || id) + '</div>';
    }).join('');

    return '<div style="display:flex;align-items:flex-end;gap:' + (nWeeks === 24 ? '3px' : '5px') + ';height:170px;padding:12px 14px 8px">' + bars + '</div>' +
      (legend ? '<div style="display:flex;flex-wrap:wrap;gap:8px 18px;padding:0 14px 12px;border-top:var(--border);padding-top:10px">' + legend + '</div>' : '');
  };
})();
