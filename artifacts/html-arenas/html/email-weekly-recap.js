'use strict';

const { escapeHtml } = require('../email-transport');
const { renderRecapProse } = require('../recap-prose');

// Email rendering deliberately reads only the immutable stored recap snapshot.
// `user` is accepted for the delivery template contract but intentionally is
// not read: retry payloads cannot vary with mutable account/profile fields.
const DEFAULT_LOGO_URL = 'https://www.realarenas.com/icons/icon-192.png';

function safeNumber(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function formatNumber(value) {
  const number = safeNumber(value);
  if (number == null) return null;
  if (Math.abs(number - Math.round(number)) < 0.000001) return String(Math.round(number));
  return number.toFixed(1).replace(/\.0$/, '');
}

function dateFromKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDateRange(weekStart) {
  const start = dateFromKey(weekStart);
  if (!start) return { short: 'Your training week', full: 'Your training week' };
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 6);
  const shortPart = (date, includeMonth) => date.toLocaleDateString('en-US', {
    month: includeMonth ? 'short' : undefined, day: 'numeric', timeZone: 'UTC'
  });
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  return {
    short: `${shortPart(start, true)}–${shortPart(end, !sameMonth)}`,
    full: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} – ` +
      end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  };
}

function storedFindings(recapRow) {
  const envelope = recapRow && recapRow.findings;
  return envelope && Array.isArray(envelope.findings) ? envelope.findings : [];
}

function storedEvidence(recapRow) {
  const envelope = recapRow && recapRow.findings;
  return envelope && Array.isArray(envelope.evidence) ? envelope.evidence : [];
}

function metricFromStoredRecap(recapRow, suffix) {
  // Select the validated metric finding first. In particular, do not look for
  // a matching suffix across arbitrary evidence: a comparison includes the
  // previous week and must never be used as this email's headline metric.
  const metric = storedFindings(recapRow).find((finding) => finding &&
    finding.type === 'metric' && typeof finding.path === 'string' &&
    /^last12Weeks\.weekly\.\d+\.(activityCount|durationHours|distanceKm|points)$/.test(finding.path) &&
    finding.path.endsWith(`.${suffix}`));
  if (!metric) return null;
  const metricValue = safeNumber(metric.value);
  if (metricValue != null) return metricValue;
  const evidence = storedEvidence(recapRow);
  const matching = evidence.find((item) => item && item.path === metric.path);
  return matching ? safeNumber(matching.value) : null;
}

function feelingsSummary(chart) {
  if (!chart || chart.metric !== 'feelings' || !Array.isArray(chart.series)) return null;
  const parts = chart.series.map((series) => {
    const values = series && Array.isArray(series.values) ? series.values : [];
    const total = values.reduce((sum, value) => sum + (safeNumber(value) || 0), 0);
    return { label: String(series && series.label || ''), total };
  }).filter((item) => item.label && item.total > 0);
  if (!parts.length) return null;
  parts.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const top = parts.slice(0, 2).map((item) => `${item.label.toLowerCase()} (${formatNumber(item.total)})`);
  const title = String(chart.title || 'Feelings over the last 12 weeks');
  return `${title}: your most recorded feelings were ${top.join(' and ')}.`;
}

function requireLink(links, key, fallback = null) {
  const value = links && links[key];
  if ((value == null || value === '') && fallback) return fallback;
  if (typeof value !== 'string' || !/^https?:\/\//.test(value)) {
    throw new Error(`Weekly recap email requires an absolute ${key} link`);
  }
  return value;
}

function storedAmount(value, description) {
  const number = safeNumber(value);
  if (number == null) throw new Error(`Weekly recap email has invalid stored ${description}`);
  return number;
}

function storedColor(value) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(value) ||
      ![3, 4, 6, 8].includes(value.length - 1)) {
    throw new Error('Weekly recap email has invalid stored sport color');
  }
  return value;
}

function formatHours(value) {
  return value > 0 && value < 0.05 ? String(Number(value.toPrecision(2))) : formatNumber(value);
}

function sportSplitLine(item) {
  const sessions = storedAmount(item.sessions, 'sport sessions');
  const hours = storedAmount(item.hours, 'sport hours');
  const km = storedAmount(item.km, 'sport distance');
  const label = String(item.label == null ? '' : item.label);
  return `${label} — ${formatNumber(sessions)} ${sessions === 1 ? 'session' : 'sessions'}, ${formatHours(hours)} h${km > 0 ? `, ${formatNumber(km)} km` : ''}`;
}

function storedExtras(chart) {
  return chart && chart.extras && typeof chart.extras === 'object' ? chart.extras : null;
}

function renderSportSplit(extras) {
  if (!extras || !Array.isArray(extras.sportSplit) || !extras.sportSplit.length) return { html: '', text: '' };
  const lines = extras.sportSplit.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Weekly recap email has invalid stored sport split');
    const color = storedColor(item.color);
    const line = sportSplitLine(item);
    return { color, line };
  });
  return {
    html: `<div style="margin:0 0 24px"><div style="font:700 14px/1.4 Arial,sans-serif;color:#18181b;margin-bottom:8px">Last week by sport</div>${lines.map(({ color, line }) =>
      `<div style="font:13px/1.5 Arial,sans-serif;color:#3f3f46;padding:3px 0;overflow-wrap:anywhere"><span style="display:inline-block;width:9px;height:9px;background-color:${color};margin-right:7px"></span>${escapeHtml(line)}</div>`
    ).join('')}</div>`,
    text: `Last week by sport\n${lines.map(({ line }) => line).join('\n')}`
  };
}

function renderHoursChart(extras, weekStart) {
  if (!extras || !extras.hoursBySport) return { html: '', text: '' };
  const chart = extras.hoursBySport;
  if (!Array.isArray(chart.labels) || chart.labels.length !== 11 ||
      !Array.isArray(chart.relative) || chart.relative.length !== 11 ||
      chart.relative[10] !== 'last_week' || chart.relative.includes('this_week') ||
      chart.labels[10] !== weekStart ||
      !Array.isArray(chart.totals) || chart.totals.length !== 11 ||
      !Array.isArray(chart.series)) {
    throw new Error('Weekly recap email requires 11 stored hours-by-sport weeks ending at the recap week');
  }
  const dates = chart.labels.map((key) => {
    const date = dateFromKey(key);
    if (!date || date.toISOString().slice(0, 10) !== key) {
      throw new Error('Weekly recap email has invalid stored week start');
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  });
  const totals = chart.totals.map((value) => storedAmount(value, 'weekly total'));
  const series = chart.series.map((item) => {
    if (!item || !Array.isArray(item.values) || item.values.length !== 11) {
      throw new Error('Weekly recap email requires 11 stored sport values');
    }
    return {
      color: storedColor(item.color),
      label: String(item.label == null ? '' : item.label),
      values: item.values.map((value) => storedAmount(value, 'sport hours'))
    };
  });
  const max = Math.max(0, ...totals);
  if (max === 0 && series.some((item) => item.values.some((value) => value > 0))) {
    throw new Error('Weekly recap email has inconsistent stored weekly totals');
  }
  const cells = dates.map((date, index) => {
    const segments = series.map((item) => {
      const hours = item.values[index];
      return hours > 0
        ? `<div style="height:${Math.max(2, Math.round(96 * hours / max))}px;background-color:${item.color};font-size:0;line-height:0"></div>`
        : '';
    }).join('');
    return `<td width="9.09%" valign="bottom" style="width:9.09%;height:96px;padding:0 1px;vertical-align:bottom;border-bottom:1px solid #d4d4d8" title="${escapeHtml(`${date}: ${formatHours(totals[index])} h`)}">${segments}</td>`;
  }).join('');
  const labels = dates.map((date, index) =>
    `<td width="9.09%" style="width:9.09%;padding:5px 0 0;text-align:center;vertical-align:top;font:9px/1.2 Arial,sans-serif;color:#71717a"><span${index % 2 ? ' class="recap-week-label-odd" style="display:none"' : ''}>${escapeHtml(date)}</span></td>`
  ).join('');
  const legend = series.map(({ color, label }) =>
    `<span style="display:inline-block;margin:0 12px 5px 0;font:11px/1.4 Arial,sans-serif;color:#52525b;overflow-wrap:anywhere"><span style="display:inline-block;width:9px;height:9px;margin-right:4px;background-color:${color}"></span>${escapeHtml(label)}</span>`
  ).join('');
  const end = dateFromKey(weekStart);
  end.setUTCDate(end.getUTCDate() + 6);
  const title = `Hours per week — 11 weeks to ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  return {
    html: `<div style="margin:0 0 24px"><div style="font:700 14px/1.4 Arial,sans-serif;color:#18181b;margin-bottom:12px">${title}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;border-collapse:collapse"><tr>${cells}</tr><tr>${labels}</tr></table><div style="padding-top:12px">${legend}</div></div>`,
    text: `${title}\n${dates.map((date, index) => `${date}: ${formatHours(totals[index])} h`).join('\n')}`
  };
}

function renderRecapEmail(recapRow, user, links) { // eslint-disable-line no-unused-vars
  if (!recapRow || recapRow.status !== 'generated') {
    throw new Error('Weekly recap email requires a generated recap row');
  }
  const range = formatDateRange(recapRow.week_start);
  const recapUrl = requireLink(links, 'recapUrl');
  const unsubscribeUrl = requireLink(links, 'unsubscribeUrl');
  const settingsUrl = requireLink(links, 'settingsUrl');
  const privacyUrl = requireLink(links, 'privacyUrl');
  const logoUrl = requireLink(links, 'logoUrl', DEFAULT_LOGO_URL);
  const timezone = String(recapRow.timezone || 'UTC');
  const prose = renderRecapProse(recapRow.findings, {
    weekStart: recapRow.week_start,
    timezone,
    chart: recapRow.chart,
    storedProse: recapRow.prose
  });
  if (!prose) throw new Error('Weekly recap email requires stored prose');

  const metrics = [
    ['Sessions', metricFromStoredRecap(recapRow, 'activityCount'), ''],
    ['Hours', metricFromStoredRecap(recapRow, 'durationHours'), ' h'],
    ['Distance', metricFromStoredRecap(recapRow, 'distanceKm'), ' km'],
    // Old rows intentionally omit points. Never recompute from current data.
    ['Points', metricFromStoredRecap(recapRow, 'points'), ' pts']
  ].filter(([, value]) => value != null);
  const extras = storedExtras(recapRow.chart);
  const sportSplit = renderSportSplit(extras);
  const hoursChart = renderHoursChart(extras, recapRow.week_start);
  const subject = `Your week in training — ${range.short}`;
  const escaped = {
    subject: escapeHtml(subject), range: escapeHtml(range.full),
    timezone: escapeHtml(timezone), prose: escapeHtml(prose),
    recapUrl: escapeHtml(recapUrl), unsubscribeUrl: escapeHtml(unsubscribeUrl),
    settingsUrl: escapeHtml(settingsUrl), privacyUrl: escapeHtml(privacyUrl), logoUrl: escapeHtml(logoUrl)
  };
  const metricHtml = metrics.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 24px"><tr>${
      metrics.map(([label, value, unit]) => `<td style="width:${(100 / metrics.length).toFixed(2)}%;padding:12px 6px;border:1px solid #d4d4d8;background:#f8fafc;text-align:center"><div style="font:700 20px/1.2 Arial,sans-serif;color:#18181b">${escapeHtml(formatNumber(value) + unit)}</div><div style="margin-top:4px;font:12px/1.3 Arial,sans-serif;color:#52525b">${escapeHtml(label)}</div></td>`).join('')
    }</tr></table>` : '';
  const html = `<!doctype html><html><head><style>@media screen and (min-width:480px){.recap-week-label-odd{display:inline!important}}</style></head><body style="margin:0;padding:0;background:#f4f4f5;color:#18181b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f4f4f5"><tr><td align="center" style="padding:20px 10px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;border-collapse:collapse;background:#ffffff;border:1px solid #d4d4d8"><tr><td style="padding:24px 24px 8px"><img src="${escaped.logoUrl}" alt="Arenas" width="116" style="display:block;width:116px;height:auto;border:0"></td></tr><tr><td style="padding:16px 24px 28px"><div style="font:700 12px/1.3 Arial,sans-serif;letter-spacing:.08em;color:#a16207">WEEKLY AI RECAP</div><h1 style="margin:8px 0 4px;font:700 26px/1.2 Arial,sans-serif;color:#18181b">${escaped.range}</h1><p style="margin:0 0 22px;font:13px/1.4 Arial,sans-serif;color:#52525b">Timezone: ${escaped.timezone}</p>${metricHtml}${sportSplit.html}<p style="margin:0 0 20px;font:16px/1.6 Arial,sans-serif;color:#27272a;white-space:pre-line">${escaped.prose}</p>${hoursChart.html}<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 26px"><tr><td style="background:#facc15"><a href="${escaped.recapUrl}" style="display:inline-block;padding:13px 20px;font:700 14px/1 Arial,sans-serif;color:#18181b;text-decoration:none">See your full recap</a></td></tr></table><div style="padding-top:18px;border-top:1px solid #d4d4d8;font:12px/1.5 Arial,sans-serif;color:#52525b">You’re receiving this because you turned on Weekly AI recap email in Arenas. <a href="${escaped.unsubscribeUrl}" style="color:#27272a;text-decoration:underline">Unsubscribe from recap emails</a> or manage this in <a href="${escaped.settingsUrl}" style="color:#27272a;text-decoration:underline">Settings</a>. Read our <a href="${escaped.privacyUrl}" style="color:#27272a;text-decoration:underline">Privacy Policy</a>.</div></td></tr></table></td></tr></table></body></html>`;
  const metricText = metrics.map(([label, value, unit]) => `${label}: ${formatNumber(value)}${unit}`).join('\n');
  const text = `${subject}\n${range.full}\nTimezone: ${timezone}\n\n${metricText}${metricText ? '\n\n' : ''}${sportSplit.text ? `${sportSplit.text}\n\n` : ''}${prose}${hoursChart.text ? `\n\n${hoursChart.text}` : ''}\n\nSee your full recap: ${recapUrl}\n\nYou’re receiving this because you turned on Weekly AI recap email in Arenas.\nUnsubscribe from recap emails: ${unsubscribeUrl}\nSettings: ${settingsUrl}\nPrivacy Policy: ${privacyUrl}`;
  return { subject, html, text };
}

module.exports = {
  DEFAULT_LOGO_URL, renderRecapEmail, escapeHtml, formatDateRange, metricFromStoredRecap, feelingsSummary
};