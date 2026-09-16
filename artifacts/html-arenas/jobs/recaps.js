#!/usr/bin/env node
'use strict';

// A deliberately short-lived command for a future Railway Cron service. It is
// not referenced by the web-server start command and never starts Express.
const { createClient } = require('@supabase/supabase-js');
const {
  RECAP_BATCH_LIMIT, RECAP_MAX_ATTEMPTS, weeklyRecapEnabled, recapWindowFor,
  isWeeklyRecapDue, recapCorrelationId, recapUsageLog, claimWeeklyRecap,
  storeGeneratedRecap, markRecapFailed, createRecapNotification,
  sweepExpiredWeeklyRecaps
} = require('../weekly-recaps');
const {
  RECAP_EMAIL_BATCH_LIMIT, RECAP_EMAIL_DELAY_MS, recapEmailEnabled,
  deliverWeeklyRecapEmail
} = require('../weekly-recap-email');
const { renderRecapProse } = require('../recap-prose');

function parseArgs(argv) {
  const args = { dryRun: false, userId: null, now: null, sendEmailsOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--send-emails-only') args.sendEmailsOnly = true;
    else if (argv[i] === '--user-id') args.userId = argv[++i] || null;
    else if (argv[i] === '--now') args.now = argv[++i] || null;
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  if (args.now && Number.isNaN(Date.parse(args.now))) throw new Error('--now must be an ISO timestamp');
  if (args.userId && !/^[0-9a-f-]{36}$/i.test(args.userId)) throw new Error('--user-id must be a UUID');
  return args;
}

async function listAuthUsers(supabase) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`list users failed: ${error.message}`);
    users.push(...(data.users || []));
    if ((data.users || []).length < 1000) return users;
  }
}

async function recapRowsForUsers(supabase, users, now) {
  const rows = [];
  // Keep service-role REST query URLs bounded even if the Auth user list grows.
  for (let offset = 0; offset < users.length; offset += 100) {
    const chunk = users.slice(offset, offset + 100);
    const ids = chunk.map((user) => user.id);
    const weekStarts = [...new Set(chunk.map((user) => recapWindowFor(user, now).weekStart))];
    // Rows are unique by (user_id, week_start); requesting only the exact
    // local completed weeks keeps a 100-user chunk well below REST row caps.
    const { data, error } = await supabase.from('weekly_recaps')
      .select('user_id,week_start,status,attempts,lease_until')
      .in('user_id', ids).in('week_start', weekStarts);
    if (error) throw new Error(`read weekly recap eligibility rows failed: ${error.message}`);
    rows.push(...(data || []));
  }
  return rows;
}

async function listIndividualProSubscriptions(supabase, ownerId = null) {
  const subscriptions = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabase.from('subscriptions')
      .select('owner_id,plan,status').eq('owner_type', 'user').eq('plan', 'pro')
      .in('status', ['active', 'past_due']);
    if (ownerId) query = query.eq('owner_id', ownerId);
    const { data, error } = await query.order('owner_id', { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error(`read subscriptions failed: ${error.message}`);
    subscriptions.push(...(data || []));
    if ((data || []).length < 1000) return subscriptions;
  }
}

async function eligibleUsers(supabase, options, now) {
  let users;
  if (options.userId) {
    const { data, error } = await supabase.auth.admin.getUserById(options.userId);
    if (error) throw new Error(`read user failed: ${error.message}`);
    users = data && data.user ? [data.user] : [];
  } else {
    users = await listAuthUsers(supabase);
  }
  const subscriptions = await listIndividualProSubscriptions(supabase, options.userId || null);
  const proIds = new Set((subscriptions || []).map((row) => row.owner_id));
  let candidates = users.filter((user) => proIds.has(user.id) && weeklyRecapEnabled(user) &&
    (options.userId || isWeeklyRecapDue(user, now)));
  // A targeted manual run intentionally remains forced, and dry-run must show
  // what generation would validate even when this week's recap already exists.
  if (options.userId || options.dryRun || !candidates.length) {
    return candidates.slice(0, RECAP_BATCH_LIMIT);
  }
  const rows = await recapRowsForUsers(supabase, candidates, now);
  const rowByUserWeek = new Map(rows.map((row) => [`${row.user_id}:${row.week_start}`, row]));
  const wallNow = Date.now();
  candidates = candidates.filter((user) => {
    const row = rowByUserWeek.get(`${user.id}:${recapWindowFor(user, now).weekStart}`);
    if (!row) return true;
    if (row.status === 'generated') return false;
    if (Number(row.attempts) >= RECAP_MAX_ATTEMPTS) return false;
    // SQL's claim function is authoritative. This prefilter only prevents a
    // known live lease from consuming a default batch slot.
    return !(row.status === 'pending' && row.lease_until &&
      Number.isFinite(Date.parse(row.lease_until)) && Date.parse(row.lease_until) > wallNow);
  });
  return candidates.slice(0, RECAP_BATCH_LIMIT);
}

async function recheckRecapEntitlement(supabase, userId) {
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
  if (userError) throw new Error(`recheck user failed: ${userError.message}`);
  const user = userData && userData.user;
  if (!user || !weeklyRecapEnabled(user)) return { eligible: false, user: null };
  const subscriptions = await listIndividualProSubscriptions(supabase, userId);
  return { eligible: subscriptions.length > 0, user };
}

async function recheckRecapEmailEntitlement(supabase, userId) {
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
  if (userError && (Number(userError.status) === 404 || /not found/i.test(String(userError.message || '')))) {
    return { eligible: false, reason: 'account_missing', user: null };
  }
  if (userError) throw new Error(`recheck email user failed: ${userError.message}`);
  const user = userData && userData.user;
  if (!user) return { eligible: false, reason: 'account_missing', user: null };
  if (!weeklyRecapEnabled(user)) return { eligible: false, reason: 'recap_preference_disabled', user };
  if (!recapEmailEnabled(user)) return { eligible: false, reason: 'email_preference_disabled', user };
  if (typeof user.email !== 'string' || !user.email.trim()) {
    return { eligible: false, reason: 'account_email_missing', user };
  }
  const subscriptions = await listIndividualProSubscriptions(supabase, userId);
  if (!subscriptions.length) return { eligible: false, reason: 'pro_required', user };
  return { eligible: true, user };
}

async function listPendingRecapEmails(supabase, userId = null, batchLimit = RECAP_EMAIL_BATCH_LIMIT, previewAll = false) {
  const rows = [];
  // Fetch short pages rather than a single unbounded REST response. We retain
  // at most one invocation's worth of candidates; future runs continue below.
  for (let offset = 0; rows.length < batchLimit; offset += 100) {
    let query = supabase.from('weekly_recaps').select('*').eq('status', 'generated');
    if (!previewAll) query = query.eq('email_status', 'pending').lt('email_attempts', 3);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.order('generated_at', { ascending: true }).range(offset, offset + 99);
    if (error) throw new Error(`read pending weekly recap emails failed: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < 100) break;
  }
  return rows.slice(0, batchLimit);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactRecapEmailDryRunText(value) {
  // The body is intentionally printed for an operator to review, but an
  // unsubscribe token is an authentication credential and must not reach logs.
  return typeof value === 'string'
    ? value.replace(/(\/email\/unsubscribe\/recap\?t=)[^\s<]+/g, '$1[redacted]')
    : null;
}

async function processPendingRecapEmails(supabase, {
  userId = null, dryRun = false, logger = console.log,
  emailEntitlementCheck = recheckRecapEmailEntitlement,
  emailDelivery = deliverWeeklyRecapEmail,
  wait = sleep
} = {}) {
  const recaps = await listPendingRecapEmails(supabase, userId, RECAP_EMAIL_BATCH_LIMIT, dryRun);
  const results = [];
  let sends = 0;
  for (const recap of recaps) {
    if (sends >= RECAP_EMAIL_BATCH_LIMIT) break;
    const result = await emailDelivery({
      supabase, recap, correlationId: recapCorrelationId(), dryRun, logger,
      entitlementCheck: emailEntitlementCheck
    });
    results.push({ recapId: recap.id, ...result });
    if (result.attempted) {
      sends++;
      // Include failed sends; this is a provider request pacing limit, not a
      // successful-delivery limit. No sleep follows the last eligible send.
      if (sends < RECAP_EMAIL_BATCH_LIMIT) await wait(RECAP_EMAIL_DELAY_MS);
    }
  }
  return results;
}

function logRun(logger, correlationId, status, usage, reason = null) {
  const safeUsage = recapUsageLog('', usage, correlationId);
  logger(JSON.stringify({
    event: safeUsage.event, kind: 'recap', correlation_id: correlationId, status,
    input_tokens: safeUsage.input_tokens,
    cache_creation_input_tokens: safeUsage.cache_creation_input_tokens,
    cache_read_input_tokens: safeUsage.cache_read_input_tokens,
    output_tokens: safeUsage.output_tokens, estimated_cost_usd: safeUsage.estimated_cost_usd,
    ...(reason ? { reason } : {})
  }));
  return safeUsage;
}

async function recordModelFailure(supabase, claim, error, usage, logger, correlationId, reason) {
  // This deliberately records only provider/validation failures. Database,
  // auth, claim, finish, and notification errors remain command failures.
  try {
    await markRecapFailed(supabase, claim, String(error && error.message || error));
  } catch (recordError) {
    logRun(logger, correlationId, 'infrastructure_failure', usage);
    throw recordError;
  }
  logRun(logger, correlationId, 'model_or_validation_failed', usage, reason);
  return { status: 'failed', correlationId, error, reason };
}

async function failClaimAfterInfrastructure(supabase, claim, originalError, usage, logger, correlationId, reason) {
  // A claim exists but no generated recap has been stored yet. Best-effort
  // failure recording keeps retry state truthful; the original infrastructure
  // error remains the command failure even if the fail RPC also has trouble.
  let terminalReason = reason;
  try {
    await markRecapFailed(supabase, claim, reason);
  } catch (failureError) {
    terminalReason = `${reason}_fail_recording_failed`;
  }
  logRun(logger, correlationId, 'infrastructure_failure', usage, terminalReason);
  throw originalError;
}

async function runOne({
  supabase, service, user, now, dryRun, logger = console.log,
  leaseNow = null, entitlementCheck = recheckRecapEntitlement
}) {
  const correlationId = recapCorrelationId();
  const window = { userId: user.id, ...recapWindowFor(user, now) };
  // A dry run must not claim, finish/fail, notify, or run retention. It still
  // exercises the same current-entitlement, context, provider, and validation
  // path as a real invocation.
  let beforeGeneration;
  try {
    beforeGeneration = await entitlementCheck(supabase, user.id);
  } catch (error) {
    logRun(logger, correlationId, 'infrastructure_failure', null);
    throw error;
  }
  if (!beforeGeneration.eligible) {
    logRun(logger, correlationId, 'skipped_ineligible', null);
    return { status: 'skipped_ineligible', correlationId };
  }
  let claim;
  if (!dryRun) {
    // --now is solely a deterministic control for eligibility/context. The
    // lease must be tied to actual wall clock because SQL verifies it against
    // now(), and the precise returned value is echoed to finish/fail.
    try {
      claim = await claimWeeklyRecap(supabase, window, leaseNow || new Date());
    } catch (error) {
      logRun(logger, correlationId, 'infrastructure_failure', null);
      throw error;
    }
    if (!claim) {
      logRun(logger, correlationId, 'skipped_claimed', null);
      return { status: 'skipped_claimed', correlationId };
    }
    if (claim.attempts > RECAP_MAX_ATTEMPTS) {
      logRun(logger, correlationId, 'skipped_attempt_limit', null);
      return { status: 'skipped_attempt_limit', correlationId };
    }
  }
  let context;
  try {
    context = await service.buildContextForUser(user.id, window.contextAsOf);
  } catch (error) {
    if (!dryRun && claim) {
      return failClaimAfterInfrastructure(supabase, claim, error, null, logger, correlationId, 'context_build_failed');
    }
    logRun(logger, correlationId, 'infrastructure_failure', null, 'context_build_failed');
    throw error;
  }
  let output;
  try {
    output = await service.runValidatedRequest(context, 'recap', { correlationId });
  } catch (error) {
    // Keep this lazy: --send-emails-only must not import any AI module.
    const { AiProviderConfigurationError } = require('../ai-insights');
    const configurationFailure = error instanceof AiProviderConfigurationError ||
      (error && error.name === 'AiProviderConfigurationError');
    if (configurationFailure) {
      if (!dryRun && claim) {
        return failClaimAfterInfrastructure(supabase, claim, error, null, logger, correlationId,
          'provider_configuration_failed');
      }
      logRun(logger, correlationId, 'infrastructure_failure', null, 'provider_configuration_failed');
      throw error;
    }
    if (dryRun) {
      logRun(logger, correlationId, 'dry_run_model_or_validation_failed', null);
      return { status: 'failed', correlationId, error };
    }
    return recordModelFailure(supabase, claim, error, null, logger, correlationId, 'provider_request_failed');
  }
  const validated = output && output.validated;
  if (!validated || !validated.ok || !Array.isArray(output.findings) ||
      typeof output.answer !== 'string' || !output.answer.trim() ||
      !Array.isArray(validated.limitations) || !Array.isArray(validated.evidence)) {
    const reason = (validated && typeof validated.reason === 'string' && validated.reason) ||
      'missing_complete_typed_output';
    const error = new Error(`recap validation failed: ${reason}`);
    if (dryRun) {
      logRun(logger, correlationId, 'dry_run_model_or_validation_failed', output && output.usage, reason);
      return { status: 'failed', correlationId, error, reason };
    }
    return recordModelFailure(supabase, claim, error, output && output.usage, logger, correlationId, reason);
  }
  const usageLog = recapUsageLog('', output.usage, correlationId);
  if (dryRun) {
    logRun(logger, correlationId, 'dry_run_validated', output.usage);
    return { status: 'dry_run_validated', correlationId, context, validated, usage: usageLog };
  }

  let beforeStore;
  try {
    beforeStore = await entitlementCheck(supabase, user.id);
  } catch (error) {
    return failClaimAfterInfrastructure(supabase, claim, error, output.usage, logger, correlationId,
      'prestore_entitlement_recheck_failed');
  }
  if (!beforeStore.eligible) {
    try {
      await markRecapFailed(supabase, claim, 'weekly recap entitlement changed before storage');
    } catch (error) {
      logRun(logger, correlationId, 'infrastructure_failure', output.usage);
      throw error;
    }
    logRun(logger, correlationId, 'skipped_ineligible_before_store', output.usage);
    return { status: 'skipped_ineligible', correlationId };
  }
  let stored;
  try {
    const recapFindings = {
      findings: output.findings,
      limitations: validated.limitations,
      evidence: validated.evidence
    };
    const deterministicProse = renderRecapProse(recapFindings, {
      weekStart: window.weekStart,
      timezone: window.timezone,
      chart: output.chart || validated.chart || null,
      storedProse: output.answer
    });
    stored = await storeGeneratedRecap(supabase, claim, {
      answer: deterministicProse,
      findings: recapFindings,
      chart: output.chart || validated.chart || null,
      contextSchemaVersion: context.schemaVersion
    });
  } catch (error) {
    return failClaimAfterInfrastructure(supabase, claim, error, output.usage, logger, correlationId, 'finish_rpc_failed');
  }
  if (!stored) {
    logRun(logger, correlationId, 'lost_lease_before_store', output.usage);
    return { status: 'lost_lease', correlationId };
  }
  let beforeNotification;
  try {
    beforeNotification = await entitlementCheck(supabase, user.id);
  } catch (error) {
    logRun(logger, correlationId, 'infrastructure_failure', output.usage);
    throw error;
  }
  if (!beforeNotification.eligible) {
    logRun(logger, correlationId, 'generated_unnotified_ineligible', output.usage);
    return { status: 'generated_unnotified', correlationId, stored, validated, usage: usageLog };
  }
  try {
    await createRecapNotification(supabase, user.id, window.weekStart);
  } catch (error) {
    // The recap is already durable. Never turn it back into failed or call the
    // model again; the recovery pass will upsert the stable notification key.
    logRun(logger, correlationId, 'notification_failed', output.usage);
    return { status: 'notification_failed', correlationId, stored, error };
  }
  logRun(logger, correlationId, 'generated', output.usage);
  return { status: 'generated', correlationId, stored, validated, usage: usageLog };
}

async function recoverGeneratedNotifications(supabase, logger = console.log, entitlementCheck = recheckRecapEntitlement, userId = null) {
  let query = supabase.from('weekly_recaps').select('user_id,week_start').eq('status', 'generated');
  if (userId) query = query.eq('user_id', userId);
  const { data: recaps, error } = await query.limit(RECAP_BATCH_LIMIT);
  if (error) throw new Error(`read generated weekly recaps failed: ${error.message}`);
  const results = [];
  for (const recap of (recaps || [])) {
    const correlationId = recapCorrelationId();
    let entitlement;
    try {
      entitlement = await entitlementCheck(supabase, recap.user_id);
    } catch (error) {
      logRun(logger, correlationId, 'infrastructure_failure', null);
      throw error;
    }
    if (!entitlement.eligible) {
      logRun(logger, correlationId, 'recovery_skipped_ineligible', null);
      results.push({ status: 'skipped_ineligible', correlationId });
      continue;
    }
    const sourceKey = `weekly-recap:${recap.week_start}`;
    const { data: existing, error: notificationReadError } = await supabase.from('notifications')
      .select('id').eq('user_id', recap.user_id).eq('source_key', sourceKey).limit(1);
    if (notificationReadError) {
      logRun(logger, correlationId, 'infrastructure_failure', null);
      throw new Error(`read recap notification failed: ${notificationReadError.message}`);
    }
    if (Array.isArray(existing) && existing.length) {
      logRun(logger, correlationId, 'recovery_already_notified', null);
      results.push({ status: 'already_notified', correlationId });
      continue;
    }
    try {
      await createRecapNotification(supabase, recap.user_id, recap.week_start);
      logRun(logger, correlationId, 'recovery_notified', null);
      results.push({ status: 'notified', correlationId });
    } catch (notificationError) {
      logRun(logger, correlationId, 'recovery_notification_failed', null);
      results.push({ status: 'notification_failed', correlationId, error: notificationError });
    }
  }
  return results;
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  const now = options.now ? new Date(options.now) : new Date();
  const supabase = dependencies.supabase || createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '', {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const logger = dependencies.logger || console.log;
  const emailOptions = {
    userId: options.userId, dryRun: options.dryRun, logger,
    emailEntitlementCheck: dependencies.emailEntitlementCheck || recheckRecapEmailEntitlement,
    emailDelivery: dependencies.emailDelivery || deliverWeeklyRecapEmail,
    wait: dependencies.wait || sleep
  };
  if (options.sendEmailsOnly) {
    // Do not load the AI service or build context in email-only mode.
    const emails = await processPendingRecapEmails(supabase, emailOptions);
    if (options.dryRun) {
      logger(JSON.stringify({
        event: 'weekly_recap_email_dry_run_result', kind: 'recap',
        results: emails.map(({ recapId, status, subject, text, reason }) => ({
          recap_id: recapId, status, subject: subject || null,
          text: redactRecapEmailDryRunText(text), reason: reason || null
        }))
      }));
    }
    return { results: [], recoveries: [], emails };
  }
  // Kept lazy so --send-emails-only never imports or calls AI generation.
  const service = dependencies.service || require('../ai-insights-service');
  const recoveries = options.dryRun ? [] : await recoverGeneratedNotifications(supabase, logger, recheckRecapEntitlement, options.userId);
  const users = await eligibleUsers(supabase, options, now);
  const results = [];
  for (const user of users) {
    results.push(await runOne({ supabase, service, user, now, dryRun: options.dryRun, logger }));
  }
  // Includes rows created in this invocation plus older generated/pending rows.
  // A dry run only renders the stored template and cannot mutate or send.
  const emails = options.dryRun ? [] : await processPendingRecapEmails(supabase, emailOptions);
  if (!options.dryRun) await sweepExpiredWeeklyRecaps(supabase);
  // Provider/validation failures are recorded per user and do not make the
  // batch itself an infrastructure failure. An uncaught auth/database/config
  // failure reaches the command wrapper and exits non-zero.
  if (results.some((result) => result.status === 'notification_failed') ||
      recoveries.some((result) => result.status === 'notification_failed')) {
    throw new Error('weekly recap notification delivery failed; generated recap will be retried');
  }
  const summary = { results, recoveries, emails };
  if (options.dryRun) {
    logger(JSON.stringify({
      event: 'weekly_recap_dry_run_result', kind: 'recap',
      results: results.map((result) => ({
        status: result.status, correlation_id: result.correlationId,
        validated: result.validated || null, reason: result.reason || null
      }))
    }));
  }
  return summary;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: 'weekly_recap_runner', status: 'infrastructure_failure', error: String(error.message || error).slice(0, 200) }));
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs, listAuthUsers, listIndividualProSubscriptions, recapRowsForUsers,
  eligibleUsers, recheckRecapEntitlement, recheckRecapEmailEntitlement,
  listPendingRecapEmails, processPendingRecapEmails, sleep, redactRecapEmailDryRunText,
  recoverGeneratedNotifications, runOne, main
};