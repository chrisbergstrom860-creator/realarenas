#!/usr/bin/env node
'use strict';

// Operator-only, read-only preview. No model, RPC, database writes or email
// provider calls. Synthetic findings are validated against the runtime context.
const fs = require('node:fs/promises');
const { createClient } = require('@supabase/supabase-js');
const { createAiInsightsRuntime } = require('../ai-insights-runtime');
const { createAiInsightsService } = require('../ai-insights-service');
const {
  hydrateWeeklyRecapFindings, validateInsightResponse,
  validateWeeklyRecapCompleteness, WEEKLY_RECAP_CONTRACT_VERSION
} = require('../ai-insights');
const { recapWindowFor } = require('../weekly-recaps');
const { renderRecapProse, resolveRecapExtras } = require('../recap-prose');
const { deliverWeeklyRecapEmail } = require('../weekly-recap-email');
const { renderRecapEmail } = require('../html/email-weekly-recap');

function buildSyntheticRecap(context, user, now = new Date()) {
  const weekly = context.last12Weeks.weekly;
  const index = weekly.findIndex((week) => week.relative === 'last_week');
  const previous = weekly.findIndex((week) => week.relative === '2_weeks_ago');
  if (index < 0 || previous < 0) throw new Error('Synthetic recap requires completed weeks');
  const last = weekly[index];
  const findings = ['activityCount', 'durationHours', 'points',
    ...(last.distanceKm > 0 ? ['distanceKm'] : [])]
    .map((metric) => ({ type: 'metric', path: `last12Weeks.weekly.${index}.${metric}` }));
  const trend = !!context.dataQuality.trendEligible;
  if (trend) findings.push({
    type: 'comparison', leftPath: `last12Weeks.weekly.${index}.durationHours`,
    rightPath: `last12Weeks.weekly.${previous}.durationHours`
  });
  if (Object.values(context.last12Weeks.feelingsTotal || {}).some((value) => value > 0)) {
    findings.push({ type: 'chart', metric: 'feelings', period: 'weekly', evidence: 'last12Weeks.feelings' });
  }
  const hydrated = hydrateWeeklyRecapFindings(JSON.stringify({
    findings, limitations: trend ? [] : ['INSUFFICIENT_TREND_DATA']
  }), context);
  const validated = validateWeeklyRecapCompleteness(
    hydrated, context, validateInsightResponse(hydrated, context)
  );
  if (!validated.ok) throw new Error(`Synthetic recap validation failed: ${validated.reason}`);
  const parsed = typeof hydrated === 'string' ? JSON.parse(hydrated) : hydrated;
  const envelope = { findings: parsed.findings, limitations: validated.limitations, evidence: validated.evidence };
  const chart = { ...(validated.chart || {}), extras: resolveRecapExtras(context) };
  return {
    id: 'synthetic-read-only-preview', user_id: user.id, status: 'generated',
    email_status: 'pending', week_start: last.weekStart, timezone: context.timezone,
    created_at: now.toISOString(), generated_at: now.toISOString(),
    context_schema_version: context.schemaVersion, contract_version: WEEKLY_RECAP_CONTRACT_VERSION,
    findings: envelope, chart,
    prose: renderRecapProse(envelope, { weekStart: last.weekStart, timezone: context.timezone, chart })
  };
}

function readOnlyFetchFor(origin, fetchImpl = fetch) {
  const allowedOrigin = new URL(origin).origin;
  return async (input, init) => {
    const method = String(init && init.method || input && input.method || 'GET').toUpperCase();
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['GET', 'HEAD'].includes(method) || url.origin !== allowedOrigin) {
      throw new Error('Synthetic preview refused non-read-only network request');
    }
    const response = await fetchImpl(input, { ...init, redirect: 'error' });
    if (!response.ok) throw new Error(`Read-only context request failed (${response.status})`);
    return response;
  };
}

async function previewSyntheticEmail(context, user, now = new Date()) {
  const row = buildSyntheticRecap(context, user, now);
  let html;
  const result = await deliverWeeklyRecapEmail({
    supabase: new Proxy({}, { get() { throw new Error('Synthetic preview forbids database access'); } }),
    recap: row, correlationId: 'synthetic-read-only-preview', dryRun: true,
    // This is a layout preview, not an eligibility/delivery decision.
    entitlementCheck: async () => ({ eligible: true, user }),
    sender: async () => { throw new Error('Synthetic preview forbids sends'); },
    signToken: () => 'REDACTED_UNSUBSCRIBE_CAPABILITY',
    logger: () => {},
    render: (...args) => {
      const rendered = renderRecapEmail(...args);
      // Remove the external brand image to make the saved HTML self-contained.
      html = rendered.html.replace(/<img\b[^>]*>/gi, '');
      return rendered;
    }
  });
  return { ...result, html, row };
}

async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--user-id', '--now', '--html'].includes(argv[i]) || !argv[i + 1]) {
      throw new Error('Usage: --user-id UUID [--now ISO_DATE] [--html /tmp/name.html]');
    }
    options[argv[i]] = argv[i + 1];
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options['--user-id'] || '')) {
    throw new Error('--user-id must be a UUID');
  }
  const output = options['--html'] || '/tmp/synthetic-recap-email.html';
  if (!/^\/tmp\/[a-zA-Z0-9_-]+\.html$/.test(output)) throw new Error('--html must be an HTML filename directly in /tmp');
  const now = options['--now'] ? new Date(options['--now']) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('--now must be a valid date');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: readOnlyFetchFor(process.env.SUPABASE_URL) }
  });
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(options['--user-id']);
  if (error || !data.user) throw new Error('Preview user lookup failed');
  const runtime = createAiInsightsRuntime({ supabaseAdmin });
  const service = createAiInsightsService({
    ...runtime, createAnthropicClient: () => { throw new Error('Synthetic preview forbids model calls'); }
  });
  const window = recapWindowFor(data.user, now);
  const context = await service.buildContextForUser(data.user.id, window.contextAsOf);
  const result = await previewSyntheticEmail(context, data.user, now);
  await fs.writeFile(output, result.html, { mode: 0o600 });
  console.log('SYNTHETIC READ-ONLY PREVIEW — validated server findings, no model, no writes, no sends.');
  console.log(`Subject: ${result.subject}\n\n${result.text}\n\nSelf-contained HTML: ${output}`);
}

if (require.main === module) {
  main().catch(() => {
    // Runtime errors can contain credentialed URLs/private data; never echo them.
    console.error('Synthetic preview failed: check arguments, read-only credentials and context validity.');
    process.exitCode = 1;
  });
}

module.exports = { buildSyntheticRecap, previewSyntheticEmail, readOnlyFetchFor, main };