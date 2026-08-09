// Shared club-announcement header — the ONE renderer for club-owned post
// identity, consumed by the main feed (arenas-feed.html), the club dashboard
// Feed tab (arenas-club-dashboard.html) and club member home
// (arenas-club-member.html). Do not fork this per page.
//
// Rule: on a club announcement the CLUB is primary — club logo tile (with the
// app-wide clubTileHtml sport-icon fallback for logoless clubs) and club name
// as the headline — and the author is secondary: "posted by <name> · <time>".
// Two lines by design: the club name is never truncated (it may wrap); the
// secondary line ellipsizes the author before ever touching the club name,
// which is what keeps 360px honest.
//
// clubPostHeaderHtml(item, opts) → header HTML (tile + two-line block).
//   item: { clubName, clubLogoUrl, clubSport, authorName }
//   opts: { timeText, tileSize (px, default 36), tileStyle }
// Depends on window.clubTileHtml (injected app-wide in <head>).
(function () {
  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  window.clubPostHeaderHtml = function (item, opts) {
    var o = opts || {};
    var size = o.tileSize || 36;
    var tile = window.clubTileHtml(
      item.clubLogoUrl || null,
      item.clubSport || null,
      '',
      'width:' + size + 'px;height:' + size + 'px;border-radius:8px;background:var(--yellow-light);color:var(--gray-900);display:flex;align-items:center;justify-content:center;font-size:' + Math.round(size * 0.5) + 'px;flex-shrink:0;overflow:hidden;border:0.5px solid var(--yellow-dark)' + (o.tileStyle ? ';' + o.tileStyle : '')
    );
    var secondary = 'posted by ' + esc(item.authorName || item.name || item.coachName || 'a member')
      + (o.timeText ? ' · ' + esc(o.timeText) : '');
    return tile
      + '<div style="min-width:0;flex:1">'
      + '<div style="font-size:13px;font-weight:600;color:var(--gray-900);line-height:1.3">' + esc(item.clubName || 'Club') + '</div>'
      + '<div style="font-size:11px;color:var(--gray-400);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + secondary + '</div>'
      + '</div>';
  };
})();
