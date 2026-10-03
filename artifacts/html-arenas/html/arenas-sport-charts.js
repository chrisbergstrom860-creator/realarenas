// Shared "By sport" charts builder for the Stats & PRs tab (and its verify
// harness). Hand-rolled SVG — no chart library, same approach as the weekly
// stack and the old pie.
//
// Three charts: Sessions (vertical bars), Time (vertical bars, hours), Share
// of sessions (flat pie + a legend listing EVERY sport — swatch, name,
// percent). One color per sport from the sports registry (colors.text), the
// same hex in all three charts so the eye connects them without a per-chart
// legend. A compact table below carries the exact figures — sessions, km
// (distance would otherwise be dropped by the charts), time.
//
// Percentages: largest-remainder rounding (carried over from arenas-pie.js)
// so the printed whole numbers always sum to exactly 100. Geometry uses the
// exact fractional shares.
//
// States: an empty breakdown returns '' (the caller's card gate owns that
// case); a single sport renders one labelled bar per chart and a full
// <circle> pie (an SVG arc cannot draw a 360° sweep); a sport with sessions
// but no recorded time keeps its slot in the Time chart — 2px baseline stub
// in the sport's color with "—" above it, so the sport stays aligned across
// charts instead of silently vanishing.
(function () {
  'use strict';

  var esc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var FALLBACK = { bar: '#6B7280', icon: '🏅', name: '' };

  // ── Vertical bar chart (SVG) ──
  // rows: [{ sport, value, label }] — label printed above the bar ('—' for a
  // missing value, which renders a 2px stub). Emoji axis labels below.
  function barChart(rows, colors, title, ariaLabel, narrow) {
    var n = rows.length;
    // Narrow keeps slimmer slots so a 12-sport chart doesn't scale down as
    // hard when width:100% fits it to a phone viewport.
    var slotW = narrow ? 30 : 40, gap = narrow ? 10 : 16, padX = 8;
    var W = padX * 2 + n * slotW + (n - 1) * gap;
    var chartH = 200, labelH = 20, axisH = 26;
    var H = labelH + chartH + axisH;
    var max = 0;
    rows.forEach(function (r) { if (r.value > max) max = r.value; });
    // Shrink value labels when 9+ bars squeeze the slots.
    var vFont = n >= 9 ? 11 : 13;
    var parts = [];
    rows.forEach(function (r, i) {
      var sc = colors[r.sport] || FALLBACK;
      var x = padX + i * (slotW + gap);
      var h = max > 0 && r.value > 0 ? Math.max(3, Math.round((r.value / max) * chartH)) : 2;
      var y = labelH + chartH - h;
      parts.push('<rect x="' + x + '" y="' + y + '" width="' + slotW + '" height="' + h + '" rx="3" fill="' + sc.bar + '"/>');
      parts.push('<text x="' + (x + slotW / 2) + '" y="' + (y - 5) + '" text-anchor="middle" font-size="' + vFont + '" font-weight="700" font-family="ui-monospace,monospace" fill="#374151">' + esc(r.label) + '</text>');
      parts.push('<text x="' + (x + slotW / 2) + '" y="' + (labelH + chartH + 20) + '" text-anchor="middle" font-size="16">' + sc.icon + '</text>');
    });
    return (
      '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;min-width:0">' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:' + W + 'px;display:block" role="img" aria-label="' + esc(ariaLabel) + '">' + parts.join('') + '</svg>' +
      chartTitle(title) +
      '</div>'
    );
  }

  // Chart caption — 13px/700 in --gray-700 (#374151, ~10.3:1 on the white
  // card) so the labels read as labels, not afterthoughts.
  function chartTitle(title) {
    return '<div style="font-size:13px;font-weight:700;color:var(--gray-700);text-transform:uppercase;letter-spacing:.05em">' + esc(title) + '</div>';
  }

  // ── Pie + full legend (largest-remainder percentages) ──
  function piePanel(rows, colors, narrow, opts) {
    opts = opts || {};
    var donut = !!opts.donut;
    var LR = donut ? 62 : 50; // label radius: mid-ring for the donut
    var total = rows.reduce(function (a, s) { return a + s.sessions; }, 0);
    var data = rows.map(function (s) {
      var exact = (s.sessions / total) * 100;
      return { sport: s.sport, exact: exact, pct: Math.floor(exact) };
    });
    var used = data.reduce(function (a, d) { return a + d.pct; }, 0);
    data.slice()
      .sort(function (a, b) { return (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)); })
      .slice(0, 100 - used)
      .forEach(function (d) { d.pct += 1; });

    // In-slice percentage labels, only where legible: the label sits at
    // mid-angle on radius 50 (of an 80 radius pie); it "fits" when the arc
    // length there (slice angle x 50) >= estimated text width (7.2 viewBox
    // units per character, bold 12) + 6 padding. Effectively >= ~9-10% for a
    // two/three-character label. White text — every registry accent is dark
    // enough that white clears WCAG AA on it (asserted by the verify script).
    var sliceLabel = function (pct, midDeg) {
      var txt = pct + '%';
      var mid = (midDeg * Math.PI) / 180;
      return '<text x="' + (100 + LR * Math.cos(mid)).toFixed(2) + '" y="' + (100 + LR * Math.sin(mid)).toFixed(2) +
        '" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="700" font-family="ui-monospace,monospace" fill="#FFFFFF">' + txt + '</text>';
    };
    var fits = function (exact, pct) {
      var theta = (exact / 100) * 2 * Math.PI;
      return theta * LR >= String(pct + '%').length * 7.2 + 6;
    };
    var parts = [];
    if (data.length === 1) {
      // One sport = a full circle; that's the honest picture.
      var sc1 = colors[data[0].sport] || FALLBACK;
      parts.push('<circle cx="100" cy="100" r="80" fill="' + sc1.bar + '"/>');
      parts.push('<text x="100" y="' + (donut ? 38 : 100) + '" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="700" font-family="ui-monospace,monospace" fill="#FFFFFF">' + data[0].pct + '%</text>');
    } else {
      var cum = 0;
      data.forEach(function (d) {
        var sc = colors[d.sport] || FALLBACK;
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
        if (fits(d.exact, d.pct)) parts.push(sliceLabel(d.pct, (a0 + a1) / 2));
      });
    }
    // Every sport in the legend (swatch · name · percent) at 15px — the legend
    // is the pie's only complete listing, so it reads as body text, not fine
    // print.
    if (donut) {
      // Donut hole + centre total. The hole is drawn over the slices so the
      // slice geometry (and the in-slice label fit rule) is untouched.
      parts.push('<circle class="donut-hole" cx="100" cy="100" r="44" fill="white"/>');
      parts.push('<text class="donut-total" x="100" y="96" text-anchor="middle" dominant-baseline="middle" font-size="22" font-weight="700" font-family="ui-monospace,monospace" fill="#111827">' + total + '</text>');
      parts.push('<text class="donut-unit" x="100" y="116" text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="600" letter-spacing=".06em" fill="#6B7280">SESSION' + (total !== 1 ? 'S' : '') + '</text>');
    }
    var sessionsBy = {};
    rows.forEach(function (r) { sessionsBy[r.sport] = r.sessions; });
    var legend = data.map(function (d) {
      var sc = colors[d.sport] || FALLBACK;
      return '<div class="sc-legend-row" style="display:flex;align-items:center;gap:10px;font-size:' + (donut ? 14 : 15) + 'px;color:var(--gray-600);white-space:nowrap">' +
        '<span style="width:' + (donut ? 14 : 18) + 'px;height:' + (donut ? 14 : 18) + 'px;border-radius:4px;background:' + sc.bar + ';flex-shrink:0"></span>' +
        '<span style="overflow:hidden;text-overflow:ellipsis;' + (donut ? 'flex:1;min-width:0;color:var(--gray-800)' : '') + '">' + sc.icon + ' ' + esc(sc.name || d.sport) + '</span>' +
        '<span style="font-family:var(--mono);color:var(--gray-500);margin-left:auto;' + (donut ? 'width:44px;text-align:right' : '') + '">' + d.pct + '%</span>' +
        (donut ? '<span class="sc-legend-sessions" style="font-family:var(--mono);color:var(--gray-900);font-weight:600;width:40px;text-align:right">' + sessionsBy[d.sport] + '</span>' : '') +
        '</div>';
    }).join('');
    if (donut) {
      legend = '<div style="display:flex;gap:10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--gray-400);padding-bottom:2px;border-bottom:1px solid var(--gray-100)"><span style="flex:1">Sport</span><span style="width:44px;text-align:right">Share</span><span style="width:40px;text-align:right">Sess.</span></div>' + legend;
    }
    // Desktop: the pie panel now spans the FULL card width (top row of the
    // grid below), so there is always room for the legend BESIDE a larger
    // pie — 300px pie + 16 gap + content-sized legend (~144px) needs ~460px
    // and the full-width panel has ~920px at the 956px shell cell. The
    // legend stays right of the pie, stacked, sized to its content (never
    // stretched to the panel edge). The flex-wrap fallback from the
    // shell-width pass is REMOVED: it existed because the pie shared a
    // three-panel row whose ~326px column couldn't fit pie+legend; that row
    // no longer exists. Narrow (the caller's <=480 flag, where the whole
    // grid stacks to one column): legend below a column-filling pie (capped
    // 300px) — beside it would squeeze the pie on a 360px viewport. viewBox
    // stays 200, so in-slice label fit is size-invariant.
    var size = donut ? (narrow ? 220 : 180) : 300;
    var svg = '<svg viewBox="0 0 200 200" style="' + (narrow
      ? 'width:100%;max-width:' + size + 'px;height:auto'
      : 'width:' + size + 'px;height:' + size + 'px;flex-shrink:0') + ';display:block" role="img" aria-label="Share of sessions by sport' + (donut ? ', ' + total + ' sessions' : '') + '">' + parts.join('') + '</svg>';
    if (donut) {
      return '<div class="sc-donut" style="display:flex;' + (narrow ? 'flex-direction:column;align-items:center;gap:16px' : 'align-items:center;gap:22px') + ';min-width:0">' +
        svg + '<div class="sc-legend" style="display:flex;flex-direction:column;gap:9px;min-width:0;flex:1;' + (narrow ? 'align-self:stretch' : 'max-width:300px') + '">' + legend + '</div></div>';
    }
    return (
      '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;min-width:0">' +
      '<div style="display:flex;' + (narrow
        ? 'flex-direction:column;align-items:center;gap:12px'
        : 'align-items:center;gap:24px') + ';min-width:0' + (narrow ? ';align-self:stretch' : '') + '">' +
      svg +
      '<div style="display:flex;flex-direction:column;gap:7px;min-width:0' + (narrow ? ';align-self:stretch' : '') + '">' + legend + '</div>' +
      '</div>' +
      chartTitle('Share of sessions') +
      '</div>'
    );
  }

  // ── Compact exact-figures table (sessions · km · time) ──
  // Distance lives HERE: the three charts don't carry km, and dropping it
  // silently was ruled out. "—" for no distance / no recorded time.
  function exactTable(rows, colors) {
    var body = rows.map(function (s) {
      var sc = colors[s.sport] || FALLBACK;
      return '<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-top:1px solid var(--gray-100);font-size:13px">' +
        '<span style="width:12px;height:12px;border-radius:3px;background:' + sc.bar + ';flex-shrink:0"></span>' +
        '<span style="font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + sc.icon + ' ' + esc(sc.name || s.sport) + '</span>' +
        '<span style="font-family:var(--mono);color:var(--gray-500);width:96px;text-align:right;flex-shrink:0">' + s.sessions + ' session' + (s.sessions !== 1 ? 's' : '') + '</span>' +
        '<span style="font-family:var(--mono);color:var(--gray-500);width:78px;text-align:right;flex-shrink:0">' + (s.km > 0 ? s.km + ' km' : '—') + '</span>' +
        '<span style="font-family:var(--mono);color:var(--gray-500);width:60px;text-align:right;flex-shrink:0">' + (s.hours > 0 ? s.hours + 'h' : '—') + '</span>' +
        '</div>';
    }).join('');
    return '<div>' + body + '</div>';
  }

  // ── Activity summary table (header row Sport / Sessions / Distance / Time)
  function summaryTable(rows, colors) {
    var th = 'font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--gray-400);text-align:right;padding:10px 14px';
    var td = 'font-family:var(--mono);color:var(--gray-700);text-align:right;padding:10px 14px;white-space:nowrap;border-top:1px solid var(--gray-100)';
    var body = rows.map(function (s) {
      var sc = colors[s.sport] || FALLBACK;
      return '<tr class="sc-sum-row" data-sport="' + esc(s.sport) + '">' +
        '<td style="padding:10px 14px;border-top:1px solid var(--gray-100);font-weight:600;color:var(--gray-900);max-width:0;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          '<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + sc.bar + ';margin-right:8px;vertical-align:0"></span>' + sc.icon + ' ' + esc(sc.name || s.sport) + '</td>' +
        '<td style="' + td + '">' + s.sessions + '</td>' +
        '<td style="' + td + '">' + (s.km > 0 ? s.km + ' km' : '—') + '</td>' +
        '<td style="' + td + '">' + (s.hours > 0 ? s.hours + 'h' : '—') + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="sc-summary" style="width:100%;border-collapse:collapse;font-size:13px;table-layout:auto">' +
      '<thead><tr><th style="' + th + ';text-align:left">Sport</th><th style="' + th + '">Sessions</th><th style="' + th + '">Distance</th><th style="' + th + '">Time</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>';
  }

  function activeRows(breakdown) {
    return (breakdown || []).filter(function (s) { return s.sessions > 0; });
  }
  function sessionsRows(rows) {
    return rows.map(function (s) { return { sport: s.sport, value: s.sessions, label: String(s.sessions) }; });
  }
  function timeRows(rows) {
    return rows.map(function (s) { return { sport: s.sport, value: s.hours, label: s.hours > 0 ? s.hours + 'h' : '—' }; });
  }

  // Composable exports — each returns '' for an empty (zero-session) set so
  // the caller's card gate owns the empty state. No chart code is duplicated:
  // these call the same barChart / piePanel the legacy wrapper uses.
  window.ArenasSportCharts = {
    rows: activeRows,
    donut: function (breakdown, colors, narrow) {
      var rows = activeRows(breakdown);
      return rows.length ? piePanel(rows, colors, narrow, { donut: true }) : '';
    },
    summaryTable: function (breakdown, colors) {
      var rows = activeRows(breakdown);
      return rows.length ? summaryTable(rows, colors) : '';
    },
    sessionsBars: function (breakdown, colors, narrow) {
      var rows = activeRows(breakdown);
      return rows.length ? barChart(sessionsRows(rows), colors, 'Sessions', 'Sessions per sport', narrow) : '';
    },
    timeBars: function (breakdown, colors, narrow) {
      var rows = activeRows(breakdown);
      return rows.length ? barChart(timeRows(rows), colors, 'Time', 'Hours per sport', narrow) : '';
    }
  };

  // breakdown: [{ sport, sessions, km, hours }] (server order preserved)
  // colors:    { sportId: { bar, icon, name } } from the sports registry
  // narrow:    true stacks the three charts vertically (mobile)
  window.buildSportCharts = function (breakdown, colors, narrow) {
    var rows = (breakdown || []).filter(function (s) { return s.sessions > 0; });
    if (rows.length === 0) return '';

    // Legacy wrapper (kept for compatibility): same output as before.
    var sessions = barChart(sessionsRows(rows), colors, 'Sessions', 'Sessions per sport', narrow);
    var time = barChart(timeRows(rows), colors, 'Time', 'Hours per sport', narrow);
    var pie = piePanel(rows, colors, narrow);

    // Layout: the pie panel spans the full card width on top (at the 956px
    // shell cell a three-panel row left the pie's panel far taller than the
    // bars — wrapped legend — and dead space under the bars); the two bar
    // charts sit side by side below it, each half width. Same panel chrome:
    // 20/16 padding, var(--border) dividers, chartTitle captions. DOM order
    // pie → Sessions → Time, so the narrow single-column stack reads pie
    // first, then the bars.
    var cell = function (inner, style) {
      return '<div style="padding:20px 16px;min-width:0;' + (style || '') + '">' + inner + '</div>';
    };
    return (
      '<div style="display:grid;grid-template-columns:' + (narrow ? '1fr' : '1fr 1fr') + '">' +
      cell(pie, narrow ? 'border-bottom:var(--border)' : 'grid-column:1/-1;border-bottom:var(--border)') +
      cell(sessions, narrow ? 'border-bottom:var(--border)' : 'border-right:var(--border)') +
      cell(time) +
      '</div>' +
      '<div style="border-top:var(--border)">' + exactTable(rows, colors) + '</div>'
    );
  };
})();
