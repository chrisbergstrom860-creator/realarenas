(function () {
  'use strict';

  var DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function readableDate(key) {
    var date = new Date(String(key) + 'T00:00:00Z');
    if (isNaN(date.getTime())) return String(key || '');
    return date.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC'
    });
  }

  function buildFourWeekActivityGridHtml(grid, options) {
    var data = grid || { activityCount: 0, weeks: [] };
    var opts = options || {};
    var count = Number(data.activityCount) || 0;
    var extraClass = opts.className ? ' ' + esc(opts.className) : '';
    var countLabel = count + ' ' + (count === 1 ? 'ACTIVITY' : 'ACTIVITIES');
    var rows = (data.weeks || []).map(function (week) {
      var cells = (week.days || []).map(function (day) {
        var state = day.state === 'active' ? 'active' : day.state === 'future' ? 'future' : 'inactive';
        var stateLabel = state === 'active' ? 'activity logged' : state === 'future' ? 'future day' : 'no activity';
        var dot = state === 'future' ? '' : '<span class="activity-grid-dot activity-grid-dot-' + state + '" aria-hidden="true"></span>';
        return '<div class="activity-grid-cell" role="gridcell" data-date="' + esc(day.dateKey) +
          '" data-state="' + state + '" aria-label="' + esc(readableDate(day.dateKey) + ' — ' + stateLabel) + '">' +
          dot + '</div>';
      }).join('');
      return '<div class="activity-grid-row" role="row" data-week-start="' + esc(week.startKey) + '">' + cells + '</div>';
    }).join('');

    return '<section class="activity-grid-card' + extraClass + '" data-activity-grid data-activity-count="' + count + '">' +
      '<div class="activity-grid-header">' +
        '<div class="activity-grid-title">LAST 4 WEEKS</div>' +
        '<div class="activity-grid-count">' + countLabel + '</div>' +
      '</div>' +
      '<div class="activity-grid-body">' +
        '<div class="activity-grid-weekdays" role="row">' +
          DAY_LABELS.map(function (label) {
            return '<div class="activity-grid-weekday" role="columnheader">' + label + '</div>';
          }).join('') +
        '</div>' +
        '<div class="activity-grid-rows" role="grid" aria-label="Activity days for the last four calendar weeks">' + rows + '</div>' +
      '</div>' +
    '</section>';
  }

  window.buildFourWeekActivityGridHtml = buildFourWeekActivityGridHtml;
})();