// Shared relative-time helper (feed, my-profile, club-member, club-dashboard,
// served dual-path like arenas-stat-tiles.js). One source for "ago" math so
// bucket rules can't drift between pages.
//
// IMPORTANT field-choice rule: "X ago" lines describe when something was
// LOGGED/created, so they must be fed `created_at` (true UTC timestamptz),
// never the activity's `date` field — `date` is the local-NOON anchor of the
// training day (see arenas-log.html), so time-since-`date` renders as
// hours-since-noon ("1h ago" for an activity logged moments ago at 1pm).
//
// Buckets (rounding down): <60s "Just now" · <1h "Xm ago" · <24h "Xh ago" ·
// else "Xd ago". opts.dateAfterDays switches to a locale date at/after N days
// (my-profile Activities keeps its historical 7-day cutover).
(function () {
  window.arenasTimeAgo = function (ts, opts) {
    var t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
    if (isNaN(t)) return '';
    var s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    var days = Math.floor(s / 86400);
    if (opts && opts.dateAfterDays && days >= opts.dateAfterDays) {
      return new Date(t).toLocaleDateString();
    }
    return days + 'd ago';
  };
})();
