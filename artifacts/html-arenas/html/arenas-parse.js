// Shared activity math for Node and the browser. Legacy one/two-part duration
// heuristics are intentional; only three-part durations use strict H:MM:SS.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.arenasParse = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // Every distance total uses this unit-aware parser: km, mi ×1.609,
  // metres ÷1000, and unitless kilometres. Preserve numeral stripping quirks.
  function parseDistanceKmUnitAware(distance) {
    if (distance == null) return 0;
    const raw = String(distance).toLowerCase().replace(/,/g, '');
    const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
    if (isNaN(n) || n <= 0) return 0;
    if (raw.includes('km')) return n;
    if (raw.includes('mi')) return n * 1.609;
    if (raw.includes('m')) return n / 1000;
    return n;
  }

  function parseDurationHours(duration) {
    if (!duration) return 0;
    const str = String(duration).toLowerCase().trim();
    if (str.includes(':')) {
      const parts = str.split(':');
      if (parts.length === 3) {
        if (!parts.every((part) => /^\d+$/.test(part))) return 0;
        const [hours, minutes, seconds] = parts.map(Number);
        if (!Number.isFinite(hours) || minutes > 59 || seconds > 59) return 0;
        return (hours * 3600 + minutes * 60 + seconds) / 3600;
      }
      if (parts.length > 3) return 0;
      const a = parseFloat(parts[0]) || 0;
      const b = parseFloat(parts[1]) || 0;
      // Preserve the legacy heuristic: >12 means MM:SS, otherwise H:MM.
      return a > 12 ? a / 60 + b / 3600 : a + b / 60;
    }
    const hMatch = str.match(/(\d+(?:\.\d+)?)\s*h/);
    const mMatch = str.match(/(\d+(?:\.\d+)?)\s*m/);
    if (hMatch || mMatch) {
      return (parseFloat(hMatch && hMatch[1]) || 0) + (parseFloat(mMatch && mMatch[1]) || 0) / 60;
    }
    const num = parseFloat(str.replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return 0;
    return num > 12 ? num / 60 : num;
  }

  // Round once in seconds so e.g. 4:59.6 becomes 5:00, never 4:60.
  function formatPace(minutesPerUnit) {
    if (!Number.isFinite(minutesPerUnit) || minutesPerUnit < 0) return '';
    const totalSeconds = Math.round(minutesPerUnit * 60);
    return Math.floor(totalSeconds / 60) + ':' + String(totalSeconds % 60).padStart(2, '0');
  }

  return { parseDistanceKmUnitAware, parseDurationHours, formatPace };
}));