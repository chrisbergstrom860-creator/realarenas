'use strict';

// Shared runner/server helpers. This module deliberately has no Express or
// provider imports, so it can be unit-tested and used by a short-lived job.
const crypto = require('crypto');
const { getUserTimezone, dateParts, weekStartKey, zoneMidnightUtc } = require('./tzdate');
const { buildAiInsightsUsageLog, WEEKLY_RECAP_CONTRACT_VERSION } = require('./ai-insights');

const RECAP_LEASE_SECONDS = 10 * 60;
const RECAP_MAX_ATTEMPTS = 3;
const RECAP_BATCH_LIMIT = 50;
const RECAP_RETENTION_DAYS = 90;

function weeklyRecapEnabled(user) {
  return !!(user && user.user_metadata && user.user_metadata.prefs &&
    user.user_metadata.prefs.weekly_recap === true);
}

function recapWindowFor(user, now = new Date()) {
  const timezone = getUserTimezone(user);
  const latestMonday = weekStartKey(now, timezone);
  const weekStart = weekStartKey(now, timezone, 1);
  return {
    timezone,
    weekStart,
    windowStartUtc: zoneMidnightUtc(weekStart, timezone).toISOString(),
    windowEndUtc: zoneMidnightUtc(latestMonday, timezone).toISOString(),
    // Building at local Monday midnight intentionally makes the context's
    // relative=last_week bucket exactly the completed week being recapped.
    contextAsOf: zoneMidnightUtc(latestMonday, timezone)
  };
}

function isWeeklyRecapDue(user, now = new Date()) {
  if (!weeklyRecapEnabled(user)) return false;
  const tz = getUserTimezone(user);
  const local = dateParts(now, tz);
  // A missed Monday run must catch up for the most recently completed week
  // through Sunday. The following week's recap remains ineligible until its
  // own local Monday 08:00 boundary.
  return !!local && (local.weekday > 1 || (local.weekday === 1 && local.hour >= 8));
}

function recapCorrelationId() {
  return crypto.randomUUID();
}

function recapUsageLog(userId, usage, correlationId) {
  return {
    ...buildAiInsightsUsageLog(userId, 0, usage),
    kind: 'recap',
    correlation_id: correlationId
  };
}

async function claimWeeklyRecap(supabase, window, now = new Date()) {
  const leaseUntil = new Date(now.getTime() + RECAP_LEASE_SECONDS * 1000).toISOString();
  const { data, error } = await supabase.rpc('claim_weekly_recap', {
    p_user_id: window.userId,
    p_week_start: window.weekStart,
    p_timezone: window.timezone,
    p_window_start_utc: window.windowStartUtc,
    p_window_end_utc: window.windowEndUtc,
    p_lease_until: leaseUntil
  });
  if (error) throw new Error(`weekly recap claim failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  // PostgreSQL composite-returning RPCs can be encoded as `{ id: null, ... }`
  // when an UPDATE ... RETURNING matched no row. Treat that as no claim, not
  // as a writable lease.
  if (!row || !row.id) return null;
  if (typeof row.lease_until !== 'string' || !row.lease_until) {
    throw new Error('weekly recap claim returned an invalid lease');
  }
  return row;
}

async function storeGeneratedRecap(supabase, claim, result) {
  const { data, error } = await supabase.rpc('finish_weekly_recap', {
    p_id: claim.id,
    p_lease_until: claim.lease_until,
    p_findings: result.findings,
    p_prose: result.answer,
    p_chart: result.chart || null,
    p_context_schema_version: result.contextSchemaVersion,
    p_contract_version: WEEKLY_RECAP_CONTRACT_VERSION
  });
  if (error) throw new Error(`weekly recap store failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row && row.id ? row : null;
}

async function markRecapFailed(supabase, claim, reason) {
  const { error } = await supabase.rpc('fail_weekly_recap', {
    p_id: claim.id,
    p_lease_until: claim.lease_until,
    p_failure_reason: String(reason || 'generation failed').slice(0, 500)
  });
  if (error) throw new Error(`weekly recap failure recording failed: ${error.message}`);
}

async function createRecapNotification(supabase, userId, weekStart) {
  const { error } = await supabase.from('notifications').upsert({
    user_id: userId,
    type: 'recap',
    title: 'Your weekly AI recap is ready',
    body: 'Your previous week’s training summary is ready to view.',
    link: `/recaps/${weekStart}`,
    read: false,
    source_key: `weekly-recap:${weekStart}`
  }, { onConflict: 'user_id,source_key', ignoreDuplicates: true });
  if (error) throw new Error(`weekly recap notification failed: ${error.message}`);
}

async function sweepExpiredWeeklyRecaps(supabase) {
  const { error } = await supabase.rpc('delete_expired_weekly_recaps');
  if (error) throw new Error(`weekly recap retention sweep failed: ${error.message}`);
}

module.exports = {
  RECAP_LEASE_SECONDS,
  RECAP_MAX_ATTEMPTS,
  RECAP_BATCH_LIMIT,
  RECAP_RETENTION_DAYS,
  weeklyRecapEnabled,
  recapWindowFor,
  isWeeklyRecapDue,
  recapCorrelationId,
  recapUsageLog,
  claimWeeklyRecap,
  storeGeneratedRecap,
  markRecapFailed,
  createRecapNotification,
  sweepExpiredWeeklyRecaps
};