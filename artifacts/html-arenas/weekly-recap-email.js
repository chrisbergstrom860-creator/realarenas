'use strict';

// Delivery helpers are deliberately separate from generation. A recap email is
// rendered once, stored with the recap, and then sent from that exact byte
// string on every retry.
const { EMAIL_FROM, sendFrozenEmail } = require('./email-transport');
const { renderRecapEmail } = require('./html/email-weekly-recap');
const { signRecapEmailToken } = require('./recap-email-token');

const RECAP_EMAIL_BATCH_LIMIT = 50;
const RECAP_EMAIL_DELAY_MS = 120;
const RECAP_EMAIL_RETRY_WINDOW_REASON = 'retry window expired';
const RECAP_EMAIL_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const RECAP_EMAIL_ORIGIN = 'https://www.realarenas.com';

function asRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function userPrefs(user) {
  return user && user.user_metadata && user.user_metadata.prefs || {};
}

function recapEmailEnabled(user) {
  const prefs = userPrefs(user);
  // This dependent preference was introduced after the primary opt-in.
  // Absence means its database/UI default of true; only an explicit false
  // suppresses delivery.
  return prefs.weekly_recap === true && prefs.weekly_recap_email !== false;
}

function findingsEnvelope(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value };
  // The original recap contract persists an envelope. Preserve any older
  // array-shaped findings without editing its individual validated findings.
  return { findings: Array.isArray(value) ? value : [] };
}

function deliverySnapshot(row) {
  const envelope = findingsEnvelope(row && row.findings);
  const snapshot = envelope.emailDelivery;
  if (!snapshot || typeof snapshot !== 'object' ||
      typeof snapshot.payload !== 'string' || !snapshot.payload ||
      typeof snapshot.idempotencyKey !== 'string' || !snapshot.idempotencyKey ||
      typeof snapshot.recipient !== 'string' || !snapshot.recipient) return null;
  return snapshot;
}

function generatedIssuedAt(row) {
  // created_at is immutable for the recap row, unlike generated_at which can
  // be absent on malformed legacy data. Tokens therefore stay simple and
  // repeatable for every delivery retry.
  const value = row && row.created_at;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('Weekly recap email requires a stored created_at timestamp');
  }
  return value;
}

function canonicalLinks(row, signToken = signRecapEmailToken, origin = RECAP_EMAIL_ORIGIN) {
  const base = String(origin || RECAP_EMAIL_ORIGIN).replace(/\/+$/, '');
  const issuedAt = generatedIssuedAt(row);
  const token = signToken(row.user_id, issuedAt);
  return {
    recapUrl: `${base}/recaps/${encodeURIComponent(row.week_start)}`,
    unsubscribeUrl: `${base}/email/unsubscribe/recap?t=${encodeURIComponent(token)}`,
    settingsUrl: `${base}/profile?tab=settings`,
    privacyUrl: `${base}/privacy`,
    logoUrl: `${base}/icons/icon-192.png`
  };
}

function makeDeliverySnapshot(row, user, {
  render = renderRecapEmail,
  signToken = signRecapEmailToken,
  origin = RECAP_EMAIL_ORIGIN
} = {}) {
  if (!row || !row.id || !row.user_id || row.status !== 'generated') {
    throw new Error('Weekly recap email requires a stored generated recap');
  }
  const recipient = user && typeof user.email === 'string' ? user.email.trim() : '';
  if (!recipient) throw new Error('Weekly recap email recipient is missing');
  const links = canonicalLinks(row, signToken, origin);
  const rendered = render(row, user, links);
  if (!rendered || !rendered.subject || !rendered.html || !rendered.text) {
    throw new Error('Weekly recap email renderer returned incomplete content');
  }
  const idempotencyKey = `weekly-recap-email:${row.id}`;
  const payload = JSON.stringify({
    from: EMAIL_FROM,
    to: [recipient],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {
      'List-Unsubscribe': `<${links.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });
  return { version: 1, recipient, idempotencyKey, payload };
}

async function getWeeklyRecap(supabase, recapId) {
  const { data, error } = await supabase.from('weekly_recaps').select('*').eq('id', recapId).limit(1);
  if (error) throw new Error(`read weekly recap email failed: ${error.message}`);
  return asRow(data) || null;
}

async function persistDeliverySnapshot(supabase, row, snapshot) {
  const existing = deliverySnapshot(row);
  if (existing) return { row, snapshot: existing, persisted: false };
  const findings = { ...findingsEnvelope(row.findings), emailDelivery: snapshot };
  // Do not compare the whole JSON value: a stored chart/evidence envelope can
  // make a REST filter URL huge. The missing JSON-path filter lets exactly one
  // writer establish the immutable delivery snapshot.
  const { data, error } = await supabase.from('weekly_recaps').update({ findings })
    .eq('id', row.id).eq('status', 'generated').eq('email_status', 'pending')
    .is('email_first_attempt_at', null).is('findings->emailDelivery', null)
    .select('*');
  if (error) throw new Error(`save weekly recap email snapshot failed: ${error.message}`);
  const persisted = asRow(data);
  if (persisted && persisted.id) return { row: persisted, snapshot, persisted: true };
  const latest = await getWeeklyRecap(supabase, row.id);
  const winningSnapshot = deliverySnapshot(latest);
  if (!latest || !winningSnapshot) throw new Error('weekly recap email snapshot was not persisted');
  return { row: latest, snapshot: winningSnapshot, persisted: false };
}

async function beginWeeklyRecapEmailAttempt(supabase, recapId) {
  const { data, error } = await supabase.rpc('begin_weekly_recap_email_attempt', { p_id: recapId });
  if (error) throw new Error(`weekly recap email attempt claim failed: ${error.message}`);
  const row = asRow(data);
  return row && row.id ? row : null;
}

async function markWeeklyRecapEmail(supabase, recapId, status, messageId = null, reason = null) {
  const { data, error } = await supabase.rpc('mark_weekly_recap_email', {
    p_id: recapId,
    p_status: status,
    p_message_id: messageId,
    p_failure_reason: reason
  });
  if (error) throw new Error(`weekly recap email status update failed: ${error.message}`);
  const row = asRow(data);
  return row && row.id ? row : null;
}

async function expireRetryWindow(supabase, recapId) {
  // SQL returns a row to pending until its third failure. Repeat only while a
  // fresh read confirms this exact generated recap is still pending, so a
  // concurrent successful sender can never be overwritten.
  for (let transitions = 0; transitions < 3; transitions++) {
    const current = await getWeeklyRecap(supabase, recapId);
    if (!current || current.status !== 'generated' || current.email_status !== 'pending') return current;
    const marked = await markWeeklyRecapEmail(
      supabase, recapId, 'failed', null, RECAP_EMAIL_RETRY_WINDOW_REASON
    );
    if (!marked) return await getWeeklyRecap(supabase, recapId);
    if (marked.email_status !== 'pending' || Number(marked.email_attempts) >= 3) return marked;
  }
  throw new Error('weekly recap email retry-window expiry did not reach a terminal state');
}

function deliveryLog(logger, correlationId, recapId, emailStatus, messageId = null, reason = null) {
  logger(JSON.stringify({
    event: 'weekly_recap_email',
    correlation_id: correlationId,
    recap_id: recapId,
    email_status: emailStatus,
    ...(messageId ? { message_id: messageId } : {}),
    ...(reason ? { reason } : {})
  }));
}

async function deliverWeeklyRecapEmail({
  supabase, recap, correlationId, entitlementCheck, logger = console.log,
  dryRun = false, sender = sendFrozenEmail, render = renderRecapEmail,
  signToken = signRecapEmailToken, origin = RECAP_EMAIL_ORIGIN,
  now = () => new Date()
}) {
  if (!recap || recap.status !== 'generated') {
    return { status: 'not_pending', attempted: false };
  }
  const entitlement = await entitlementCheck(supabase, recap.user_id);
  if (!entitlement || !entitlement.eligible) {
    const reason = entitlement && entitlement.reason || 'email_not_eligible';
    if (!dryRun) await markWeeklyRecapEmail(supabase, recap.id, 'skipped', null, reason);
    deliveryLog(logger, correlationId, recap.id, 'skipped', null, reason);
    return { status: 'skipped', attempted: false, reason };
  }
  const user = entitlement.user;
  // A dry run is an operator preview, not a retry. It intentionally renders
  // today’s deterministic template from the stored recap even when delivery is
  // already sent and its immutable provider payload must never be changed.
  if (dryRun) {
    const preview = makeDeliverySnapshot(recap, user, { render, signToken, origin });
    const body = JSON.parse(preview.payload);
    deliveryLog(logger, correlationId, recap.id, 'dry_run', null);
    return { status: 'dry_run', attempted: false, subject: body.subject, text: body.text };
  }
  if (recap.email_status !== 'pending') {
    return { status: 'not_pending', attempted: false };
  }
  let snapshot = deliverySnapshot(recap);
  let stored = recap;
  const expectedKey = `weekly-recap-email:${recap.id}`;
  if (snapshot && snapshot.idempotencyKey !== expectedKey) {
    throw new Error('weekly recap email snapshot has an invalid idempotency key');
  }
  if (snapshot && snapshot.recipient !== user.email) {
    if (!dryRun) await markWeeklyRecapEmail(supabase, recap.id, 'skipped', null, 'recipient_changed');
    deliveryLog(logger, correlationId, recap.id, 'skipped', null, 'recipient_changed');
    return { status: 'skipped', attempted: false, reason: 'recipient_changed' };
  }
  if (!snapshot) {
    snapshot = makeDeliverySnapshot(recap, user, { render, signToken, origin });
    if (!dryRun) ({ row: stored, snapshot } = await persistDeliverySnapshot(supabase, recap, snapshot));
  }
  // Persisting the snapshot can take long enough for plan, preference, or
  // address changes. Recheck immediately before claiming the provider attempt.
  const freshEntitlement = await entitlementCheck(supabase, recap.user_id);
  if (!freshEntitlement || !freshEntitlement.eligible) {
    const reason = freshEntitlement && freshEntitlement.reason || 'email_not_eligible';
    await markWeeklyRecapEmail(supabase, recap.id, 'skipped', null, reason);
    deliveryLog(logger, correlationId, recap.id, 'skipped', null, reason);
    return { status: 'skipped', attempted: false, reason };
  }
  if (!freshEntitlement.user || snapshot.recipient !== freshEntitlement.user.email) {
    await markWeeklyRecapEmail(supabase, recap.id, 'skipped', null, 'recipient_changed');
    deliveryLog(logger, correlationId, recap.id, 'skipped', null, 'recipient_changed');
    return { status: 'skipped', attempted: false, reason: 'recipient_changed' };
  }
  // A CAS loser uses the winner's snapshot. Confirm its immutable recipient
  // still matches the authenticated account before any HTTP request.
  if (snapshot.recipient !== user.email) {
    await markWeeklyRecapEmail(supabase, recap.id, 'skipped', null, 'recipient_changed');
    deliveryLog(logger, correlationId, recap.id, 'skipped', null, 'recipient_changed');
    return { status: 'skipped', attempted: false, reason: 'recipient_changed' };
  }
  const begun = await beginWeeklyRecapEmailAttempt(supabase, stored.id);
  if (!begun) {
    const current = await getWeeklyRecap(supabase, stored.id);
    if (current && current.status === 'generated' && current.email_status === 'pending') {
      const expired = await expireRetryWindow(supabase, stored.id);
      deliveryLog(logger, correlationId, stored.id, expired && expired.email_status || 'failed',
        null, RECAP_EMAIL_RETRY_WINDOW_REASON);
      return {
        status: 'failed', attempted: false, reason: RECAP_EMAIL_RETRY_WINDOW_REASON,
        terminal: !!(expired && expired.email_status === 'failed'),
        attempts: expired && Number(expired.email_attempts)
      };
    }
    return { status: 'not_pending', attempted: false };
  }
  // SQL checks the retry window at claim time. Repeat it using real wall time
  // immediately before HTTP so a paused worker cannot use a stale claim.
  const firstAttemptMs = Date.parse(begun.email_first_attempt_at || '');
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Date.parse(nowValue);
  if (!Number.isFinite(firstAttemptMs) || !Number.isFinite(nowMs) ||
      nowMs - firstAttemptMs >= RECAP_EMAIL_RETRY_WINDOW_MS) {
    const expired = await expireRetryWindow(supabase, stored.id);
    deliveryLog(logger, correlationId, stored.id, expired && expired.email_status || 'failed',
      null, RECAP_EMAIL_RETRY_WINDOW_REASON);
    return {
      status: 'failed', attempted: false, reason: RECAP_EMAIL_RETRY_WINDOW_REASON,
      terminal: !!(expired && expired.email_status === 'failed'),
      attempts: expired && Number(expired.email_attempts)
    };
  }
  let result;
  try {
    result = await sender(snapshot.payload, snapshot.idempotencyKey);
  } catch (error) {
    const marked = await markWeeklyRecapEmail(supabase, stored.id, 'failed', null, 'email_send_failed');
    deliveryLog(logger, correlationId, stored.id, marked && marked.email_status || 'failed',
      null, 'email_send_failed');
    return {
      status: 'failed', attempted: true, reason: 'email_send_failed',
      terminal: marked ? marked.email_status === 'failed' :
        Number(recap.email_attempts) + 1 >= 3,
      attempts: marked && Number(marked.email_attempts)
    };
  }
  if (result && result.ok && result.id) {
    const marked = await markWeeklyRecapEmail(supabase, stored.id, 'sent', result.id, null);
    if (marked) {
      deliveryLog(logger, correlationId, stored.id, 'sent', result.id);
      return { status: 'sent', attempted: true, messageId: result.id };
    }
    // A concurrent runner may have received the same Resend-idempotent
    // response and recorded it first. Treat that durable sent row as success,
    // never as a reason to make another provider request.
    const current = await getWeeklyRecap(supabase, stored.id);
    if (current && current.email_status === 'sent' && current.email_message_id === result.id) {
      deliveryLog(logger, correlationId, stored.id, 'sent', result.id);
      return { status: 'already_sent', attempted: true, messageId: result.id };
    }
    throw new Error('weekly recap email send could not be recorded');
  }
  const reason = result && result.skipped ? 'email_provider_unavailable' : 'email_send_failed';
  const marked = await markWeeklyRecapEmail(supabase, stored.id, 'failed', null, reason);
  deliveryLog(logger, correlationId, stored.id, marked && marked.email_status || 'failed', null, reason);
  return {
    status: 'failed', attempted: true, reason,
    terminal: marked ? marked.email_status === 'failed' :
      Number(recap.email_attempts) + 1 >= 3,
    attempts: marked && Number(marked.email_attempts)
  };
}

module.exports = {
  RECAP_EMAIL_BATCH_LIMIT,
  RECAP_EMAIL_DELAY_MS,
  RECAP_EMAIL_RETRY_WINDOW_REASON,
  RECAP_EMAIL_RETRY_WINDOW_MS,
  RECAP_EMAIL_ORIGIN,
  recapEmailEnabled,
  deliverySnapshot,
  makeDeliverySnapshot,
  getWeeklyRecap,
  persistDeliverySnapshot,
  beginWeeklyRecapEmailAttempt,
  markWeeklyRecapEmail,
  expireRetryWindow,
  deliverWeeklyRecapEmail
};