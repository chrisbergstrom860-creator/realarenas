'use strict';

// Alert state is independent of the recap row: retention of a recap must not
// erase the idempotency record for an uncertain provider delivery.
const { EMAIL_FROM, escapeHtml, sendFrozenEmail } = require('./email-transport');

const FOUNDER_ID = '4e3cd18f-2c09-4ce9-ada1-67fbe725fcd4';
const ALERT_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

function alertKey(userId, weekStart, kind) {
  return `recap-alert:${kind}:${userId}:${weekStart}`;
}

async function recordAlert(supabase, { userId, weekStart, kind, reason }) {
  if (!['generation', 'email'].includes(kind)) throw new Error('Invalid recap alert kind');
  const key = alertKey(userId, weekStart, kind);
  // Notification upsert is repeatable, including after a crash between the
  // notification and provider request. Never include a person's name.
  const { error: notificationError } = await supabase.from('notifications').upsert({
    user_id: FOUNDER_ID, type: 'recap_alert',
    title: `Weekly recap ${kind} failure`,
    body: `Affected user: ${userId}; week_start: ${weekStart}; reason: ${reason}`,
    link: null, read: false, source_key: key
  }, { onConflict: 'user_id,source_key', ignoreDuplicates: true });
  if (notificationError) throw new Error(`recap alert notification failed: ${notificationError.message}`);

  const { data: founder, error: authError } = await supabase.auth.admin.getUserById(FOUNDER_ID);
  if (authError || !founder || !founder.user || !founder.user.email) {
    throw new Error(`recap alert founder address unavailable${authError ? `: ${authError.message}` : ''}`);
  }
  const recipient = founder.user.email.trim();
  const subject = `Weekly recap failure — ${weekStart}`;
  const text = `Weekly recap ${kind} failure\nAffected user: ${userId}\nweek_start: ${weekStart}\nreason: ${reason}`;
  const payload = JSON.stringify({
    from: EMAIL_FROM, to: [recipient], subject,
    text, html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`
  });
  // First writer freezes the complete provider request. Changes to founder
  // address, reason or template never alter an in-flight retry.
  const { error: insertError } = await supabase.from('recap_failure_alerts').upsert({
    affected_user_id: userId, week_start: weekStart, kind,
    payload, recipient
  }, { onConflict: 'affected_user_id,week_start,kind', ignoreDuplicates: true });
  if (insertError) throw new Error(`recap alert snapshot failed: ${insertError.message}`);
  return key;
}

async function deliverAlert(supabase, { userId, weekStart, kind }, sender = sendFrozenEmail) {
  const { data, error } = await supabase.rpc('claim_recap_failure_alert', {
    p_user_id: userId, p_week_start: weekStart, p_kind: kind
  });
  if (error) throw new Error(`recap alert claim failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.affected_user_id) return { status: 'not_claimed' };
  // Check again immediately before HTTP after an arbitrarily slow claim.
  if (Date.now() - Date.parse(row.first_attempt_at) >= ALERT_RETRY_WINDOW_MS) {
    return { status: 'retry_window_expired' };
  }
  const result = await sender(row.payload, alertKey(userId, weekStart, kind));
  if (!result || !result.ok || !result.id) {
    // Keep the record claimable inside the provider window; uncertain sends
    // only repeat with the same frozen payload and stable provider key.
    throw new Error('recap alert provider delivery failed');
  }
  const { data: completed, error: finishError } = await supabase.from('recap_failure_alerts')
    .update({ message_id: result.id, lease_until: null })
    .eq('affected_user_id', userId).eq('week_start', weekStart).eq('kind', kind)
    .is('message_id', null).select('message_id');
  if (finishError) throw new Error(`recap alert delivery recording failed: ${finishError.message}`);
  if (!Array.isArray(completed) || !completed.length) return { status: 'already_sent' };
  return { status: 'sent', messageId: result.id };
}

async function sendRecapFailureAlert(supabase, failure, sender) {
  await recordAlert(supabase, failure);
  return deliverAlert(supabase, failure, sender);
}

async function recoverRecapFailureAlerts(supabase, {
  userId = null, onResult = null, sender, shouldContinue = () => true
} = {}) {
  // Recover both crashed notification attempts and failed provider sends.
  // An already-recorded email is never sent again; the durable alert table is
  // the authority for delivery after the recap itself ages out.
  const results = [];
  const batchLimit = 50;
  for (let offset = 0; results.length < batchLimit && shouldContinue(); offset += 100) {
    let query = supabase.from('weekly_recaps').select('user_id,week_start,status,attempts,failure_reason,email_status,email_failure_reason')
      .or('and(status.eq.failed,attempts.gte.3),email_status.eq.failed');
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.order('week_start').range(offset, offset + 99);
    if (error) throw new Error(`recap alert recovery failed: ${error.message}`);
    for (const row of data || []) {
      if (results.length >= batchLimit || !shouldContinue()) break;
      const failures = [];
      if (row.status === 'failed' && Number(row.attempts) >= 3) {
        let reason = row.failure_reason || 'generation_failed';
        try { reason = JSON.parse(reason).reason || reason; } catch (_) { /* legacy reason */ }
        failures.push({ userId: row.user_id, weekStart: row.week_start, kind: 'generation', reason });
      }
      if (row.email_status === 'failed') {
        failures.push({ userId: row.user_id, weekStart: row.week_start, kind: 'email',
          reason: row.email_failure_reason || 'email_delivery_failed' });
      }
      for (const failure of failures) {
        if (results.length >= batchLimit || !shouldContinue()) break;
        // Old terminal rows may precede newer failures. Skip completed
        // snapshots without consuming the capped work budget.
        const { data: existing, error: readError } = await supabase.from('recap_failure_alerts')
          .select('message_id,first_attempt_at').eq('affected_user_id', failure.userId)
          .eq('week_start', failure.weekStart).eq('kind', failure.kind).limit(1);
        if (readError) throw new Error(`read recap alert delivery failed: ${readError.message}`);
        const snapshot = existing && existing[0];
        if (snapshot && (snapshot.message_id ||
            (snapshot.first_attempt_at &&
              Date.now() - Date.parse(snapshot.first_attempt_at) >= ALERT_RETRY_WINDOW_MS))) continue;
        const result = await sendRecapFailureAlert(supabase, failure, sender);
        results.push(result);
        if (onResult) onResult(result);
      }
    }
    if (!data || data.length < 100) break;
  }
  // A frozen request survives the 90-day recap purge. Recover a crash after
  // snapshot persistence even when no recap row remains.
  if (results.length >= batchLimit || !shouldContinue()) return results;
  let pending = supabase.from('recap_failure_alerts')
    .select('affected_user_id,week_start,kind').is('message_id', null)
    .or(`first_attempt_at.is.null,first_attempt_at.gt.${new Date(Date.now() - ALERT_RETRY_WINDOW_MS).toISOString()}`);
  if (userId) pending = pending.eq('affected_user_id', userId);
  const { data: snapshots, error: snapshotError } = await pending.limit(batchLimit - results.length);
  if (snapshotError) throw new Error(`recap alert snapshot recovery failed: ${snapshotError.message}`);
  for (const snapshot of snapshots || []) {
    if (results.length >= batchLimit || !shouldContinue()) break;
    const result = await deliverAlert(supabase, {
      userId: snapshot.affected_user_id, weekStart: snapshot.week_start, kind: snapshot.kind
    }, sender);
    results.push(result);
    if (onResult) onResult(result);
  }
  return results;
}

module.exports = {
  FOUNDER_ID, ALERT_RETRY_WINDOW_MS, alertKey, recordAlert, deliverAlert,
  sendRecapFailureAlert, recoverRecapFailureAlerts
};