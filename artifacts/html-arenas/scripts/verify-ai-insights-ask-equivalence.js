#!/usr/bin/env node
/*
 * A read-only, frozen-clock equivalence proof for the AI Insights ask route.
 *
 * It loads b247435 and the worktree into separate VM module graphs.  Express
 * is replaced only with a route recorder: no listener is opened.  The real
 * founder is fetched through the configured Supabase service-role client, but
 * the monthly-usage functions are replaced before either server is evaluated,
 * so the proof cannot claim/refund a real question.  Anthropic is also a
 * deterministic local stub.  This deliberately tests the production POST
 * callback and context builder rather than comparing source text.
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const posix = require('node:path').posix;
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const ts = require('typescript');

const FOUNDER_ID = '4e3cd18f-2c09-4ce9-ada1-67fbe725fcd4';
const SERVER_PATH = 'artifacts/html-arenas/server.js';
const DEFAULT_OLD_REF = 'b247435';
const FROZEN_DEFAULT = '2026-09-14T12:00:00.000Z';
const FIXED_SECRET = 'ask-equivalence-test-secret-not-production';
const here = path.resolve(__dirname);
const root = path.resolve(here, '..', '..', '..');
const serverRequire = createRequire(path.resolve(here, '..', 'server.js'));

function gitSource(ref, relativePath) {
  if (ref === 'WORKTREE') return fs.readFileSync(path.join(root, relativePath), 'utf8');
  return execFileSync('git', ['show', `${ref}:${relativePath}`], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore']
  });
}

function parseArgs(argv) {
  const out = { oldRef: DEFAULT_OLD_REF, frozenAt: FROZEN_DEFAULT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--old-ref') out.oldRef = argv[++i];
    else if (arg.startsWith('--old-ref=')) out.oldRef = arg.slice('--old-ref='.length);
    else if (arg === '--frozen-at') out.frozenAt = argv[++i];
    else if (arg.startsWith('--frozen-at=')) out.frozenAt = arg.slice('--frozen-at='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/verify-ai-insights-ask-equivalence.js [--old-ref b247435] [--frozen-at ISO]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!out.oldRef) throw new Error('--old-ref requires a ref');
  if (!Number.isFinite(Date.parse(out.frozenAt))) throw new Error('--frozen-at must be an ISO instant');
  return out;
}

function frozenDate(instant) {
  const fixed = new Date(instant).getTime();
  class FrozenDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  }
  FrozenDate.parse = Date.parse;
  FrozenDate.UTC = Date.UTC;
  return FrozenDate;
}

/*
 * Usage claims must be lexical replacements—not mocked database calls—because
 * the old endpoint's claim implementation otherwise writes notification rows.
 */
function makeReadOnlyServerSource(source) {
  /*
   * Assign after all registrations rather than replacing function source.
   * Function declarations are mutable lexical bindings, and route callbacks
   * resolve them at invocation time. This is resilient to comments/template
   * literals in the production functions and guarantees the real provider
   * route cannot touch the database usage ledger.
   */
  const replacements = new Map([
    ['readAiUsage', `async function readAiUsage(userId, now = new Date()) {
  const period = now.toISOString().slice(0, 7);
  return { used: 0, remaining: AI_INSIGHTS_MONTHLY_LIMIT, period,
    resetDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10) };
}`],
    ['claimAiUsage', `async function claimAiUsage(userId, now = new Date()) {
  const usage = await readAiUsage(userId, now);
  return { ...usage, allowed: true, sourceKey: 'ask-equivalence:in-memory' };
}`],
    ['releaseAiUsageClaim', 'async function releaseAiUsageClaim() { return undefined; }']
  ]);
  const file = ts.createSourceFile('server.js', source, ts.ScriptTarget.Latest, true);
  const spans = [];
  file.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name && replacements.has(node.name.text)) {
      spans.push({ start: node.getStart(file), end: node.end, text: replacements.get(node.name.text) });
    }
  });
  if (spans.length !== replacements.size) throw new Error('could not replace all usage functions with read-only stubs');
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, span.start) + span.text + source.slice(span.end);
  }
  return source;
}

function fakeExpress(routes) {
  const app = {};
  for (const method of ['use', 'set', 'get', 'post', 'put', 'patch', 'delete']) {
    app[method] = (...args) => {
      if (method === 'post') {
        const handler = [...args].reverse().find((arg) => typeof arg === 'function');
        const route = args.find((arg) => typeof arg === 'string');
        if (route && handler) routes.set(route, handler);
      }
      return app;
    };
  }
  app.listen = () => ({ close() {} });
  const express = () => app;
  for (const name of ['json', 'urlencoded', 'raw', 'static']) express[name] = () => (req, res, next) => next && next();
  return express;
}

function stubAnthropic(captures) {
  return class AnthropicStub {
    constructor() {
      this.messages = {
        create: async (request) => {
          captures.push(JSON.parse(JSON.stringify(request)));
          const contextBlock = request.messages && request.messages[0] && request.messages[0].content &&
            request.messages[0].content.find((block) => block && block.cache_control);
          const context = JSON.parse(contextBlock.text);
          // This selects two context shapes on purpose: a scalar plus a
          // calendar list when it exists. Both must survive validation.
          const findings = [{
            type: 'metric',
            path: 'last12Weeks.activityCount',
            value: context.last12Weeks.activityCount
          }];
          const plans = context.calendar && context.calendar.plannedSessions && context.calendar.plannedSessions.items;
          if (Array.isArray(plans) && plans.length) {
            findings.push({
              type: 'calendar_plan',
              path: 'calendar.plannedSessions.items.0',
              value: plans[0]
            });
          }
          return {
            content: [{ type: 'text', text: JSON.stringify({ findings, limitations: [] }) }],
            usage: { input_tokens: 101, cache_creation_input_tokens: 202, cache_read_input_tokens: 0, output_tokens: 51 }
          };
        }
      };
    }
  };
}

function makeSandbox(ref, instant) {
  const routes = new Map();
  const captures = [];
  const moduleCache = new Map();
  const env = { ...process.env, SESSION_SECRET: FIXED_SECRET, PORT: '0', RAILWAY_ENVIRONMENT: '' };
  // Never let dotenv alter the parent environment while evaluating a historical
  // server. The real Supabase credentials remain available through this copy.
  const dotenv = { config: () => ({ parsed: {} }) };
  const context = vm.createContext({
    Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController,
    Date: frozenDate(instant), console: { log() {}, warn() {}, error() {}, info() {} },
    process: Object.assign(Object.create(process), { env }),
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    performance, crypto: undefined
  });
  context.global = context;
  context.globalThis = context;

  function resolve(request, parent) {
    if (!request.startsWith('.')) return null;
    const base = posix.dirname(parent);
    const bare = posix.normalize(posix.join(base, request)).replace(/^\.\//, '');
    const candidates = [bare, `${bare}.js`, `${bare}.json`, `${bare}/index.js`];
    for (const candidate of candidates) {
      try { gitSource(ref, candidate); return candidate; } catch (err) {}
    }
    throw new Error(`cannot resolve ${request} from ${parent} at ${ref}`);
  }

  function localRequire(request, parent) {
    if (request === 'express') return fakeExpress(routes);
    if (request === 'dotenv') return dotenv;
    if (request === '@anthropic-ai/sdk') return stubAnthropic(captures);
    if (request.startsWith('.')) return load(resolve(request, parent));
    return serverRequire(request);
  }

  function load(relativePath) {
    if (moduleCache.has(relativePath)) return moduleCache.get(relativePath).exports;
    if (relativePath.endsWith('.json')) return JSON.parse(gitSource(ref, relativePath));
    const record = { exports: {} };
    moduleCache.set(relativePath, record);
    const original = gitSource(ref, relativePath);
    const code = relativePath === SERVER_PATH ? makeReadOnlyServerSource(original) : original;
    const wrapper = vm.runInContext(`(function(exports,require,module,__filename,__dirname){\n${code}\n})`, context, {
      filename: `${ref}:${relativePath}`, displayErrors: true
    });
    // Give production code a real absolute directory for static-file setup.
    // Relative module lookup still uses the immutable git path above.
    wrapper(record.exports, (request) => localRequire(request, relativePath), record,
      path.join(root, relativePath), path.join(root, posix.dirname(relativePath)));
    return record.exports;
  }

  load(SERVER_PATH);
  const ask = routes.get('/api/profile/ai-insights') || routes.get('/html/api/profile/ai-insights');
  if (!ask) throw new Error(`could not record POST /api/profile/ai-insights from ${ref}`);
  return { ask, captures, context };
}

function responseRecorder() {
  let status = 200, body, sent = false;
  const res = {
    status(code) { status = code; return res; },
    json(value) { body = value; sent = true; return res; },
    send(value) { body = value; sent = true; return res; },
    setHeader() {}, set() { return res; }
  };
  return { res, value: () => ({ status, body, sent }) };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])])
  );
  return value;
}

function firstDiff(left, right, at = '$') {
  if (JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))) return null;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return at;
  for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    if (!(key in left) || !(key in right)) return `${at}.${key}`;
    const diff = firstDiff(left[key], right[key], `${at}.${key}`);
    if (diff) return diff;
  }
  return at;
}

async function founder() {
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await client.auth.admin.getUserById(FOUNDER_ID);
  if (error) throw new Error(`founder read failed: ${error.message}`);
  if (!data || !data.user) throw new Error('founder was not found');
  return data.user;
}

async function invoke(sandbox, user, instant) {
  const previous = {
    question: 'Earlier verified question',
    answer: 'Earlier verified answer',
    createdAt: new Date(Date.parse(instant) - 60000).toISOString()
  };
  previous.signature = crypto.createHmac('sha256', FIXED_SECRET).update(JSON.stringify({
    userId: user.id, question: previous.question, answer: previous.answer, createdAt: previous.createdAt
  })).digest('base64url');
  const response = responseRecorder();
  await sandbox.ask({
    user, body: { question: 'Show my recorded training summary and upcoming plans.', history: [previous] },
    get() { return undefined; }, headers: {}, method: 'POST', path: '/api/profile/ai-insights'
  }, response.res);
  const result = response.value();
  if (!result.sent) throw new Error('ask endpoint did not send a response');
  if (sandbox.captures.length !== 1) throw new Error(`expected one deterministic provider request, got ${sandbox.captures.length}`);
  return { ...result, request: sandbox.captures[0] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const user = await founder(); // The only live operation in this proof is auth/data reading performed by handlers.
  const old = makeSandbox(args.oldRef, args.frozenAt);
  const worktree = makeSandbox('WORKTREE', args.frozenAt);
  const [oldResult, newResult] = await Promise.all([invoke(old, user, args.frozenAt), invoke(worktree, user, args.frozenAt)]);
  const oldContext = JSON.parse(oldResult.request.messages[0].content[0].text);
  const newContext = JSON.parse(newResult.request.messages[0].content[0].text);
  const contextDiff = firstDiff(oldContext, newContext);
  assert.equal(contextDiff, null, `context differs at ${contextDiff}`);
  const requestDiff = firstDiff(oldResult.request, newResult.request);
  assert.equal(requestDiff, null, `provider request differs at ${requestDiff}`);
  assert.equal(oldResult.status, newResult.status, 'HTTP status differs');
  const responseDiff = firstDiff(oldResult.body, newResult.body);
  if (responseDiff) {
    console.error('ASK EQUIVALENCE DEBUG response usage', JSON.stringify({
      old: oldResult.body && oldResult.body.usage,
      worktree: newResult.body && newResult.body.usage
    }));
  }
  assert.equal(responseDiff, null, `HTTP response differs at ${responseDiff}`);
  /*
   * The process that runs jobs cannot rely on the server VM's configured
   * instance. This final independent call is intentionally through the
   * public/default service API. A configured-only module therefore fails this
   * proof rather than masking an unusable one-shot runner behind the web path.
   */
  const service = require('../ai-insights-service');
  const standaloneContext = await service.buildContextForUser(FOUNDER_ID, new Date(args.frozenAt));
  const standaloneDiff = firstDiff(newContext, standaloneContext);
  assert.equal(standaloneDiff, null, `standalone default service context differs at ${standaloneDiff}`);
  console.log(`ASK EQUIVALENCE PASS account=founder old=${args.oldRef} frozenAt=${args.frozenAt} context=request=response identical standalone=identical usage=memory-only`);
}

main().catch((error) => {
  console.error(`ASK EQUIVALENCE FAIL ${error.stack || error.message}`);
  process.exitCode = 1;
});