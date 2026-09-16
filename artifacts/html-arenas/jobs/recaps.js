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
  deliverWeeklyRecapEmail, RECAP_EMAIL_ORIGIN
} = require('../weekly-recap-email');
const { renderRecapProse } = require('../recap-prose');

const SOFT_RUNTIME_LIMIT_MS = 4 * 60 * 1000;
const HARD_RUNTIME_LIMIT_MS = 5 * 60 * 1000;
const HARD_RUNTIME_HEADROOM_MS = 1000;
const REQUIRED_RUNNER_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'SESSION_SECRET',
  'PUBLIC_BASE_URL'
];

function monotonicMilliseconds() {
  return Number(process.hrtime.bigint() / 1000000n);
}

function createRuntimeBudget({
  monotonicNow = monotonicMilliseconds,
  startedAt = new Date().toISOString(),
  tickId = recapCorrelationId()
} = {}) {
  const startedMono = monotonicNow();
  return {
    startedAt,
    tickId,
    counters: {
      eligible: 0, generated: 0, generation_failed: 0,
      emails_sent: 0, emails_skipped: 0, emails_failed: 0,
      retention_deleted: 0, provider_cost_usd: 0
    },
    summaryLogged: false,
    elapsedMs() {
      return Math.max(0, monotonicNow() - startedMono);
    },
    pastSoftLimit() {
      return this.elapsedMs() > SOFT_RUNTIME_LIMIT_MS;
    }
  };
}

function hardWatchdogDelayMs(processUptime = () => process.uptime()) {
  const uptimeSeconds = Number(processUptime());
  const bootstrapMs = Number.isFinite(uptimeSeconds) && uptimeSeconds > 0
    ? Math.ceil(uptimeSeconds * 1000)
    : 0;
  return Math.max(0, HARD_RUNTIME_LIMIT_MS - HARD_RUNTIME_HEADROOM_MS - bootstrapMs);
}

function runnerEnabled(env = process.env) {
  return env.RECAP_RUNNER_ENABLED === 'true';
}

function hasValue(env, name) {
  return typeof env[name] === 'string' && env[name].trim() !== '';
}

function isRailwayEnvironment(env = process.env) {
  return Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);
}

function providerEnvironmentMissing(env = process.env) {
  // Keep this in lockstep with resolveAnthropicProvider in ai-insights.js:
  // Railway's deployed boundary requires the direct key, while local Replit
  // runs may use the complete integration proxy pair.
  if (isRailwayEnvironment(env)) {
    return hasValue(env, 'ANTHROPIC_API_KEY') ? [] : ['ANTHROPIC_API_KEY'];
  }
  const proxyKey = hasValue(env, 'AI_INTEGRATIONS_ANTHROPIC_API_KEY');
  const proxyBase = hasValue(env, 'AI_INTEGRATIONS_ANTHROPIC_BASE_URL');
  if (proxyKey && proxyBase) return [];
  if (proxyKey || proxyBase) {
    return [proxyKey
      ? 'AI_INTEGRATIONS_ANTHROPIC_BASE_URL'
      : 'AI_INTEGRATIONS_ANTHROPIC_API_KEY'];
  }
  if (hasValue(env, 'ANTHROPIC_API_KEY')) return [];
  // The local Replit proxy is the other existing provider boundary. With no
  // proxy variables at all, report the native fallback name.
  return ['ANTHROPIC_API_KEY'];
}

function runnerProviderConfig(env = process.env) {
  if (isRailwayEnvironment(env)) {
    return hasValue(env, 'ANTHROPIC_API_KEY')
      ? { provider: 'anthropic-direct', apiKey: env.ANTHROPIC_API_KEY.trim() }
      : null;
  }
  if (hasValue(env, 'AI_INTEGRATIONS_ANTHROPIC_API_KEY') &&
      hasValue(env, 'AI_INTEGRATIONS_ANTHROPIC_BASE_URL')) {
    return {
      provider: 'replit-ai-integrations',
      apiKey: env.AI_INTEGRATIONS_ANTHROPIC_API_KEY.trim(),
      baseURL: env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL.trim()
    };
  }
  if (hasValue(env, 'AI_INTEGRATIONS_ANTHROPIC_API_KEY') ||
      hasValue(env, 'AI_INTEGRATIONS_ANTHROPIC_BASE_URL')) return null;
  if (hasValue(env, 'ANTHROPIC_API_KEY')) {
    return { provider: 'anthropic-direct', apiKey: env.ANTHROPIC_API_KEY.trim() };
  }
  return null;
}

function validPublicBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      !!parsed.hostname && !parsed.username && !parsed.password &&
      !parsed.search && !parsed.hash;
  } catch (error) {
    return false;
  }
}

function missingRunnerEnvironment(env = process.env) {
  const missing = REQUIRED_RUNNER_ENV.filter((name) => !hasValue(env, name));
  missing.push(...providerEnvironmentMissing(env));
  if (hasValue(env, 'PUBLIC_BASE_URL') && !validPublicBaseUrl(env.PUBLIC_BASE_URL)) {
    // Keep diagnostics to variable names; never echo a malformed value.
    missing.push('PUBLIC_BASE_URL');
  }
  return [...new Set(missing)];
}

function runnerOrigin(env = process.env) {
  if (!validPublicBaseUrl(env.PUBLIC_BASE_URL)) {
    throw new Error('PUBLIC_BASE_URL is not a valid absolute URL');
  }
  return env.PUBLIC_BASE_URL.trim().replace(/\/+$/, '');
}

function logWarning(logger, correlationId, event, reason, extra = {}) {
  logger(JSON.stringify({
    event, kind: 'recap', level: 'warn',
    correlation_id: correlationId, reason, ...extra
  }));
}

function generationAttemptsAtLimit(claim) {
  return !!claim && Number(claim.attempts) >= RECAP_MAX_ATTEMPTS;
}

function summarizeResult(runtime, result) {
  if (!result) return;
  if (result.status === 'failed') runtime.counters.generation_failed++;
}

function summarizeEmail(runtime, result) {
  if (!result) return;
  if (result.status === 'sent' || result.status === 'already_sent') runtime.counters.emails_sent++;
  else if (result.status === 'skipped') runtime.counters.emails_skipped++;
  else if (result.status === 'failed') runtime.counters.emails_failed++;
}

function summarizeUsage(runtime, usage) {
  const cost = usage && Number(usage.estimated_cost_usd);
  if (Number.isFinite(cost) && cost >= 0) runtime.counters.provider_cost_usd += cost;
}

function emitSummary(runtime, logger) {
  if (!runtime || runtime.summaryLogged) return null;
  runtime.summaryLogged = true;
  const summary = {
    event: 'weekly_recap_tick_summary',
    kind: 'recap',
    tick_id: runtime.tickId,
    started_at: runtime.startedAt,
    duration_ms: Math.round(runtime.elapsedMs()),
    ...runtime.counters,
    provider_cost_usd: Number(runtime.counters.provider_cost_usd.toFixed(6))
  };
  logger(JSON.stringify(summary));
  return summary;
}

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

async function listAuthUsers(supabase, { shouldContinue = null } = {}) {
  const users = [];
  for (let page = 1; ; page++) {
    if (shouldContinue && !shouldContinue()) return users;
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`list users failed: ${error.message}`);
    const pageUsers = data.users || [];
    if (shouldContinue && !shouldContinue()) return users;
    users.push(...pageUsers);
    if (pageUsers.length < 1000) return users;
  }
}

async function recapRowsForUsers(supabase, users, now, { shouldContinue = null } = {}) {
  const rows = [];
  // Keep service-role REST query URLs bounded even if the Auth user list grows.
  for (let offset = 0; offset < users.length; offset += 100) {
    if (shouldContinue && !shouldContinue()) return rows;
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

async function listIndividualProSubscriptions(supabase, ownerId = null, { shouldContinue = null } = {}) {
  const subscriptions = [];
  for (let offset = 0; ; offset += 1000) {
    if (shouldContinue && !shouldContinue()) return subscriptions;
    let query = supabase.from('subscriptions')
      .select('owner_id,plan,status').eq('owner_type', 'user').eq('plan', 'pro')
      .in('status', ['active', 'past_due']);
    if (ownerId) query = query.eq('owner_id', ownerId);
    const { data, error } = await query.order('owner_id', { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error(`read subscriptions failed: ${error.message}`);
    const page = data || [];
    if (shouldContinue && !shouldContinue()) return subscriptions;
    subscriptions.push(...page);
    if (page.length < 1000) return subscriptions;
  }
}

async function eligibleUsers(supabase, options, now) {
  const shouldContinue = options.shouldContinue || (options.budget && (() => !options.budget.pastSoftLimit()));
  if (shouldContinue && !shouldContinue()) return [];
  let users;
  if (options.userId) {
    const { data, error } = await supabase.auth.admin.getUserById(options.userId);
    if (error) throw new Error(`read user failed: ${error.message}`);
    users = data && data.user ? [data.user] : [];
  } else {
    users = await listAuthUsers(supabase, { shouldContinue });
  }
  if (shouldContinue && !shouldContinue()) return [];
  const subscriptions = await listIndividualProSubscriptions(supabase, options.userId || null, { shouldContinue });
  if (shouldContinue && !shouldContinue()) return [];
  const proIds = new Set((subscriptions || []).map((row) => row.owner_id));
  let candidates = users.filter((user) => proIds.has(user.id) && weeklyRecapEnabled(user) &&
    (options.userId || isWeeklyRecapDue(user, now)));
  // A targeted manual run intentionally remains forced, and dry-run must show
  // what generation would validate even when this week's recap already exists.
  if (options.userId || options.dryRun || !candidates.length) {
    return candidates.slice(0, RECAP_BATCH_LIMIT);
  }
  const rows = await recapRowsForUsers(supabase, candidates, now, { shouldContinue });
  if (shouldContinue && !shouldContinue()) return [];
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

async function listPendingRecapEmails(
  supabase, userId = null, batchLimit = RECAP_EMAIL_BATCH_LIMIT, previewAll = false,
  { shouldContinue = null } = {}
) {
  const rows = [];
  // Fetch short pages rather than a single unbounded REST response. We retain
  // at most one invocation's worth of candidates; future runs continue below.
  for (let offset = 0; rows.length < batchLimit; offset += 100) {
    if (shouldContinue && !shouldContinue()) return rows;
    let query = supabase.from('weekly_recaps').select('*').eq('status', 'generated');
    if (!previewAll) query = query.eq('email_status', 'pending').lt('email_attempts', 3);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.order('generated_at', { ascending: true }).range(offset, offset + 99);
    if (error) throw new Error(`read pending weekly recap emails failed: ${error.message}`);
    const page = data || [];
    if (shouldContinue && !shouldContinue()) return rows;
    rows.push(...page);
    if (page.length < 100) break;
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
  wait = sleep, shouldContinue = null, origin = RECAP_EMAIL_ORIGIN,
  onEmailResult = null
} = {}) {
  const recaps = await listPendingRecapEmails(
    supabase, userId, RECAP_EMAIL_BATCH_LIMIT, dryRun, { shouldContinue }
  );
  const results = [];
  let sends = 0;
  for (const recap of recaps) {
    if (sends >= RECAP_EMAIL_BATCH_LIMIT) break;
    // An email row is a unit of user work. Once the soft budget expires, do
    // not begin another provider attempt; the pending row remains for a later
    // tick and any existing database lease is left untouched.
    if (shouldContinue && !shouldContinue()) break;
    const correlationId = recapCorrelationId();
    const result = await emailDelivery({
      supabase, recap, correlationId, dryRun, logger,
      entitlementCheck: emailEntitlementCheck, origin
    });
    const emailResult = { recapId: recap.id, correlationId, ...result };
    results.push(emailResult);
    // Report each completed row before pacing or any later row can hang or
    // throw. The caller must not need the whole batch to update its summary.
    if (onEmailResult) onEmailResult(emailResult);
    if (result.terminal) {
      logWarning(logger, correlationId, 'weekly_recap_terminal_failure',
        result.reason || 'email_delivery_failed', { recap_id: recap.id });
    }
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
  if (generationAttemptsAtLimit(claim)) {
    logWarning(logger, correlationId, 'weekly_recap_generation_terminal_failure', reason, {
      attempts: Number(claim.attempts)
    });
  }
  const usageLog = logRun(logger, correlationId, 'model_or_validation_failed', usage, reason);
  return { status: 'failed', correlationId, error, reason, usage: usageLog };
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
  if (generationAttemptsAtLimit(claim)) {
    logWarning(logger, correlationId, 'weekly_recap_generation_terminal_failure', reason, {
      attempts: Number(claim.attempts)
    });
  }
  logRun(logger, correlationId, 'infrastructure_failure', usage, terminalReason);
  throw originalError;
}

async function runOne({
  supabase, service, user, now, dryRun, logger = console.log,
  leaseNow = null, entitlementCheck = recheckRecapEntitlement,
  providerConfig = null, onUsage = null, onGenerated = null
}) {
  const correlationId = recapCorrelationId();
  const window = { userId: user.id, ...recapWindowFor(user, now) };
  let usageReported = false;
  let generatedReported = false;
  const reportUsage = (usage) => {
    if (usageReported) return;
    usageReported = true;
    if (onUsage) onUsage(usage);
  };
  const reportGenerated = (stored) => {
    if (generatedReported) return;
    generatedReported = true;
    if (onGenerated) onGenerated(stored);
  };
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
    output = await service.runValidatedRequest(context, 'recap', {
      correlationId, ...(providerConfig ? { providerConfig } : {})
    });
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
  // Account provider usage before validation or any post-provider database
  // work. A later store/entitlement/notification failure must not erase the
  // cost of a response that was already received.
  const usageLog = recapUsageLog('', output && output.usage, correlationId);
  reportUsage(usageLog);
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
    if (generationAttemptsAtLimit(claim)) {
      logWarning(logger, correlationId, 'weekly_recap_generation_terminal_failure',
        'weekly recap entitlement changed before storage', {
          attempts: Number(claim.attempts)
        });
    }
    return { status: 'skipped_ineligible', correlationId, usage: usageLog };
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
    if (generationAttemptsAtLimit(claim)) {
      logWarning(logger, correlationId, 'weekly_recap_generation_terminal_failure',
        'lost_lease_before_store', { attempts: Number(claim.attempts) });
    }
    return { status: 'lost_lease', correlationId, usage: usageLog };
  }
  // The finish RPC returned a durable row. Count generation before any
  // post-store entitlement or notification operation can fail or hang.
  reportGenerated(stored);
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
    return { status: 'notification_failed', correlationId, stored, error, usage: usageLog };
  }
  logRun(logger, correlationId, 'generated', output.usage);
  if (generationAttemptsAtLimit(claim)) {
    logWarning(logger, correlationId, 'weekly_recap_generation_terminal_failure',
      'generation_attempts_reached_limit', { attempts: Number(claim.attempts) });
  }
  return { status: 'generated', correlationId, stored, validated, usage: usageLog };
}

async function recoverGeneratedNotifications(
  supabase, logger = console.log, entitlementCheck = recheckRecapEntitlement,
  userId = null, { shouldContinue = null } = {}
) {
  if (shouldContinue && !shouldContinue()) return [];
  let query = supabase.from('weekly_recaps').select('user_id,week_start').eq('status', 'generated');
  if (userId) query = query.eq('user_id', userId);
  const { data: recaps, error } = await query.limit(RECAP_BATCH_LIMIT);
  if (error) throw new Error(`read generated weekly recaps failed: ${error.message}`);
  const results = [];
  for (const recap of (recaps || [])) {
    if (shouldContinue && !shouldContinue()) break;
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
  const env = dependencies.env || process.env;
  const runtime = dependencies.runtime || createRuntimeBudget({
    monotonicNow: dependencies.monotonicNow,
    startedAt: dependencies.startedAt
  });
  const logger = dependencies.logger || console.log;
  const supabase = dependencies.supabase || createClient(env.SUPABASE_URL || '', env.SUPABASE_SERVICE_ROLE_KEY || '', {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const shouldContinue = () => !runtime.pastSoftLimit();
  const origin = dependencies.emailOrigin ||
    (validPublicBaseUrl(env.PUBLIC_BASE_URL) ? runnerOrigin(env) : RECAP_EMAIL_ORIGIN);
  const providerConfig = dependencies.providerConfig || runnerProviderConfig(env);
  const emailOptions = {
    userId: options.userId, dryRun: options.dryRun, logger,
    emailEntitlementCheck: dependencies.emailEntitlementCheck || recheckRecapEmailEntitlement,
    emailDelivery: dependencies.emailDelivery || deliverWeeklyRecapEmail,
    wait: dependencies.wait || sleep,
    shouldContinue,
    origin,
    onEmailResult: (result) => summarizeEmail(runtime, result)
  };
  try {
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

    // Retention is deliberately first. A database error here prevents any
    // generation or provider work in this tick.
    if (!options.dryRun) {
      runtime.counters.retention_deleted = await sweepExpiredWeeklyRecaps(supabase);
    }

    // Kept lazy so --send-emails-only never imports or calls AI generation.
    const service = dependencies.service || require('../ai-insights-service');
    const recoveries = options.dryRun ? [] : await recoverGeneratedNotifications(
      supabase, logger, recheckRecapEntitlement, options.userId, { shouldContinue }
    );
    const users = await eligibleUsers(supabase, {
      ...options, budget: runtime, shouldContinue
    }, now);
    runtime.counters.eligible = users.length;
    const results = [];
    for (const user of users) {
      // Enumeration or a prior user can consume the soft budget while this
      // loop is awaiting work; do not begin another user's work after it.
      if (!shouldContinue()) break;
      const result = await runOne({
        supabase, service, user, now, dryRun: options.dryRun, logger, providerConfig,
        onUsage: (usage) => summarizeUsage(runtime, usage),
        onGenerated: () => { runtime.counters.generated++; }
      });
      results.push(result);
      summarizeResult(runtime, result);
    }
    // Includes rows created in this invocation plus older generated/pending
    // rows. A dry run only renders the stored template and cannot mutate/send.
    const emails = options.dryRun ? [] : await processPendingRecapEmails(supabase, emailOptions);
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
  } finally {
    if (!options.dryRun) emitSummary(runtime, logger);
  }
}

async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const env = dependencies.env || process.env;
  const logger = dependencies.logger || console.log;
  // This check intentionally precedes argument parsing, client construction,
  // and every other operation that could touch the database. In particular,
  // manual flags cannot bypass the deployment kill switch.
  if (!runnerEnabled(env)) {
    logger(JSON.stringify({ event: 'weekly_recap_runner', status: 'disabled' }));
    return 0;
  }
  const missing = missingRunnerEnvironment(env);
  if (missing.length) {
    logger(JSON.stringify({
      event: 'weekly_recap_runner', status: 'configuration_failure', missing
    }));
    return 2;
  }

  const runtime = dependencies.runtime || createRuntimeBudget({
    monotonicNow: dependencies.monotonicNow,
    startedAt: dependencies.startedAt
  });
  const schedule = dependencies.setTimeout || setTimeout;
  const cancel = dependencies.clearTimeout || clearTimeout;
  const exit = dependencies.exit || ((code) => process.exit(code));
  const tick = dependencies.runMain || main;
  let watchdogExited = false;
  const watchdog = schedule(() => {
    watchdogExited = true;
    // A hung promise cannot be awaited safely. Emit the completed-work
    // counters, leave any in-flight DB lease alone, and terminate at the
    // hard wall-clock boundary.
    try { emitSummary(runtime, logger); } finally { exit(0); }
  }, hardWatchdogDelayMs(dependencies.processUptime));
  try {
    await tick(argv, { ...dependencies, env, runtime, logger });
    return 0;
  } catch (error) {
    if (!watchdogExited) {
      logger(JSON.stringify({
        event: 'weekly_recap_runner',
        status: 'infrastructure_failure',
        error: 'runner failed'
      }));
    }
    return 1;
  } finally {
    if (!watchdogExited) cancel(watchdog);
  }
}

function installFatalHandlers({
  logger = console.error, exit = (code) => process.exit(code)
} = {}) {
  let fatalHandled = false;
  const fatal = () => {
    if (fatalHandled) return;
    fatalHandled = true;
    logger(JSON.stringify({
      event: 'weekly_recap_runner', status: 'fatal', error: 'runner failed'
    }));
    exit(1);
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);
  return fatal;
}

if (require.main === module) {
  const fatal = installFatalHandlers();
  runCli().then((code) => { process.exitCode = code; }).catch(fatal);
}

module.exports = {
  SOFT_RUNTIME_LIMIT_MS, HARD_RUNTIME_LIMIT_MS, HARD_RUNTIME_HEADROOM_MS,
  REQUIRED_RUNNER_ENV, createRuntimeBudget, hardWatchdogDelayMs, runnerEnabled,
  isRailwayEnvironment,
  providerEnvironmentMissing, runnerProviderConfig,
  validPublicBaseUrl, missingRunnerEnvironment, runnerOrigin, emitSummary,
  installFatalHandlers,
  parseArgs, listAuthUsers, listIndividualProSubscriptions, recapRowsForUsers,
  eligibleUsers, recheckRecapEntitlement, recheckRecapEmailEntitlement,
  listPendingRecapEmails, processPendingRecapEmails, sleep, redactRecapEmailDryRunText,
  recoverGeneratedNotifications, runOne, main, runCli
};