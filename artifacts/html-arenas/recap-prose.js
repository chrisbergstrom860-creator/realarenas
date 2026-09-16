'use strict';

const { dayKey } = require('./tzdate');

// Weekly recap prose is deliberately derived only from the validated finding
// snapshot and its stored chart. It never consults current activities, goals,
// or account metadata: historical recaps must remain historically faithful.

function finiteNumber(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundOne(value) {
  const number = finiteNumber(value);
  if (number == null) return null;
  const rounded = Math.round((number + Number.EPSILON) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatNumber(value) {
  const rounded = roundOne(value);
  if (rounded == null) return null;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatDeltaHours(value) {
  const delta = finiteNumber(value);
  const magnitude = delta == null ? null : roundOne(Math.abs(delta));
  if (magnitude == null || magnitude === 0) return 'the same as the week before';
  const direction = delta > 0 ? 'more' : 'less';
  return `${magnitude === 1 ? 'about an hour' : `${magnitude.toFixed(1)} hours`} ${direction} than the week before`;
}

function dateFromKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatWeekRange(weekStart) {
  const start = dateFromKey(weekStart);
  if (!start) return null;
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 6);
  const part = (date, includeMonth) => date.toLocaleDateString('en-US', {
    month: includeMonth ? 'short' : undefined, day: 'numeric', timeZone: 'UTC'
  });
  return `${part(start, true)}–${part(end, start.getUTCMonth() !== end.getUTCMonth())}`;
}

function envelopeFor(findings) {
  if (Array.isArray(findings)) return { findings };
  return findings && typeof findings === 'object' ? findings : {};
}

function typedFindings(findings) {
  if (Array.isArray(findings)) return findings;
  if (!findings || typeof findings !== 'object' ||
      !Object.prototype.hasOwnProperty.call(findings, 'findings') ||
      findings.findings == null) return null;
  if (!Array.isArray(findings.findings)) {
    throw new Error('Weekly recap findings must be an array when present');
  }
  return findings.findings;
}

function storedEvidence(findings) {
  const value = envelopeFor(findings).evidence;
  return Array.isArray(value) ? value : [];
}

function metricValue(findings, suffix) {
  const finding = typedFindings(findings).find((item) => item && item.type === 'metric' &&
    typeof item.path === 'string' &&
    /^last12Weeks\.weekly\.\d+\.(activityCount|durationHours|distanceKm|points)$/.test(item.path) &&
    item.path.endsWith(`.${suffix}`));
  if (!finding) return null;
  const direct = finiteNumber(finding.value);
  if (direct != null) return direct;
  const evidence = storedEvidence(findings).find((item) => item && item.path === finding.path);
  return evidence ? finiteNumber(evidence.value) : null;
}

function comparisonDelta(findings) {
  const finding = typedFindings(findings).find((item) => item && item.type === 'comparison' &&
    /\.durationHours$/.test(String(item.leftPath || '')) &&
    /\.durationHours$/.test(String(item.rightPath || '')));
  if (!finding) return null;
  const explicit = finiteNumber(finding.delta != null ? finding.delta :
    finding.value && finding.value.delta);
  if (explicit != null) return explicit;
  // Canonical validated comparisons retain the two operands rather than a
  // separate delta. Derive only this permitted comparison difference from
  // those immutable values, never from current activities.
  const left = finiteNumber(finding.leftValue);
  const right = finiteNumber(finding.rightValue);
  return left != null && right != null ? left - right : null;
}

function hasInsufficientTrendData(findings) {
  return Array.isArray(envelopeFor(findings).limitations) &&
    envelopeFor(findings).limitations.includes('INSUFFICIENT_TREND_DATA');
}

function feelingLabels(chart) {
  if (!chart || chart.metric !== 'feelings' || !Array.isArray(chart.series)) return [];
  return chart.series.map((series) => {
    const total = (Array.isArray(series && series.values) ? series.values : [])
      .reduce((sum, value) => sum + (finiteNumber(value) || 0), 0);
    return { label: String(series && series.label || '').trim(), total };
  }).filter((entry) => entry.label && entry.total > 0)
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, 2).map((entry) => entry.label.toLowerCase());
}

function goalSentence(findings) {
  const finding = typedFindings(findings).find((item) => item && item.type === 'goal_projection' &&
    item.value && typeof item.value === 'object');
  const goal = finding && finding.value;
  if (!goal || typeof goal.sport !== 'string' || !goal.sport.trim() ||
      typeof goal.type !== 'string' || !goal.type.trim() ||
      typeof goal.period !== 'string' || !goal.period.trim() ||
      !goal.target || typeof goal.target !== 'object' ||
      finiteNumber(goal.target.value) == null || typeof goal.target.unit !== 'string' ||
      !goal.target.unit.trim() || typeof goal.onTrack !== 'boolean') return null;
  const period = {
    daily: 'day',
    weekly: 'week',
    monthly: 'month',
    yearly: 'year',
    annual: 'year'
  }[goal.period.trim().toLowerCase()] || goal.period.trim();
  return `Your ${goal.sport.trim()} ${goal.type.trim()} goal (${formatNumber(goal.target.value)} ${goal.target.unit.trim()} per ${period}) is ${goal.onTrack ? 'on track' : 'behind pace'} for this period.`;
}

function calendarEvidenceDayKey(value, timezone) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const key = dayKey(raw, timezone || 'UTC');
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

function calendarCount(findings, finding, recapMeta = {}) {
  const isPlan = finding.type === 'calendar_plan_list';
  if (typeof finding.path !== 'string' || !finding.filter ||
      typeof finding.filter.month !== 'string' || !/^\d{4}-\d{2}$/.test(finding.filter.month)) return null;
  const collection = isPlan ? 'calendar.plannedSessions' : 'calendar.events';
  const countKey = isPlan ? 'plannedCount' : 'count';
  const evidence = storedEvidence(findings);
  const summary = evidence.find((item) => item && typeof item.path === 'string' &&
    item.path.startsWith(`${collection}.byMonth.`) && item.value &&
    item.value.month === finding.filter.month);
  const total = summary && finiteNumber(summary.value[countKey]);
  if (total == null || total < 0 || !Number.isInteger(total)) return null;
  const weekStart = dateFromKey(recapMeta.weekStart || recapMeta.week_start);
  if (!weekStart) return null;
  const comingStart = new Date(weekStart.getTime());
  comingStart.setUTCDate(comingStart.getUTCDate() + 7);
  const comingEnd = new Date(comingStart.getTime());
  comingEnd.setUTCDate(comingEnd.getUTCDate() + 7);
  const itemPrefix = `${finding.path}.`;
  const items = evidence.filter((item) => item && typeof item.path === 'string' &&
    item.path.startsWith(itemPrefix) && item.value && typeof item.value === 'object');
  const withinComingWeek = (item) => {
    const key = calendarEvidenceDayKey(item.value.date, recapMeta.timezone);
    if (!key || key.slice(0, 7) !== finding.filter.month) return false;
    const date = dateFromKey(key);
    return date && date >= comingStart && date < comingEnd &&
      (!isPlan || item.value.status === 'planned');
  };
  // The canonical list finding carries no value. Q&A evidence includes at
  // most ten individually rendered items, but its validated month summary
  // remains authoritative when that source month was not truncated. The recap
  // validator has already verified every matching context item is in this
  // coming week; still reject incomplete capture, source truncation, or an
  // out-of-window captured item rather than misreporting a whole-month count.
  if (total === 0) return 0;
  const expectedCaptured = Math.min(total, 10);
  return summary.value.truncated !== true && items.length >= expectedCaptured &&
    items.length <= total && items.every(withinComingWeek) ? total : null;
}

function calendarSentence(findings, recapMeta = {}) {
  const finding = typedFindings(findings).find((item) => item &&
    (item.type === 'calendar_plan_list' || item.type === 'calendar_event_list'));
  if (!finding) return null;
  const count = calendarCount(findings, finding, recapMeta);
  if (count == null) return null;
  const noun = finding.type === 'calendar_plan_list' ? 'planned session' : 'event';
  return `Coming up this week: ${count} ${noun}${count === 1 ? '' : 's'}.`;
}

function renderRecapProse(findings, recapMeta = {}) {
  const fallback = String(recapMeta.storedProse || recapMeta.prose || '').trim();
  const typed = typedFindings(findings);
  if (!typed || !typed.length) return fallback;
  const sessions = metricValue(findings, 'activityCount');
  const range = formatWeekRange(recapMeta.weekStart || recapMeta.week_start);
  if (sessions == null) throw new Error('Weekly recap findings are missing the required session metric');
  if (range == null) throw new Error('Weekly recap findings require a valid week start');
  const hours = metricValue(findings, 'durationHours');
  const distance = metricValue(findings, 'distanceKm');
  const points = metricValue(findings, 'points');
  let quantities = `${formatNumber(sessions)} session${roundOne(sessions) === 1 ? '' : 's'}`;
  if (hours != null) quantities += `, ${formatNumber(hours)} hour${roundOne(hours) === 1 ? '' : 's'}`;
  if (distance != null) quantities += ` and ${formatNumber(distance)} km`;
  if (points != null) quantities += ` for ${formatNumber(points)} points`;
  let first = `Last week (${range}) you logged ${quantities}`;
  const delta = hasInsufficientTrendData(findings) ? null : comparisonDelta(findings);
  if (delta != null) first += ` — ${formatDeltaHours(delta)}`;
  const sentences = [`${first}.`];
  const feelings = feelingLabels(recapMeta.chart);
  if (feelings.length) sentences.push(`Most of your sessions felt ${feelings.join(' or ')}.`);
  const goal = goalSentence(findings);
  if (goal) sentences.push(goal);
  const calendar = calendarSentence(findings, recapMeta);
  if (calendar) sentences.push(calendar);
  return sentences.slice(0, 4).join(' ');
}

module.exports = {
  renderRecapProse, formatWeekRange, formatDeltaHours, metricValue,
  comparisonDelta, feelingLabels, goalSentence, calendarSentence
};