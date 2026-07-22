// Shared "By sport" pie builder for the Stats & PRs tab (and its visual
// harness). Hand-rolled SVG arcs — no chart library.
//
// Basis: share of SESSIONS per sport — the same basis as the card's bar list,
// so the two visuals can never disagree. Geometry uses the exact fractional
// shares; the printed percentages use largest-remainder rounding so the whole
// numbers always sum to exactly 100.
//
// Labels: emoji + percent inside the slice when it fits; smaller slices get a
// legend line under the pie instead — inline text in a sliver would be
// cramped or overflow the wedge. On desktop the pie renders at 300px with a
// proportionally smaller label font (9 viewBox units ≈ 13.5px on screen), so
// slices down to 7% can hold an inline label; narrow keeps the 10% threshold
// (smaller render, 12-unit font).
//
// States: one sport renders a full <circle> (an SVG arc path cannot draw a
// single 360° sweep); an empty breakdown returns '' — the caller's existing
// empty treatment owns that case (never an empty gray circle).
(function () {
  'use strict';

  // breakdown: [{ sport, sessions }] (server order preserved)
  // colors:    { sportId: { bar, icon, name } } from the sports registry
  // narrow:    true stacks the panel below the bars (mobile)
  window.buildSportPie = function (breakdown, colors, narrow) {
    var rows = (breakdown || []).filter(function (s) { return s.sessions > 0; });
    if (rows.length === 0) return '';
    var esc = function (t) {
      return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };
    var fallback = { bar: '#6B7280', icon: '🏅', name: '' };
    var total = rows.reduce(function (a, s) { return a + s.sessions; }, 0);

    // Largest-remainder rounding: floor everything, then hand the leftover
    // points to the largest fractional remainders so the sum is exactly 100.
    var data = rows.map(function (s) {
      var exact = (s.sessions / total) * 100;
      return { sport: s.sport, exact: exact, pct: Math.floor(exact) };
    });
    var used = data.reduce(function (a, d) { return a + d.pct; }, 0);
    data.slice()
      .sort(function (a, b) { return (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)); })
      .slice(0, 100 - used)
      .forEach(function (d) { d.pct += 1; });

    // Bigger desktop pie → smaller relative label font → inline labels fit
    // down to 7%. Narrow stays at the 10% threshold.
    var inlineMin = narrow ? 10 : 7;
    var labelFont = narrow ? 12 : 9;

    var parts = [];
    var legend = [];
    if (data.length === 1) {
      // One sport = a full circle; that's the honest picture.
      var sc1 = colors[data[0].sport] || fallback;
      parts.push('<circle cx="100" cy="100" r="80" fill="' + sc1.bar + '"/>');
      parts.push('<text x="100" y="105" text-anchor="middle" font-size="15" font-weight="700" fill="white">' + sc1.icon + ' ' + data[0].pct + '%</text>');
    } else {
      var cum = 0;
      data.forEach(function (d) {
        var sc = colors[d.sport] || fallback;
        var name = sc.name || d.sport;
        var a0 = (cum / 100) * 360 - 90;
        cum += d.exact;
        var a1 = (cum / 100) * 360 - 90;
        var r0 = (a0 * Math.PI) / 180, r1 = (a1 * Math.PI) / 180;
        var x0 = 100 + 80 * Math.cos(r0), y0 = 100 + 80 * Math.sin(r0);
        var x1 = 100 + 80 * Math.cos(r1), y1 = 100 + 80 * Math.sin(r1);
        var large = a1 - a0 > 180 ? 1 : 0;
        parts.push(
          '<path d="M100 100 L' + x0.toFixed(2) + ' ' + y0.toFixed(2) +
          ' A80 80 0 ' + large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
          ' Z" fill="' + sc.bar + '" stroke="white" stroke-width="2" stroke-linejoin="round"/>'
        );
        if (d.pct >= inlineMin) {
          var mid = (r0 + r1) / 2;
          var lx = 100 + 52 * Math.cos(mid), ly = 100 + 52 * Math.sin(mid);
          parts.push('<text x="' + lx.toFixed(2) + '" y="' + (ly + 4).toFixed(2) + '" text-anchor="middle" font-size="' + labelFont + '" font-weight="700" fill="white">' + sc.icon + ' ' + d.pct + '%</text>');
        } else {
          legend.push(
            '<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--gray-600)">' +
            '<span style="width:8px;height:8px;border-radius:2px;background:' + sc.bar + ';flex-shrink:0"></span>' +
            sc.icon + ' ' + esc(name) + ' · ' + d.pct + '%</div>'
          );
        }
      });
    }

    // Desktop doubled 150→300px (panel 210→340px). Narrow is capped at 180px
    // — a full 2× (264px+) would dominate a 380px viewport.
    var size = narrow ? '180px' : '300px';
    return (
      '<div style="' + (narrow
        ? 'border-top:var(--border);padding:14px;display:flex;flex-direction:column;align-items:center;gap:8px'
        : 'width:340px;flex-shrink:0;border-left:var(--border);padding:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px') + '">' +
      '<svg viewBox="0 0 200 200" style="width:' + size + ';height:' + size + ';display:block" role="img" aria-label="Share of sessions by sport">' + parts.join('') + '</svg>' +
      (legend.length ? '<div style="display:flex;flex-direction:column;gap:3px">' + legend.join('') + '</div>' : '') +
      '<div style="font-size:9px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.05em">Share of sessions</div>' +
      '</div>'
    );
  };
})();
