// Shared "Weekly activity" stacked-column builder for the Stats & PRs tab
// (and its visual harness). Each bucket's column is segmented by sport,
// colored from the sports registry — the same hexes the By-sport bars and
// donut use, one color system.
//
// Metric option (hours | km | sessions): the column height, segment shares,
// value labels, tooltips and legend ordering all follow the chosen metric.
// Server buckets carry { hours, km, sessions, bySport:[{sport,hours,km,
// sessions}] } with largest-remainder rounding, so segments always sum to the
// labelled total. Legacy buckets that only carry hours still render (metric
// falls back to hours data).
//
// Honesty rules:
// - The value label above a column labels the whole stack.
// - Zero buckets keep the flat gray baseline tick, no fake column.
// - Segments render at their true proportion — no minimum-height inflation.
// - The final bucket is labelled "This week"; when isPartial it is drawn at
//   reduced fill with a dashed outline (the week isn't over yet).
//
// Every non-zero bar carries its visible total — value labels are NEVER
// thinned. Instead each bar gets a minimum slot wide enough for its label;
// when n slots don't fit the container (dense 52/104-bar ranges, phones) the
// chart scrolls horizontally inside its own card (.wk-scroll) and the caller
// scrolls it to the end so "This week" is visible first. Only the axis DATE
// labels are thinned (every k-th, counted back from the final bucket).
(function () {
  'use strict';

  var esc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var FALLBACK = { bar: '#6B7280', icon: '🏅', name: '' };

  var METRICS = {
    hours: { key: 'hours', label: 'Hours', unit: 'h', fmt: function (v) { return round1(v) + 'h'; } },
    km: { key: 'km', label: 'Distance', unit: 'km', fmt: function (v) { return (v >= 100 ? Math.round(v) : round1(v)) + ' km'; } },
    sessions: { key: 'sessions', label: 'Sessions', unit: '', fmt: function (v) { return String(Math.round(v)); } }
  };
  function round1(v) { return Math.round(v * 10) / 10; }
  function val(o, key) { var n = Number(o && o[key]); return isFinite(n) ? n : 0; }

  // Smallest step k so that k slots give at least minPx of horizontal room.
  function thin(slotPx, minPx) {
    if (slotPx <= 0) return 1;
    return Math.max(1, Math.ceil(minPx / slotPx));
  }

  // 9px mono value label: ~5.5px per character + breathing room.
  function labelPx(text) { return Math.ceil(String(text).length * 5.5) + 6; }

  // Exposed for unit tests. labelW = widest value label in px (min slot).
  function density(n, width, metric, labelW) {
    var inner = Math.max(120, (width || 640) - 28);
    var minSlot = Math.max(labelW || 0, 18);
    var fit = inner / Math.max(1, n);
    var slot = Math.max(fit, minSlot);
    var scroll = slot * n > inner + 0.5;
    return {
      slot: slot,
      minSlot: minSlot,
      scroll: scroll,
      innerW: scroll ? Math.ceil(slot * n) : null,
      gap: slot >= 24 ? 5 : slot >= 10 ? 3 : 1,
      valueEvery: 1,
      axisEvery: thin(slot, 46),
      barMax: slot >= 60 ? 64 : slot >= 40 ? 40 : 9999
    };
  }

  // buildWeeklyStack(weekly, colors, opts)
  //   opts: { metric:'hours'|'km'|'sessions', width:px, narrow:bool }
  // Legacy signature buildWeeklyStack(weekly, colors, nWeeks, narrow) still
  // works (hours metric, width estimated from the old breakpoints).
  window.buildWeeklyStack = function (weekly, colors, opts, legacyNarrow) {
    weekly = weekly || [];
    colors = colors || {};
    if (typeof opts !== 'object' || opts === null) {
      opts = { metric: 'hours', narrow: !!legacyNarrow, width: legacyNarrow ? 360 : 900, legacy: true };
    }
    var M = METRICS[opts.metric] || METRICS.hours;
    var key = M.key;
    var n = weekly.length;
    var labelW = 0;
    weekly.forEach(function (w) { var v0 = val(w, key); if (v0 > 0 || !opts.legacy) labelW = Math.max(labelW, labelPx(M.fmt(v0))); });
    var d = density(n, opts.width, key, labelW);
    var maxV = Math.max.apply(null, weekly.map(function (w) { return val(w, key); }).concat([key === 'sessions' ? 1 : 0.5]));

    var bars = weekly.map(function (w, i) {
      var isLast = i === n - 1;
      var partial = isLast && !!w.isPartial;
      var stepsBack = n - 1 - i;
      var v = val(w, key);
      // Every bar keeps its visible total — including an explicit 0 / 0h /
      // 0 km above a zero week's baseline tick (legacy wrapper: no zero label).
      var showValue = v > 0 || !opts.legacy;
      // "This week" is right-aligned on the final column and overflows left,
      // so the next label back sits a full axis step away — never colliding.
      var showAxis = isLast || (stepsBack > 0 && stepsBack % d.axisEvery === 0);
      var barW = 'width:100%;max-width:' + (d.barMax === 9999 ? 'none' : d.barMax + 'px');
      var bar;
      if (v > 0) {
        var segs = (w.bySport || []).filter(function (s) { return val(s, key) > 0; }).slice().reverse().map(function (s) {
          var c = colors[s.sport] || FALLBACK;
          return '<div class="wk-seg" data-sport="' + esc(s.sport) + '" title="' + esc(c.name || s.sport) + ' · ' + esc(M.fmt(val(s, key))) + '" style="flex:0 0 ' + ((val(s, key) / v) * 100).toFixed(3) + '%;background:' + c.bar + (partial ? ';opacity:.42' : '') + '"></div>';
        }).join('');
        if (!segs) segs = '<div style="flex:1;background:#FFD21E' + (partial ? ';opacity:.42' : '') + '"></div>';
        bar = '<div class="wk-bar' + (partial ? ' wk-partial' : '') + '" style="' + barW + ';height:' + Math.max(4, Math.round((v / maxV) * 78)) + '%;border-radius:3px 3px 0 0;overflow:hidden;display:flex;flex-direction:column;box-sizing:border-box' +
          (partial ? ';border:1.5px dashed var(--gray-500);border-bottom:0;background:transparent' : '') + '">' + segs + '</div>';
      } else {
        bar = '<div class="wk-bar wk-zero' + (partial ? ' wk-partial' : '') + '" style="' + barW + ';height:3px;border-radius:1px;background:var(--gray-200)"></div>';
      }
      var axisText = isLast ? 'This week' : esc(w.label);
      return '' +
        '<div class="wk-col" data-i="' + i + '" title="' + esc((isLast ? 'This week' : w.label) + ' · ' + M.fmt(v) + (partial ? ' so far' : '')) + '" style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;justify-content:flex-end;position:relative">' +
          (showValue ? '<div class="wk-val" style="font-size:9px;font-family:var(--mono);font-weight:600;white-space:nowrap;color:' + (isLast ? 'var(--gray-900)' : 'var(--gray-500)') + '">' + esc(M.fmt(v)) + '</div>' : '') +
          bar +
          '<div class="wk-axis" style="font-size:8px;height:10px;line-height:10px;white-space:nowrap;' + (isLast ? 'position:relative;right:0;text-align:right;align-self:flex-end;' : '') + 'color:' + (isLast ? 'var(--gray-700)' : 'var(--gray-400)') + ';font-weight:' + (isLast ? '600' : '400') + '">' + (showAxis ? axisText : '') + '</div>' +
        '</div>';
    }).join('');

    // Legend: only sports present (metric > 0) in the visible range, by
    // metric total desc.
    var totals = {};
    var order = [];
    weekly.forEach(function (w) {
      (w.bySport || []).forEach(function (s) {
        var sv = val(s, key);
        if (sv <= 0) return;
        if (!(s.sport in totals)) { totals[s.sport] = 0; order.push(s.sport); }
        totals[s.sport] += sv;
      });
    });
    order.sort(function (a, b) { return totals[b] - totals[a]; });
    var legend = order.map(function (id) {
      var c = colors[id] || FALLBACK;
      return '<div class="wk-legend-item" style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--gray-600)">' +
        '<span style="width:14px;height:14px;border-radius:3px;background:' + c.bar + ';flex-shrink:0"></span>' +
        c.icon + ' ' + esc(c.name || id) + '</div>';
    }).join('');
    var partialKey = n && weekly[n - 1].isPartial
      ? '<div class="wk-legend-item" style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--gray-500);margin-left:auto"><span style="width:14px;height:14px;border-radius:3px;border:1.5px dashed var(--gray-500);box-sizing:border-box;flex-shrink:0"></span>In progress</div>'
      : '';

    var chart = '<div class="wk-chart" data-metric="' + key + '" data-axis-every="' + d.axisEvery + '" data-scroll="' + (d.scroll ? 1 : 0) + '" role="img" aria-label="' + esc(M.label + ' per week, ' + n + ' weeks') + '" style="display:flex;align-items:flex-end;gap:' + d.gap + 'px;height:190px;padding:14px 14px 8px;box-sizing:border-box' + (d.scroll ? ';width:' + (d.innerW + 28) + 'px' : '') + '">' + bars + '</div>';
    // Dense ranges: local horizontal scroll inside the card (page never
    // scrolls sideways). The caller pins scrollLeft to the end.
    if (d.scroll) chart = '<div class="wk-scroll" tabindex="0" aria-label="Weekly chart, scroll for earlier weeks" style="overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain">' + chart + '</div>' +
      '<div class="wk-scroll-hint" style="font-size:10px;color:var(--gray-400);padding:0 14px 8px;text-align:right">← Scroll for earlier weeks</div>';
    return chart +
      (legend ? '<div class="wk-legend" style="display:flex;flex-wrap:wrap;gap:8px 18px;padding:10px 14px 12px;border-top:var(--border)">' + legend + partialKey + '</div>' : '');
  };

  window.ArenasStack = { metrics: METRICS, density: density, labelPx: labelPx, build: window.buildWeeklyStack };
})();
