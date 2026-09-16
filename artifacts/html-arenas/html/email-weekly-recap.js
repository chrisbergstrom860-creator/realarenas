'use strict';

const { escapeHtml } = require('../email-transport');

// Email rendering deliberately reads only the immutable stored recap snapshot.
// `user` is accepted for the delivery template contract but intentionally is
// not read: retry payloads cannot vary with mutable account/profile fields.
const DEFAULT_LOGO_URL = 'https://www.realarenas.com/icons/icon-192.png';

function safeNumber(value) {
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
  const prose = String(recapRow.prose || '').trim();
  if (!prose) throw new Error('Weekly recap email requires stored prose');

  const metrics = [
    ['Sessions', metricFromStoredRecap(recapRow, 'activityCount'), ''],
    ['Hours', metricFromStoredRecap(recapRow, 'durationHours'), ' h'],
    ['Distance', metricFromStoredRecap(recapRow, 'distanceKm'), ' km'],
    // Old rows intentionally omit points. Never recompute from current data.
    ['Points', metricFromStoredRecap(recapRow, 'points'), ' pts']
  ].filter(([, value]) => value != null);
  const feeling = feelingsSummary(recapRow.chart);
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
  const feelingHtml = feeling
    ? `<p style="margin:0 0 20px;font:14px/1.5 Arial,sans-serif;color:#3f3f46">${escapeHtml(feeling)}</p>` : '';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;color:#18181b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f4f4f5"><tr><td align="center" style="padding:20px 10px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;border-collapse:collapse;background:#ffffff;border:1px solid #d4d4d8"><tr><td style="padding:24px 24px 8px"><img src="${escaped.logoUrl}" alt="Arenas" width="116" style="display:block;width:116px;height:auto;border:0"></td></tr><tr><td style="padding:16px 24px 28px"><div style="font:700 12px/1.3 Arial,sans-serif;letter-spacing:.08em;color:#a16207">WEEKLY AI RECAP</div><h1 style="margin:8px 0 4px;font:700 26px/1.2 Arial,sans-serif;color:#18181b">${escaped.range}</h1><p style="margin:0 0 22px;font:13px/1.4 Arial,sans-serif;color:#52525b">Timezone: ${escaped.timezone}</p>${metricHtml}<p style="margin:0 0 20px;font:16px/1.6 Arial,sans-serif;color:#27272a;white-space:pre-line">${escaped.prose}</p>${feelingHtml}<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 26px"><tr><td style="background:#facc15"><a href="${escaped.recapUrl}" style="display:inline-block;padding:13px 20px;font:700 14px/1 Arial,sans-serif;color:#18181b;text-decoration:none">See your full recap</a></td></tr></table><div style="padding-top:18px;border-top:1px solid #d4d4d8;font:12px/1.5 Arial,sans-serif;color:#52525b">You’re receiving this because you turned on Weekly AI recap email in Arenas. <a href="${escaped.unsubscribeUrl}" style="color:#27272a;text-decoration:underline">Unsubscribe from recap emails</a> or manage this in <a href="${escaped.settingsUrl}" style="color:#27272a;text-decoration:underline">Settings</a>. Read our <a href="${escaped.privacyUrl}" style="color:#27272a;text-decoration:underline">Privacy Policy</a>.</div></td></tr></table></td></tr></table></body></html>`;
  const metricText = metrics.map(([label, value, unit]) => `${label}: ${formatNumber(value)}${unit}`).join('\n');
  const text = `${subject}\n${range.full}\nTimezone: ${timezone}\n\n${metricText}${metricText ? '\n\n' : ''}${prose}${feeling ? `\n\n${feeling}` : ''}\n\nSee your full recap: ${recapUrl}\n\nYou’re receiving this because you turned on Weekly AI recap email in Arenas.\nUnsubscribe from recap emails: ${unsubscribeUrl}\nSettings: ${settingsUrl}\nPrivacy Policy: ${privacyUrl}`;
  return { subject, html, text };
}

module.exports = {
  DEFAULT_LOGO_URL, renderRecapEmail, escapeHtml, formatDateRange, metricFromStoredRecap, feelingsSummary
};