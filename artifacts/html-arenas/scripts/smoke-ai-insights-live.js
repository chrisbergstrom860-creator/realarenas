#!/usr/bin/env node
/*
 * Manual live-provider smoke test for AI Insights.
 *
 * Usage:
 *   node artifacts/html-arenas/scripts/smoke-ai-insights-live.js \
 *     --user-id "$USER_ID"
 *   node artifacts/html-arenas/scripts/smoke-ai-insights-live.js \
 *     --user-id USER_ID --question "Chart my distance by week" \
 *     --question "How many sessions did I do last week?"
 *
 * This deliberately does not start server.js or call an application route.  It
 * uses the importable production Insights runtime, builds the production
 * context through that service, and gives Supabase a GET/HEAD-only fetch. Any
 * database or auth write therefore throws before it can reach the network.
 * No quota, history, usage, or other application rows are created.
 * Calls are sequential with 10 seconds between questions. HTTP 429 responses
 * are retried at most twice, respecting Retry-After (up to 120 seconds).
 * This manual tool is never invoked by the automated test suite.
 */

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const aiInsights = require('../ai-insights');
const { createAiInsightsService } = require('../ai-insights-service');
const { createAiInsightsRuntime } = require('../ai-insights-runtime');

const CHART_QUESTIONS = [
  'Show me how I\'ve been training day by day for the last three months',
  'Chart my distance by week',
  'Show my sessions per month by sport',
  'Graph my cycling hours per week',
  'How have I been feeling week by week?'
];
const DEFAULT_QUESTIONS = [
  ...CHART_QUESTIONS,
  // Keep this deliberate duplicate: the requested smoke run is seven calls,
  // and the duplicate makes the feelings result independently observable.
  'How have I been feeling week by week?',
  'How many sessions did I do last week?'
];
const FEELINGS_QUESTION = 'How have I been feeling week by week?';
const SINGLE_COUNT_QUESTION = 'How many sessions did I do last week?';
const READ_METHODS = new Set(['GET', 'HEAD']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: node scripts/smoke-ai-insights-live.js --user-id UUID [--question "..." ...]');
}

function parseArgs(argv) {
  let userId = null;
  const questions = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--user-id') {
      userId = argv[++i];
      if (!userId) throw new Error('--user-id requires a value');
    } else if (arg === '--question') {
      const question = argv[++i];
      if (!question) throw new Error('--question requires a value');
      questions.push(question);
    } else if (arg === '--help' || arg === '-h') {
      usage();
      return { help: true };
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!userId) throw new Error('--user-id is required');
  if (!UUID_RE.test(userId)) throw new Error('--user-id must be a UUID');
  return { userId, questions: questions.length ? questions : DEFAULT_QUESTIONS };
}

function readOnlyFetch(input, init) {
  const method = String(
    (init && init.method) ||
    (input && typeof input === 'object' && input.method) ||
    'GET'
  ).toUpperCase();
  if (!READ_METHODS.has(method)) {
    throw new Error(`Read-only smoke refused network method ${method}`);
  }
  return fetch(input, init);
}

/*
 * Do not require server.js: its module body starts an HTTP listener. This
 * builds the same service/runtime dependency closure used by the one-shot
 * recap runner, retaining the caller's read-only Supabase client.
 */
function makeReadOnlyContextBuilder(supabaseAdmin, {
  runtimeFactory = createAiInsightsRuntime,
  serviceFactory = createAiInsightsService
} = {}) {
  const runtime = runtimeFactory({ supabaseAdmin });
  const service = serviceFactory(runtime);
  if (!service || typeof service.buildContextForUser !== 'function') {
    throw new Error('Production AI Insights service has no context entrypoint');
  }
  return service.buildContextForUser.bind(service);
}

function finiteUsageNumber(usage, key) {
  const value = usage && usage[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function usageSummary(userId, question, usage) {
  // This is the production cost calculation, kept in ai-insights.js rather
  // than duplicated here.  The returned user_id is intentionally not logged.
  return aiInsights.buildAiInsightsUsageLog(userId, question.length, usage || null);
}

function chartSummary(chart) {
  if (!chart || typeof chart !== 'object') return null;
  return {
    metric: typeof chart.metric === 'string' ? chart.metric : null,
    period: typeof chart.period === 'string' ? chart.period : null
  };
}

function sanitizeError(error, env = process.env) {
  let message = error && typeof error.message === 'string'
    ? error.message
    : (error && typeof error.name === 'string' ? error.name : 'request failed');
  const secrets = [
    env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    env.ANTHROPIC_API_KEY,
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.SUPABASE_ANON_KEY
  ].filter((value) => typeof value === 'string' && value.length > 0);
  for (const secret of secrets) message = message.split(secret).join('[redacted]');
  message = message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key|authorization|service[_-]?role)(["'=:\s]+)\S+/gi, '$1$2[redacted]')
    .replace(/\bhttps?:\/\/[^\s]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        parsed.search = '';
        return parsed.toString();
      } catch (err) {
        return '[redacted URL]';
      }
    });
  return message.slice(0, 400);
}

function providerClient(providerConfig) {
  const options = {
    apiKey: providerConfig.apiKey,
    maxRetries: 0
  };
  if (providerConfig.provider === 'replit-ai-integrations') {
    options.baseURL = providerConfig.baseURL;
  }
  return new Anthropic(options);
}

function rateLimitDelay(error) {
  if (!error || error.status !== 429) return null;
  const raw = error.headers && (
    typeof error.headers.get === 'function'
      ? error.headers.get('retry-after')
      : error.headers['retry-after']
  );
  const seconds = raw && /^\d+(?:\.\d+)?$/.test(String(raw)) ? Number(raw) : null;
  const dateDelay = raw && seconds === null ? Date.parse(raw) - Date.now() : NaN;
  const delay = seconds !== null ? seconds * 1000 : Number.isFinite(dateDelay) ? dateDelay : 60000;
  // Refuse an excessive wait rather than retrying before the provider permits it.
  return delay > 120000 ? null : Math.max(1000, delay);
}

async function callProvider(client, request, onRetry, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.messages.create(request);
    } catch (error) {
      const delay = rateLimitDelay(error);
      if (delay === null || attempt >= 2) throw error;
      onRetry({ retry: attempt + 1, wait_ms: delay });
      await sleep(delay);
    }
  }
}

function expectationFailure(question, result) {
  if (question === FEELINGS_QUESTION) {
    if (!result.accepted) return 'default feelings question was rejected';
    if (!result.chart ||
        result.chart.metric !== 'feelings' ||
        result.chart.period !== 'weekly') {
      return 'default feelings question did not return a weekly feelings chart';
    }
  }
  if (question === SINGLE_COUNT_QUESTION) {
    if (!result.accepted) return 'default last-week count question was rejected';
    if (result.chart !== null) return 'default last-week count question returned a chart';
  }
  return null;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage(error.message);
    process.exitCode = 2;
    return;
  }
  if (args.help) return;

  let providerConfig;
  try {
    providerConfig = aiInsights.resolveAnthropicProvider(process.env);
  } catch (error) {
    console.error(`Provider configuration error: ${sanitizeError(error)}`);
    process.exitCode = 1;
    return;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase configuration error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    process.exitCode = 1;
    return;
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: readOnlyFetch }
    }
  );

  let user;
  let context;
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(args.userId);
    if (error) throw error;
    user = data && data.user;
    if (!user) throw new Error('user was not found');
    const buildContext = makeReadOnlyContextBuilder(supabaseAdmin);
    context = await buildContext(user.id);
  } catch (error) {
    console.error(`Read-only context error: ${sanitizeError(error)}`);
    process.exitCode = 1;
    return;
  }

  let client;
  try {
    client = providerClient(providerConfig);
  } catch (error) {
    console.error(`Provider initialization error: ${sanitizeError(error)}`);
    process.exitCode = 1;
    return;
  }

  let totalCost = 0;
  let expectationFailures = 0;
  let requestFailures = 0;
  let rejections = 0;
  for (let index = 0; index < args.questions.length; index++) {
    if (index) await new Promise((resolve) => setTimeout(resolve, 10000));
    const question = String(args.questions[index]).trim();
    const base = {
      index: index + 1,
      question,
      status: 'rejected',
      accepted: false,
      reason: null,
      stop_reason: null,
      chart: null,
      output_tokens: 0,
      estimated_cost_usd: 0
    };
    try {
      const request = aiInsights.buildAiInsightsRequest(context, question, []);
      const response = await callProvider(client, request, (retry) => {
        console.log(JSON.stringify({ index: index + 1, rate_limit_retry: retry }));
      });
      const usage = usageSummary(args.userId, question, response && response.usage);
      const outputTokens = finiteUsageNumber(response && response.usage, 'output_tokens');
      const text = (response && Array.isArray(response.content) ? response.content : [])
        .filter((block) => block && block.type === 'text')
        .map((block) => block.text)
        .join('');
      const validated = aiInsights.validateInsightResponse(text, context);
      const result = {
        ...base,
        status: validated.ok === true ? 'accepted' : 'rejected',
        accepted: validated.ok === true,
        reason: validated.ok ? null : (validated.reason || 'rejected'),
        stop_reason: response && response.stop_reason ? response.stop_reason : null,
        chart: validated.ok ? chartSummary(validated.chart) : null,
        output_tokens: outputTokens,
        estimated_cost_usd: usage.estimated_cost_usd
      };
      totalCost += usage.estimated_cost_usd;
      if (!validated.ok) rejections++;
      const expectation = expectationFailure(question, result);
      if (expectation) {
        result.expectation_failure = expectation;
        expectationFailures++;
      }
      console.log(JSON.stringify(result));
    } catch (error) {
      requestFailures++;
      const safeError = sanitizeError(error);
      const result = {
        ...base,
        reason: 'provider_error',
        error: safeError
      };
      const expectation = expectationFailure(question, result);
      if (expectation) {
        result.expectation_failure = expectation;
        expectationFailures++;
      }
      console.log(JSON.stringify(result));
      // Continue sequentially so every requested question is reported, but
      // the final exit status remains non-zero.
    }
  }

  console.log(JSON.stringify({
    total: {
      questions: args.questions.length,
      estimated_cost_usd: Number(totalCost.toFixed(12))
    }
  }));
  if (expectationFailures || requestFailures || rejections) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Smoke test failed: ${sanitizeError(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CHART_QUESTIONS,
  DEFAULT_QUESTIONS,
  FEELINGS_QUESTION,
  SINGLE_COUNT_QUESTION,
  parseArgs,
  readOnlyFetch,
  makeReadOnlyContextBuilder,
  chartSummary,
  sanitizeError,
  rateLimitDelay,
  callProvider,
  expectationFailure
};