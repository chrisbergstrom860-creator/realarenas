(function (window) {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  function formatWeekRange(recap) {
    var start = String(recap.weekStart || '');
    var end = String(recap.weekEnd || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return '';
    var startDate = new Date(start + 'T00:00:00Z');
    var endDate = new Date(end + 'T00:00:00Z');
    if (isNaN(startDate) || isNaN(endDate)) return '';
    return startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) +
      ' – ' + endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  function render() {
    var recap = window.ARENAS_RECAP;
    var root = byId('weekly-recap-answer');
    if (!root || !recap) return;
    var range = formatWeekRange(recap);
    var rangeEl = byId('weekly-recap-range');
    var timezoneEl = byId('weekly-recap-timezone');
    if (rangeEl) rangeEl.textContent = range ? 'Week of ' + range : 'Weekly recap';
    if (timezoneEl) timezoneEl.textContent = recap.timezone ? 'Timezone: ' + recap.timezone : '';
    if (!window.ArenasInsights || typeof window.ArenasInsights.mountStoredRecap !== 'function') {
      root.textContent = 'Could not load this recap.';
      return;
    }
    window.ArenasInsights.mountStoredRecap(root, recap);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})(window);