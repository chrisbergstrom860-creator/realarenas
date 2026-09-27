#!/usr/bin/env node
'use strict';

/*
 * Manual, read-only live-provider recap smoke. Never starts the server or the
 * recap runner; no claims, usage rows, notifications, or emails are created.
 *
 * node scripts/smoke-weekly-recaps-live.js --user-id UUID [--count 5] [--now 2026-03-16T12:00:00Z]
 */
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const { resolveAnthropicProvider } = require('../ai-insights');
const { createAiInsightsRuntime } = require('../ai-insights-runtime');
const { createAiInsightsService } = require('../ai-insights-service');
const { recapWindowFor } = require('../weekly-recaps');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/i;
const READ_METHODS = new Set(['GET', 'HEAD']);

function validIsoTimestamp(value) {
  const parts = ISO_RE.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = parts;
  const calendarDay = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return calendarDay.getUTCFullYear() === Number(year) &&
    calendarDay.getUTCMonth() + 1 === Number(month) &&
    calendarDay.getUTCDate() === Number(day) &&
    Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 &&
    (offsetHour === undefined || (Number(offsetHour) < 24 && Number(offsetMinute) < 60));
}

function parseArgs(argv) {
  let userId;
  let count = 5;
  let now;
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!['--user-id', '--count', '--now'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (seen.has(arg)) throw new Error(`${arg} was provided more than once`);
    seen.add(arg);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    if (arg === '--user-id') userId = value;
    if (arg === '--count') {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error('--count must be a positive integer');
      }
      count = Number(value);
    }
    if (arg === '--now') {
      if (!validIsoTimestamp(value)) {
        throw new Error('--now must be an ISO timestamp with timezone');
      }
      now = new Date(value);
    }
  }
  if (!userId || !UUID_RE.test(userId)) throw new Error('--user-id must be a UUID');
  return { userId, count, now };
}

function readOnlyFetch(input, init) {
  const method = String(
    (init && init.method) ||
    (input && typeof input === 'object' && input.method) ||
    'GET'
  ).toUpperCase();
  if (!READ_METHODS.has(method)) throw new Error(`Read-only smoke refused network method ${method}`);
  return fetch(input, init);
}

function makeReadOnlyService(supabaseAdmin, providerConfig, {
  runtimeFactory = createAiInsightsRuntime,
  serviceFactory = createAiInsightsService,
  clientFactory = (options) => new Anthropic(options)
} = {}) {
  const runtime = runtimeFactory({ supabaseAdmin });
  const createAnthropicClient = () => clientFactory({
    apiKey: providerConfig.apiKey,
    maxRetries: 0,
    ...(providerConfig.provider === 'replit-ai-integrations' ? { baseURL: providerConfig.baseURL } : {})
  });
  return serviceFactory({ ...runtime, createAnthropicClient });
}

// Only machine-readable validation diagnostics, never model output or context.
function diagnostic(validated) {
  return {
    accepted: validated.ok === true,
    reason: validated.ok === true ? null : (validated.reason || 'rejected'),
    offendingPath: validated.offendingPath || null
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('Usage: node scripts/smoke-weekly-recaps-live.js --user-id UUID [--count 5] [--now ISO]');
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    console.log('Usage: node scripts/smoke-weekly-recaps-live.js --user-id UUID [--count 5] [--now ISO]');
    return;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase configuration error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    process.exitCode = 1;
    return;
  }
  let providerConfig;
  try {
    providerConfig = resolveAnthropicProvider(process.env);
  } catch (_) {
    console.error('Provider configuration error: check Anthropic environment variables');
    process.exitCode = 1;
    return;
  }
  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: readOnlyFetch }
  });

  let context;
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(args.userId);
    if (error) throw error;
    if (!data || !data.user) throw new Error('not found');
    const window = recapWindowFor(data.user, args.now || new Date());
    const service = makeReadOnlyService(supabaseAdmin, providerConfig);
    context = await service.buildContextForUser(data.user.id, window.contextAsOf);
    let accepted = 0;
    let failures = 0;
    for (let index = 0; index < args.count; index++) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 10000));
      try {
        const output = await service.runValidatedRequest(context, 'recap', { providerConfig });
        const result = diagnostic(output.validated);
        if (result.accepted) accepted++;
        console.log(JSON.stringify({ index: index + 1, ...result }));
      } catch (requestError) {
        failures++;
        // Provider errors may contain private request data: never print the message.
        console.log(JSON.stringify({
          index: index + 1, accepted: false, reason: 'provider_request_failed', offendingPath: null
        }));
      }
    }
    console.log(JSON.stringify({ summary: { total: args.count, accepted } }));
    if (accepted !== args.count || failures) process.exitCode = 1;
  } catch (error) {
    // Context / Supabase errors can contain personal data and credentialed URLs.
    console.error('Read-only context error: user lookup or context construction failed');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Weekly recap smoke failed');
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, readOnlyFetch, makeReadOnlyService, diagnostic };