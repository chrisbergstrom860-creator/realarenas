// Validation for new entries, separate from the legacy parser used for history.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./arenas-parse'));
  else root.arenasDuration = factory(root.arenasParse);
}(typeof window !== 'undefined' ? window : this, function (parse) {
  'use strict';
  function label(seconds) {
    seconds = Math.round(seconds);
    var h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
    return [h ? h + ' h' : '', m ? m + ' min' : '', s ? s + ' s' : ''].filter(Boolean).join(' ');
  }
  function validate(value) {
    var text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    var error = 'Enter a valid positive duration, such as 45:00, 1h 30m or 0:05:30.';
    if (!text) return { valid: false, error: 'Please enter the duration.' };
    var syntax;
    if (text.includes(':')) {
      syntax = /^\d+:\d{1,2}(?::\d{1,2})?$/.test(text);
      var parts = text.split(':').map(Number);
      syntax = syntax && parts.slice(1).every(function (n) { return n < 60; });
    } else {
      syntax = /^\d+(?:\.\d+)?$/.test(text) ||
        /^(?:\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours)\s*)?(?:\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes)\s*)?$/i.test(text);
    }
    var hours = syntax ? parse.parseDurationHours(text) : 0;
    var seconds = Math.round(hours * 3600);
    if (!Number.isFinite(hours) || hours <= 0 || seconds < 1 || !Number.isSafeInteger(seconds)) {
      return { valid: false, error: error };
    }
    return { valid: true, hours: hours, seconds: seconds, label: label(seconds) };
  }
  function inspect(value, sport, distance) {
    var result = validate(value);
    if (!result.valid) return result;
    var parts = String(value).trim().split(':');
    var km = parse.parseDistanceKmUnitAware(distance);
    if (sport !== 'running' || parts.length !== 2 || !Number.isFinite(km) || km <= 0) return result;
    var pace = result.hours * 60 / km;
    if (pace >= 2 && pace <= 20) return result;
    var a = Number(parts[0]), b = Number(parts[1]);
    var seconds = a > 12 ? a * 3600 + b * 60 : a * 60 + b;
    if (!Number.isSafeInteger(seconds) || seconds <= 0) return result;
    var alternatePace = seconds / 60 / km;
    result.warning = {
      pace: parse.formatPace(pace),
      alternativePace: parse.formatPace(alternatePace),
      alternativeLabel: label(seconds),
      alternativePlausible: alternatePace >= 2 && alternatePace <= 20,
      // Always persist three components; never feed another ambiguous pair back.
      alternativeValue: Math.floor(seconds / 3600) + ':' +
        String(Math.floor(seconds % 3600 / 60)).padStart(2, '0') + ':' +
        String(seconds % 60).padStart(2, '0')
    };
    return result;
  }
  return { validate: validate, inspect: inspect, label: label };
}));