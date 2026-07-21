// Shared activity stat-tile builder (feed + my-profile Activities tab).
// One renderer, no drift: boxed tiles — large mono value with a small emoji
// accent in front, 9px small-caps label beneath. Free-text values (course
// name, terrain) get the .tx text treatment (12px sans, ellipsis) in a wider
// .tx-tile. Fields that never had an emoji (terrain) get none. Tile CSS lives
// in arenas.css (base rules + the body:has(.bottom-nav) mobile wrap rules).
// Empty stats → both helpers return '' so callers render NO row at all.
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function tile(emoji, value, label, isText) {
    return '<div class="ac-stat' + (isText ? ' tx-tile' : '') + '">' +
      '<span class="sv' + (isText ? ' tx' : '') + '">' +
        (emoji ? '<span class="si">' + emoji + '</span> ' : '') + esc(value) +
      '</span>' +
      '<span class="sl">' + esc(label) + '</span>' +
    '</div>';
  }

  // Returns the joined tile HTML for an activity row, or '' when it has no
  // stats. Field order and the per-stat emoji map are the app-wide standard.
  window.buildActivityStatTiles = function (a) {
    var stats = [];
    if (a.duration) stats.push(tile('⏱', a.duration, 'Duration'));
    if (a.distance) stats.push(tile('📍', a.distance, 'Distance'));
    if (a.pace) stats.push(tile('⚡', a.pace, 'Pace'));
    if (a.avg_power) stats.push(tile('⚡', a.avg_power, 'Power'));
    if (a.avg_hr) stats.push(tile('❤️', a.avg_hr, 'Avg HR'));
    if (a.elevation) stats.push(tile('⛰', a.elevation, 'Elevation'));
    if (a.top_grade) stats.push(tile('✓', a.top_grade, 'Top grade'));
    if (a.problems_count) stats.push(tile('🧗', a.problems_count, 'Problems'));
    if (a.golf_strokes) stats.push(tile('⛳', a.golf_strokes, 'Strokes'));
    if (a.golf_course) stats.push(tile('🏌️', a.golf_course, 'Course', true));
    if (a.terrain) stats.push(tile(null, a.terrain, 'Terrain', true));
    if (a.rpe) stats.push(tile('💪', a.rpe, 'RPE'));
    return stats.join('');
  };

  // Convenience: the full row (wrapper included), or '' when stat-less.
  window.activityStatTilesRow = function (a) {
    var tiles = window.buildActivityStatTiles(a);
    return tiles ? '<div class="ac-stats-row">' + tiles + '</div>' : '';
  };
})();
