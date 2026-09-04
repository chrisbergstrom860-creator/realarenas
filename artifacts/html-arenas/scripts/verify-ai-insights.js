const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { FALLBACK_COPY } = require('../ai-insights');

const APP_PORT = 3987;
const STUB_PORT = 3988;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PASSWORD = 'AiInsightsVerify!234';
const MANIFEST = '/tmp/verify-ai-insights-manifest.json';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const nonce = Date.now().toString(36);
const users = {};
let clubId = null;
let foreignClubId = null;
let subscriptionId = null;
let failures = 0;
const captured = [];
const REFUSAL_COPY = "I can describe your recorded training, but I can’t prescribe workouts or comment on diet, weight, body composition, or whether you are under-training. Try asking what changed in your volume, consistency, sports, personal records, or standings.";
const GROUNDED_METRIC_COPY = 'Your all-time activity count was 8.';
const TEST_TIMEZONE = 'America/Los_Angeles';
function datePartsInZone(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}
function monthKeyInZone(date, timeZone) {
  const parts = datePartsInZone(date, timeZone);
  return `${parts.year}-${parts.month}`;
}
function dayKeyInZone(date, timeZone) {
  const parts = datePartsInZone(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function shiftMonth(key, offset) {
  const [year, month] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key, withYear = false) {
  return new Date(key + '-01T00:00:00Z').toLocaleDateString('en-US', {
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC'
  });
}
const CURRENT_MONTH_KEY = monthKeyInZone(new Date(), TEST_TIMEZONE);
const CURRENT_MONTH_YEAR_LABEL = monthLabel(CURRENT_MONTH_KEY, true);
const NEXT_MONTH_KEY = shiftMonth(CURRENT_MONTH_KEY, 1);
const NEXT_MONTH_YEAR_LABEL = monthLabel(NEXT_MONTH_KEY, true);
const OUT_OF_RANGE_MONTH_KEY = shiftMonth(CURRENT_MONTH_KEY, 6);
const OUT_OF_RANGE_MONTH_YEAR_LABEL = monthLabel(OUT_OF_RANGE_MONTH_KEY, true);
const LAST_MONTH_KEY = shiftMonth(CURRENT_MONTH_KEY, -1);
const TWO_MONTHS_AGO_KEY = shiftMonth(CURRENT_MONTH_KEY, -2);
const LAST_MONTH_LABEL = monthLabel(LAST_MONTH_KEY);
const LAST_MONTH_YEAR_LABEL = monthLabel(LAST_MONTH_KEY, true);
const TWO_MONTHS_AGO_LABEL = monthLabel(TWO_MONTHS_AGO_KEY);
const ANSWERABLE_QUESTIONS = [
  `How many hours on average did I workout in ${LAST_MONTH_YEAR_LABEL}?`,
  'How many rest days did I take last month?',
  `How much did I train in ${TWO_MONTHS_AGO_LABEL}?`,
  `How many workouts did I log in ${LAST_MONTH_LABEL}?`,
  'How many hours of weight training did I record last month?',
  'How did my training routine change over the last 12 weeks?',
  `What was my average ride distance in ${LAST_MONTH_LABEL}?`,
  'What percentage of my recorded training was running?',
  'What is my next planned session?',
  'How many planned sessions do I have left this month and what are they?',
  'What events do I have this month?',
  'Is my cycling goal on track?'
];
const NOT_ANSWERABLE_CASES = [
  {
    question: 'How many activities did I log after my injury?',
    reason: 'missing_injury_date',
    copy: "Your recorded data does not include when your injury occurred, so I can’t answer questions about activity before or after it."
  },
  {
    question: 'How many activities did I record during my medical leave?',
    reason: 'missing_medical_leave_dates',
    copy: "Your recorded data does not include the start and end dates of your medical leave, so I can’t answer questions about activity during it."
  },
  {
    question: 'List every future calendar result, including results beyond the cap.',
    reason: 'calendar_results_truncated',
    copy: "Calendar results were capped, so AI Insights cannot answer a question that requires the omitted results."
  },
  {
    question: 'How were my goals doing last week?',
    reason: 'goal_history_unavailable',
    copy: "AI Insights includes active goals only, so goal history is unavailable."
  },
  {
    question: 'If my current pace continued, what would my goal progress be by the end of this month?',
    reason: 'goal_projection_unsupported',
    copy: "AI Insights includes the server-computed on-track status, but it cannot calculate a catch-up projection."
  },
  {
    question: `What events do I have in ${OUT_OF_RANGE_MONTH_YEAR_LABEL}?`,
    reason: 'calendar_month_out_of_range',
    copy: "Nothing is scheduled that far ahead, so AI Insights cannot tell whether that month is empty."
  }
];
const POLICY_REFUSAL_CASES = [
  { question: 'Should I be doing more cardio?', reason: 'prescriptive' },
  { question: 'What workout should I do tomorrow?', reason: 'prescriptive' },
  { question: 'Can you recommend a new training routine?', reason: 'prescriptive' },
  { question: 'Should I rest tomorrow?', reason: 'prescriptive' },
  { question: 'How much should I train next week?', reason: 'prescriptive' },
  { question: 'Should I increase my weekly mileage?', reason: 'prescriptive' },
  { question: 'What should I eat after a long run?', reason: 'diet_weight_body' },
  { question: 'How many calories should I eat each day?', reason: 'diet_weight_body' },
  { question: 'Should I lose weight to run faster?', reason: 'diet_weight_body' },
  { question: 'Am I under-training, and does that mean I’m lazy?', reason: 'athlete_characterization' }
];

function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else {
    failures++;
    console.error('FAIL  ' + name + (detail ? ' — ' + String(detail).slice(0, 900) : ''));
  }
}

async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(label + ': ' + result.error.message);
  return result.data;
}

function writeManifest() {
  fs.writeFileSync(MANIFEST, JSON.stringify({
    users: Object.fromEntries(Object.entries(users).map(([key, value]) => [key, value.id])),
    clubId,
    foreignClubId,
    subscriptionId
  }, null, 2));
}

async function makeUser(key, name, prefs) {
  const email = `ai-insights-${key}-${nonce}@arenas-test.dev`;
  const data = await must('create ' + key, admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      name,
      handle: `ai_${key}_${nonce}`.slice(0, 20),
      timezone: key === 'pro' ? TEST_TIMEZONE : 'UTC',
      prefs: prefs || {}
    }
  }));
  users[key] = { id: data.user.id, email, name };
  writeManifest();
}

async function login(key) {
  const response = await fetch(BASE + '/auth/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(users[key].email)}&password=${encodeURIComponent(PASSWORD)}`
  });
  const raw = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  const cookie = (raw || []).filter(Boolean).map((value) => String(value).split(';')[0]).join('; ');
  if (response.status !== 302 || !cookie) throw new Error('login failed for ' + key + ': ' + response.status);
  return {
    cookie,
    browserCookies: (raw || []).filter(Boolean).map((value) => {
      const pair = String(value).split(';')[0];
      const split = pair.indexOf('=');
      return { name: pair.slice(0, split), value: pair.slice(split + 1), url: BASE };
    })
  };
}

async function api(loginState, method, route, body) {
  const response = await fetch(BASE + route, {
    method,
    headers: {
      Cookie: loginState.cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function responseFor(envelope) {
  const question = envelope.question;
  const count = envelope.data.allTime.activityCount;
  let output;
  const policyCase = POLICY_REFUSAL_CASES.find((item) => item.question === question);
  const notAnswerableCase = NOT_ANSWERABLE_CASES.find((item) => item.question === question);
  if (notAnswerableCase) {
    output = {
      findings: [{ type: 'not_answerable', reason: notAnswerableCase.reason }],
      limitations: []
    };
  } else if (/force policy classifier miss/i.test(question)) {
    output = {
      findings: [{ type: 'metric', path: 'allTime.activityCount', value: count }],
      limitations: []
    };
  } else if (policyCase) {
    output = {
      findings: [{ type: 'policy_refusal', reason: policyCase.reason }],
      limitations: []
    };
  } else if (/missing path/i.test(question)) {
    output = {
      findings: [{ type: 'metric', path: 'last12Months.99.durationHours', value: 987654321 }],
      limitations: []
    };
  } else if (/fabricated/i.test(question)) {
    output = {
      findings: [{ type: 'metric', path: 'allTime.activityCount', value: count, displayValue: 987654321 }],
      limitations: []
    };
  } else if (/numeric string fixture/i.test(question)) {
    output = {
      findings: [{
        type: 'metric',
        path: 'last12Months.10.durationHours',
        value: String(envelope.data.last12Months[10].durationHours)
      }],
      limitations: []
    };
  } else if (/bracket path fixture/i.test(question)) {
    output = {
      findings: [{
        type: 'metric',
        path: 'last12Months[10].durationHours',
        value: envelope.data.last12Months[10].durationHours
      }],
      limitations: []
    };
  } else if (/computed value fixture/i.test(question)) {
    output = {
      findings: [{
        type: 'metric',
        path: 'last12Months[10].durationHours',
        value: envelope.data.last12Months[10].durationHours + 0.1
      }],
      limitations: []
    };
  } else if (/truncated month list fixture/i.test(question)) {
    output = {
      findings: [realProviderCalendarPlanListFixture(envelope.data, CURRENT_MONTH_KEY)],
      limitations: []
    };
  } else if (/list filter diagnostic fixture/i.test(question)) {
    output = {
      findings: [{
        ...realProviderCalendarPlanListFixture(envelope.data, CURRENT_MONTH_KEY),
        unexpected: true
      }],
      limitations: []
    };
  } else if (/future count tense fixture/i.test(question)) {
    const index = envelope.data.calendar.plannedSessions.byMonth
      .findIndex((row) => row.month === CURRENT_MONTH_KEY);
    output = {
      findings: [metricFinding(
        envelope.data,
        `calendar.plannedSessions.byMonth.${index}.plannedCount`
      )],
      limitations: []
    };
  } else if (/zero event month fixture/i.test(question)) {
    output = {
      findings: [{
        type: 'calendar_event_list',
        path: 'calendar.events.items',
        filter: { month: NEXT_MONTH_KEY }
      }],
      limitations: []
    };
  } else if (/zero plan month fixture/i.test(question)) {
    output = {
      findings: [realProviderCalendarPlanListFixture(envelope.data, NEXT_MONTH_KEY)],
      limitations: []
    };
  } else if (/mismatched/i.test(question)) {
    output = {
      findings: [{ type: 'metric', path: 'allTime.activityCount', value: count + 1 }],
      limitations: []
    };
  } else if (ANSWERABLE_QUESTIONS.includes(question)) {
    output = {
      findings: findingsForAnswerableQuestion(question, envelope.data),
      limitations: []
    };
  } else {
    output = {
      findings: [{ type: 'metric', path: 'allTime.activityCount', value: count }],
      limitations: []
    };
  }
  return {
    id: 'msg_verify_' + captured.length,
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [{ type: 'text', text: JSON.stringify(output) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 30 }
  };
}

function valueAtPath(root, pathValue) {
  return pathValue.split('.').reduce((value, token) => value == null ? undefined : value[token], root);
}

function monthPath(data, month, suffix) {
  const index = data.last12Months.findIndex((row) => row.month === month);
  if (index < 0) throw new Error('Fixture month unavailable: ' + month);
  return `last12Months.${index}.${suffix}`;
}

function monthSportPath(data, month, sport, suffix) {
  const monthIndex = data.last12Months.findIndex((row) => row.month === month);
  if (monthIndex < 0) throw new Error('Fixture month unavailable: ' + month);
  const sportIndex = data.last12Months[monthIndex].sports.findIndex((row) => row.sport === sport);
  if (sportIndex < 0) throw new Error(`Fixture sport unavailable: ${month}/${sport}`);
  return `last12Months.${monthIndex}.sports.${sportIndex}.${suffix}`;
}

function metricFinding(data, pathValue) {
  return { type: 'metric', path: pathValue, value: valueAtPath(data, pathValue) };
}

// Matches the extra exact `value` array observed in a real Replit-provider
// response, while sourcing records from disposable verifier data.
function realProviderCalendarPlanListFixture(data, month) {
  return {
    type: 'calendar_plan_list',
    path: 'calendar.plannedSessions.items',
    filter: { month },
    value: data.calendar.plannedSessions.items.filter((item) =>
      item.status === 'planned' && String(item.date).slice(0, 7) === month)
  };
}

function findingsForAnswerableQuestion(question, data) {
  const currentMonth = data.last12Months[data.last12Months.length - 1].month;
  const [year, month] = currentMonth.split('-').map(Number);
  const previousDate = new Date(Date.UTC(year, month - 2, 1));
  const lastMonth = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, '0')}`;
  if (question === `How many hours on average did I workout in ${LAST_MONTH_YEAR_LABEL}?`) {
    return [metricFinding(data, monthPath(data, LAST_MONTH_KEY, 'averageHoursPerWeek'))];
  }
  if (question === 'How many rest days did I take last month?') {
    return [metricFinding(data, monthPath(data, lastMonth, 'restDays'))];
  }
  if (question === `How much did I train in ${TWO_MONTHS_AGO_LABEL}?`) {
    return [metricFinding(data, monthPath(data, TWO_MONTHS_AGO_KEY, 'durationHours'))];
  }
  if (question === `How many workouts did I log in ${LAST_MONTH_LABEL}?`) {
    return [metricFinding(data, monthPath(data, LAST_MONTH_KEY, 'sessions'))];
  }
  if (question === 'How many hours of weight training did I record last month?') {
    return [metricFinding(data, monthSportPath(data, lastMonth, 'weightlifting', 'durationHours'))];
  }
  if (question === 'How did my training routine change over the last 12 weeks?') {
    const activeIndexes = data.last12Weeks.weekly.map((row, index) => row.activityCount > 0 ? index : -1).filter((index) => index >= 0);
    const leftPath = `last12Weeks.weekly.${activeIndexes[activeIndexes.length - 1]}.durationHours`;
    const rightPath = `last12Weeks.weekly.${activeIndexes[0]}.durationHours`;
    return [{
      type: 'comparison',
      leftPath,
      leftValue: valueAtPath(data, leftPath),
      rightPath,
      rightValue: valueAtPath(data, rightPath)
    }];
  }
  if (question === `What was my average ride distance in ${LAST_MONTH_LABEL}?`) {
    return [metricFinding(data, monthSportPath(data, LAST_MONTH_KEY, 'cycling', 'averageDistanceKmPerActivity'))];
  }
  if (question === 'What percentage of my recorded training was running?') {
    const sportIndex = data.allTime.sports.findIndex((row) => row.sport === 'running');
    return [metricFinding(data, `allTime.sports.${sportIndex}.percentSessions`)];
  }
  if (question === 'What is my next planned session?') {
    return [{ type: 'calendar_plan', path: 'calendar.plannedSessions.items.0', value: data.calendar.plannedSessions.items[0] }];
  }
  if (question === 'How many planned sessions do I have left this month and what are they?') {
    const index = data.calendar.plannedSessions.byMonth.findIndex((row) => row.month === CURRENT_MONTH_KEY);
    return [
      metricFinding(data, `calendar.plannedSessions.byMonth.${index}.plannedCount`),
      realProviderCalendarPlanListFixture(data, CURRENT_MONTH_KEY)
    ];
  }
  if (question === 'What events do I have this month?') {
    return [{
      type: 'calendar_event_list',
      path: 'calendar.events.items',
      filter: { month: CURRENT_MONTH_KEY }
    }];
  }
  if (question === 'Is my cycling goal on track?') {
    const index = data.goals.active.items.findIndex((goal) => goal.sport === 'cycling');
    return [{ type: 'goal_projection', path: `goals.active.items.${index}`, value: data.goals.active.items[index] }];
  }
  throw new Error('No answerable fixture response for: ' + question);
}

function legacyContextProjection(data) {
  const legacy = JSON.parse(JSON.stringify(data));
  legacy.schemaVersion = 1;
  delete legacy.last12Months;
  for (const key of ['averageSessionDurationHours', 'averageHoursPerWeek', 'averageSessionsPerWeek', 'averageDistanceKmPerActivity']) {
    delete legacy.allTime[key];
    delete legacy.last12Weeks[key];
  }
  for (const sport of legacy.allTime.sports || []) {
    for (const key of ['averageSessionDurationHours', 'averageHoursPerWeek', 'averageSessionsPerWeek', 'averageDistanceKmPerActivity']) delete sport[key];
  }
  delete legacy.last12Weeks.sports;
  return legacy;
}

function startStub() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        try {
          const body = JSON.parse(raw || '{}');
          const content = body.messages && body.messages[0] && body.messages[0].content;
          const envelope = JSON.parse(typeof content === 'string' ? content : '{}');
          const record = { path: req.url, headers: req.headers, body, envelope, output: null };
          captured.push(record);
          if (/force provider failure/i.test(envelope.question || '')) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              type: 'error',
              error: { type: 'api_error', message: 'Forced provider failure for quota-refund proof' }
            }));
            return;
          }
          const providerResponse = responseFor(envelope);
          record.output = JSON.parse(providerResponse.content[0].text);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(providerResponse));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { type: 'stub_error', message: error.message } }));
        }
      });
    });
    server.listen(STUB_PORT, '127.0.0.1', () => resolve(server));
  });
}

function startApp() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      BASE_PATH: '',
      PLAN_GATES_ENABLED: '',
      AI_INTEGRATIONS_ANTHROPIC_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
      AI_INTEGRATIONS_ANTHROPIC_API_KEY: 'test-proxy-key',
      SESSION_SECRET: process.env.SESSION_SECRET || 'ai-insights-verifier-session-secret'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return {
    child,
    output: () => output,
    ready: new Promise((resolve, reject) => {
      const deadline = Date.now() + 15000;
      const timer = setInterval(async () => {
        if (child.exitCode != null) {
          clearInterval(timer);
          reject(new Error('child exited early:\n' + output));
          return;
        }
        try {
          const response = await fetch(BASE + '/landing');
          if (response.status < 500) {
            clearInterval(timer);
            resolve();
          }
        } catch (error) {
          if (Date.now() > deadline) {
            clearInterval(timer);
            reject(new Error('child did not start:\n' + output));
          }
        }
      }, 150);
    })
  };
}

async function cleanup() {
  const ids = Object.values(users).map((user) => user.id);
  if (ids.length) {
    await must('cleanup activities', admin.from('activities').delete().in('user_id', ids));
    await must('cleanup plans', admin.from('planned_sessions').delete().in('user_id', ids));
    await must('cleanup goals', admin.from('goals').delete().in('user_id', ids));
    await must('cleanup rsvps', admin.from('event_rsvps').delete().in('user_id', ids));
    await must('cleanup events', admin.from('events').delete().in('created_by', ids));
    await must('cleanup notifications', admin.from('notifications').delete().in('user_id', ids));
  }
  if (subscriptionId) await must('cleanup subscription', admin.from('subscriptions').delete().eq('id', subscriptionId));
  if (clubId) {
    await must('cleanup memberships', admin.from('memberships').delete().eq('club_id', clubId));
    await must('cleanup club', admin.from('clubs').delete().eq('id', clubId));
  }
  if (foreignClubId) {
    await must('cleanup foreign memberships', admin.from('memberships').delete().eq('club_id', foreignClubId));
    await must('cleanup foreign club', admin.from('clubs').delete().eq('id', foreignClubId));
  }
  for (const user of Object.values(users)) await must('cleanup user ' + user.id, admin.auth.admin.deleteUser(user.id));
  if (fs.existsSync(MANIFEST)) fs.unlinkSync(MANIFEST);
}

(async () => {
  let stub;
  let app;
  let browser;
  try {
    writeManifest();
    check('verification matrix contains exactly 28 preserved-and-extended questions',
      ANSWERABLE_QUESTIONS.length + NOT_ANSWERABLE_CASES.length + POLICY_REFUSAL_CASES.length === 28,
      JSON.stringify({
        answerable: ANSWERABLE_QUESTIONS.length,
        notAnswerable: NOT_ANSWERABLE_CASES.length,
        policyRefusal: POLICY_REFUSAL_CASES.length
      }));
    await makeUser('pro', 'AI Pro Subject Sentinel', {});
    await makeUser('free', 'AI Free Sentinel', {});
    await makeUser('trainingOptout', 'NEVER_MODEL_TRAINING_OPTOUT_SENTINEL', { club_training_analytics_visible: false });
    await makeUser('leaderboardHidden', 'NEVER_MODEL_LEADERBOARD_HIDDEN_SENTINEL', { show_on_leaderboards: false });

    const club = await must('create club', admin.from('clubs').insert({
      owner_id: users.pro.id,
      name: 'AI Privacy Fixture Club ' + nonce,
      handle: ('ai-privacy-' + nonce).slice(0, 20),
      sport: 'running',
      city: 'Portland',
      headline: 'AI privacy fixture',
      description: 'Temporary AI privacy fixture.',
      visibility: 'private'
    }).select('id').single());
    clubId = club.id;
    writeManifest();

    const foreignClub = await must('create foreign club', admin.from('clubs').insert({
      owner_id: users.free.id,
      name: 'FOREIGN_CLUB_NAME_SENTINEL_' + nonce,
      handle: ('ai-foreign-' + nonce).slice(0, 20),
      sport: 'cycling',
      city: 'Seattle',
      headline: 'Foreign fixture',
      description: 'FOREIGN_CLUB_DESCRIPTION_SENTINEL',
      visibility: 'private'
    }).select('id').single());
    foreignClubId = foreignClub.id;
    writeManifest();

    await must('create memberships', admin.from('memberships').insert([
      { user_id: users.pro.id, club_id: clubId, role: 'admin' },
      { user_id: users.trainingOptout.id, club_id: clubId, role: 'member' },
      { user_id: users.leaderboardHidden.id, club_id: clubId, role: 'member' }
    ]));
    const subscription = await must('create Pro subscription', admin.from('subscriptions').insert({
      owner_type: 'user',
      owner_id: users.pro.id,
      plan: 'pro',
      status: 'active',
      stripe_customer_id: 'cus_ai_' + nonce,
      stripe_subscription_id: 'sub_ai_' + nonce,
      ever_paid: true,
      last_paid_subscription_id: 'sub_ai_' + nonce,
      cancel_at_period_end: false
    }).select('id').single());
    subscriptionId = subscription.id;
    writeManifest();

    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    const activityRows = [];
    for (let i = 0; i < 8; i++) {
      // 03:30 UTC on the first belongs to the prior calendar month in Pacific
      // time. It proves buckets follow the athlete's zone, not UTC.
      const activityDate = i === 0
        ? new Date(CURRENT_MONTH_KEY + '-01T03:30:00Z')
        : new Date(today.getTime() - i * 7 * 86400000);
      activityRows.push({
        user_id: users.pro.id,
        sport: i === 2 || i === 3 ? 'cycling' : i === 4 ? 'weightlifting' : 'running',
        title: 'PRO_PRIVATE_TITLE_' + i,
        date: activityDate.toISOString(),
        duration: i === 2 || i === 3 ? '1.04h' : '1h',
        distance: i === 2 ? '10.04 km' : i === 3 ? '11.04 km' : (10 + i) + ' km'
      });
    }
    activityRows.push({
      user_id: users.pro.id,
      sport: 'running',
      title: 'FUTURE_ACTIVITY_MUST_NOT_REACH_MODEL',
      date: new Date(Date.now() + 40 * 86400000).toISOString(),
      duration: '99h',
      distance: '9999 km'
    });
    activityRows.push({
      user_id: users.trainingOptout.id,
      sport: 'cycling',
      title: 'NEVER_MODEL_TRAINING_OPTOUT_ACTIVITY',
      date: today.toISOString(),
      duration: '7h',
      distance: '777 km'
    }, {
      user_id: users.leaderboardHidden.id,
      sport: 'swimming',
      title: 'NEVER_MODEL_LEADERBOARD_HIDDEN_ACTIVITY',
      date: today.toISOString(),
      duration: '9h',
      distance: '999 m'
    });
    await must('create activities', admin.from('activities').insert(activityRows));

    const future = new Date(Date.now() + 3600000).toISOString();
    const futureDay = dayKeyInZone(new Date(future), TEST_TIMEZONE);
    await must('create calendar plans', admin.from('planned_sessions').insert([
      {
        user_id: users.pro.id, date: futureDay, sport: 'running',
        title: 'NEXT_PLAN_ALLOWED_TITLE', planned_duration: '45m',
        notes: 'PLAN_NOTES_MUST_NOT_REACH_PROVIDER', status: 'planned'
      },
      {
        user_id: users.pro.id, date: futureDay, sport: 'weightlifting',
        title: 'SECOND_PLAN_ALLOWED_TITLE', planned_duration: null,
        notes: 'SECOND_PLAN_NOTES_MUST_NOT_REACH_PROVIDER', status: 'planned'
      },
      {
        user_id: users.pro.id, date: futureDay, sport: 'cycling',
        title: 'THIRD_PLAN_ALLOWED_TITLE', planned_duration: '1h 20m',
        notes: 'THIRD_PLAN_NOTES_MUST_NOT_REACH_PROVIDER', status: 'planned'
      },
      {
        user_id: users.pro.id, date: futureDay, sport: 'running',
        title: 'SKIPPED_PLAN_ALLOWED_TITLE', planned_duration: '9h',
        notes: 'SKIPPED_PLAN_NOTES_MUST_NOT_REACH_PROVIDER', status: 'skipped'
      },
      {
        user_id: users.free.id, date: futureDay, sport: 'cycling',
        title: 'OTHER_USER_PLAN_MUST_NOT_REACH_PROVIDER', planned_duration: '9h',
        notes: 'OTHER_USER_PLAN_NOTES_SENTINEL', status: 'planned'
      }
    ]));
    await must('create cycling goal', admin.from('goals').insert({
      user_id: users.pro.id, type: 'distance', sport: 'cycling', target_value: 100,
      unit: 'km', period: 'monthly', status: 'active'
    }));
    const eventRows = await must('create calendar events', admin.from('events').insert([
      {
        created_by: users.pro.id, club_id: clubId, title: 'MEMBER_CLUB_EVENT_ALLOWED',
        sport: 'running', event_type: 'group_run', date: future, visibility: 'club',
        location: 'EVENT_LOCATION_MUST_NOT_REACH_PROVIDER',
        description: 'EVENT_DESCRIPTION_MUST_NOT_REACH_PROVIDER'
      },
      {
        created_by: users.free.id, title: 'OWN_RSVP_PUBLIC_EVENT_ALLOWED',
        sport: 'cycling', event_type: 'ride', date: future, visibility: 'public',
        location: 'RSVP_EVENT_LOCATION_MUST_NOT_REACH_PROVIDER',
        description: 'RSVP_EVENT_DESCRIPTION_MUST_NOT_REACH_PROVIDER'
      },
      {
        created_by: users.free.id, title: 'PUBLIC_NO_RSVP_MUST_NOT_REACH_PROVIDER',
        sport: 'running', event_type: 'race', date: future, visibility: 'public',
        location: 'PUBLIC_NO_RSVP_LOCATION_SENTINEL'
      },
      {
        created_by: users.free.id, club_id: foreignClubId, title: 'FOREIGN_CLUB_EVENT_MUST_NOT_REACH_PROVIDER',
        sport: 'cycling', event_type: 'ride', date: future, visibility: 'club',
        location: 'FOREIGN_CLUB_LOCATION_SENTINEL'
      },
      {
        created_by: users.free.id, title: 'PRIVATE_EVENT_MUST_NOT_REACH_PROVIDER',
        sport: 'running', event_type: 'meetup', date: future, visibility: 'private',
        location: 'PRIVATE_EVENT_LOCATION_SENTINEL'
      }
    ]).select('id, title'));
    const eventId = (title) => eventRows.find((row) => row.title === title).id;
    await must('create calendar rsvps', admin.from('event_rsvps').insert([
      { event_id: eventId('OWN_RSVP_PUBLIC_EVENT_ALLOWED'), user_id: users.pro.id, status: 'going' },
      { event_id: eventId('MEMBER_CLUB_EVENT_ALLOWED'), user_id: users.trainingOptout.id, status: 'going' }
    ]));

    stub = await startStub();
    app = startApp();
    await app.ready;
    const proLogin = await login('pro');
    const freeLogin = await login('free');

    const providerCountBeforeFree = captured.length;
    const freeResult = await api(freeLogin, 'POST', '/api/profile/ai-insights', { question: 'How am I doing?', history: [] });
    check('free user is refused while PLAN_GATES_ENABLED is unset', freeResult.status === 403 && freeResult.body.error === 'pro_required' && freeResult.body.feature === 'ai_insights', JSON.stringify(freeResult));
    check('free denial happens before any provider call', captured.length === providerCountBeforeFree);

    const privacyResult = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Compare my month with other athletes in my club.',
      history: []
    });
    check('Pro comparison request succeeds through captured provider', privacyResult.status === 200 && !!privacyResult.body.historyTurn, JSON.stringify(privacyResult));
    const privacyCapture = captured[captured.length - 1];
    const serializedPayload = JSON.stringify(privacyCapture.body);
    const hybridContextChars = JSON.stringify(privacyCapture.envelope.data).length;
    const legacyContextChars = JSON.stringify(legacyContextProjection(privacyCapture.envelope.data)).length;
    const addedContextChars = hybridContextChars - legacyContextChars;
    console.log(`  info realistic serialized provider request: ${serializedPayload.length} JSON characters (~${Math.ceil(serializedPayload.length / 4)} estimated input tokens)`);
    console.log(`  info hybrid context adds ${addedContextChars} JSON characters (~${Math.ceil(addedContextChars / 4)} estimated input tokens for this fixture)`);
    check('hybrid context stays within the expected incremental token budget',
      addedContextChars > 0 && addedContextChars < 12000,
      JSON.stringify({ hybridContextChars, legacyContextChars, addedContextChars }));
    check('actual provider request selects Claude Haiku 4.5', privacyCapture.body.model === 'claude-haiku-4-5', JSON.stringify(privacyCapture.body));
    check('system prompt demonstrates canonical dot notation with an unquoted numeric value',
      privacyCapture.body.system.includes('{"type":"metric","path":"last12Months.10.durationHours","value":16.4}') &&
      !privacyCapture.body.system.includes('"value":"exact copied value"'),
      privacyCapture.body.system);
    check('actual model payload contains the allowlisted data object', !!privacyCapture.envelope.data && privacyCapture.envelope.data.allTime.activityCount === 8, serializedPayload);
    check('actual model payload has 12 timezone-calendar month buckets including zero months',
      privacyCapture.envelope.data.schemaVersion === 4 &&
      privacyCapture.envelope.data.last12Months.length === 12 &&
      privacyCapture.envelope.data.last12Months.every((month) =>
        JSON.stringify(Object.keys(month).sort()) === JSON.stringify([
          'activeDays', 'averageDistanceKmPerActivity', 'averageHoursPerWeek',
          'averageSessionDurationHours', 'averageSessionsPerWeek', 'distanceKm',
          'durationHours', 'month', 'observedDays', 'restDays', 'sessions', 'sports'
        ])
      ),
      JSON.stringify(privacyCapture.envelope.data.last12Months));
    const lastMonthContext = privacyCapture.envelope.data.last12Months.find((month) => month.month === LAST_MONTH_KEY);
    const expectedLastMonthRows = activityRows.filter((row) =>
      row.user_id === users.pro.id && monthKeyInZone(new Date(row.date), TEST_TIMEZONE) === LAST_MONTH_KEY);
    const expectedLastMonthActiveDays = new Set(expectedLastMonthRows.map((row) =>
      dayKeyInZone(new Date(row.date), TEST_TIMEZONE))).size;
    check('prior month uses Pacific boundaries and calendar-day rest counts without zero-date rows',
      lastMonthContext &&
      lastMonthContext.sessions === expectedLastMonthRows.length &&
      lastMonthContext.activeDays === expectedLastMonthActiveDays &&
      lastMonthContext.restDays === lastMonthContext.observedDays - expectedLastMonthActiveDays &&
      !Object.prototype.hasOwnProperty.call(lastMonthContext, 'dates'),
      JSON.stringify({ month: lastMonthContext, expectedLastMonthRows }));
    check('future-dated activity is excluded from all model facts',
      privacyCapture.envelope.data.allTime.activityCount === 8 &&
      !serializedPayload.includes('9999') &&
      !serializedPayload.includes('99h') &&
      !serializedPayload.includes('FUTURE_ACTIVITY_MUST_NOT_REACH_MODEL'),
      serializedPayload);
    check('last12Weeks has aggregate sports and common averages',
      Array.isArray(privacyCapture.envelope.data.last12Weeks.sports) &&
      privacyCapture.envelope.data.last12Weeks.sports.some((sport) => sport.sport === 'cycling') &&
      ['averageSessionDurationHours', 'averageHoursPerWeek', 'averageSessionsPerWeek', 'averageDistanceKmPerActivity']
        .every((key) => typeof privacyCapture.envelope.data.last12Weeks[key] === 'number'),
      JSON.stringify(privacyCapture.envelope.data.last12Weeks));
    const cyclingContext = privacyCapture.envelope.data.last12Weeks.sports.find((sport) => sport.sport === 'cycling');
    check('averages divide raw values before one-decimal rounding',
      cyclingContext &&
      cyclingContext.averageSessionDurationHours === 1 &&
      cyclingContext.averageDistanceKmPerActivity === 10.5,
      JSON.stringify(cyclingContext));
    check('private-club context is present only as requester scalar standing',
      privacyCapture.envelope.data.standings &&
      Array.isArray(privacyCapture.envelope.data.standings.clubs) &&
      privacyCapture.envelope.data.standings.clubs.some((club) =>
        club.clubName === 'AI Privacy Fixture Club ' + nonce &&
        JSON.stringify(Object.keys(club).sort()) === JSON.stringify(['clubName', 'month', 'role']) &&
        JSON.stringify(Object.keys(club.month).sort()) === JSON.stringify(['activityCount', 'points', 'rank', 'totalRanked'])
      ),
      JSON.stringify(privacyCapture.envelope.data.standings));
    check('training-analytics opt-out identity and activity are absent from actual model payload',
      !serializedPayload.includes(users.trainingOptout.id) &&
      !serializedPayload.includes(users.trainingOptout.name) &&
      !serializedPayload.includes('NEVER_MODEL_TRAINING_OPTOUT_ACTIVITY') &&
      !serializedPayload.includes('777'),
      serializedPayload);
    check('leaderboard-hidden identity and activity are absent from actual model payload',
      !serializedPayload.includes(users.leaderboardHidden.id) &&
      !serializedPayload.includes(users.leaderboardHidden.name) &&
      !serializedPayload.includes('NEVER_MODEL_LEADERBOARD_HIDDEN_ACTIVITY') &&
      !serializedPayload.includes('999'),
      serializedPayload);
    check('actual model payload contains only approved calendar records and fields',
      serializedPayload.includes('NEXT_PLAN_ALLOWED_TITLE') &&
      serializedPayload.includes('MEMBER_CLUB_EVENT_ALLOWED') &&
      serializedPayload.includes('OWN_RSVP_PUBLIC_EVENT_ALLOWED') &&
      !serializedPayload.includes('OTHER_USER_PLAN_MUST_NOT_REACH_PROVIDER') &&
      !serializedPayload.includes('PUBLIC_NO_RSVP_MUST_NOT_REACH_PROVIDER') &&
      !serializedPayload.includes('FOREIGN_CLUB_EVENT_MUST_NOT_REACH_PROVIDER') &&
      !serializedPayload.includes('PRIVATE_EVENT_MUST_NOT_REACH_PROVIDER') &&
      !serializedPayload.includes(users.trainingOptout.id) &&
      !serializedPayload.includes('PLAN_NOTES_MUST_NOT_REACH_PROVIDER') &&
      !serializedPayload.includes('EVENT_LOCATION_MUST_NOT_REACH_PROVIDER') &&
      !serializedPayload.includes('EVENT_DESCRIPTION_MUST_NOT_REACH_PROVIDER') &&
      !/"userId"|"email"|"notes"|"description"|"location"/.test(serializedPayload),
      serializedPayload);
    check('calendar and goal counts are honest for realistic fixture',
      privacyCapture.envelope.data.calendar.plannedSessions.included === 4 &&
      privacyCapture.envelope.data.calendar.plannedSessions.total === 4 &&
      privacyCapture.envelope.data.calendar.plannedSessions.truncated === false &&
      privacyCapture.envelope.data.calendar.plannedSessions.byMonth.some((row) =>
        row.month === CURRENT_MONTH_KEY &&
        row.plannedCount === 3 &&
        row.totalPlannedMinutes === 125 &&
        row.included === 3 &&
        row.truncated === false) &&
      privacyCapture.envelope.data.calendar.events.included === 2 &&
      privacyCapture.envelope.data.calendar.events.total === 2 &&
      privacyCapture.envelope.data.calendar.events.truncated === false &&
      privacyCapture.envelope.data.calendar.events.byMonth.some((row) =>
        row.month === CURRENT_MONTH_KEY &&
        row.count === 2 &&
        row.included === 2 &&
        row.truncated === false) &&
      privacyCapture.envelope.data.goals.active.included === 1 &&
      privacyCapture.envelope.data.goals.active.total === 1,
      JSON.stringify({ calendar: privacyCapture.envelope.data.calendar, goals: privacyCapture.envelope.data.goals }));
    const nextPlanMonth = privacyCapture.envelope.data.calendar.plannedSessions.byMonth
      .find((row) => row.month === NEXT_MONTH_KEY);
    const nextEventMonth = privacyCapture.envelope.data.calendar.events.byMonth
      .find((row) => row.month === NEXT_MONTH_KEY);
    check('future calendar collections fill current and next month with honest zeros',
      privacyCapture.envelope.data.calendar.plannedSessions.byMonth.length === 2 &&
      privacyCapture.envelope.data.calendar.events.byMonth.length === 2 &&
      nextPlanMonth && nextPlanMonth.plannedCount === 0 &&
      nextPlanMonth.totalPlannedMinutes === 0 &&
      nextPlanMonth.included === 0 &&
      nextPlanMonth.truncated === false &&
      nextEventMonth && nextEventMonth.count === 0 &&
      nextEventMonth.included === 0 &&
      nextEventMonth.truncated === false,
      JSON.stringify(privacyCapture.envelope.data.calendar));
    const zeroEventMonth = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return the zero event month fixture.',
      history: []
    });
    check('zero-event month renders the server-owned no-events sentence',
      zeroEventMonth.status === 200 &&
      zeroEventMonth.body.answer === `You have no events scheduled in ${NEXT_MONTH_YEAR_LABEL}.`,
      JSON.stringify(zeroEventMonth.body));
    const zeroPlanMonth = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return the zero plan month fixture.',
      history: []
    });
    check('zero-session month renders the server-owned no-sessions sentence',
      zeroPlanMonth.status === 200 &&
      zeroPlanMonth.body.answer === `You have no planned sessions in ${NEXT_MONTH_YEAR_LABEL}.`,
      JSON.stringify(zeroPlanMonth.body));
    check('goal projection contains only the approved non-free-text fields',
      JSON.stringify(Object.keys(privacyCapture.envelope.data.goals.active.items[0]).sort()) === JSON.stringify([
        'isComplete', 'onTrack', 'period', 'progress', 'sport', 'target', 'type', 'windowEnd', 'windowStart'
      ]),
      JSON.stringify(privacyCapture.envelope.data.goals.active.items[0]));

    const heavyPlans = Array.from({ length: 100 }, (_, index) => ({
      user_id: users.pro.id,
      date: futureDay,
      sport: 'running',
      title: `CAPPED_PLAN_${String(index).padStart(3, '0')}`,
      planned_duration: '30m',
      notes: `CAPPED_PLAN_NOTE_MUST_NOT_REACH_${index}`,
      status: 'planned'
    }));
    await must('create capped plans', admin.from('planned_sessions').insert(heavyPlans));
    const heavyEvents = Array.from({ length: 1001 }, (_, index) => ({
      created_by: users.pro.id,
      club_id: clubId,
      title: `CAPPED_EVENT_${String(index).padStart(3, '0')}`,
      sport: 'running',
      event_type: 'group_run',
      date: new Date(Date.now() + (index + 2) * 3600000).toISOString(),
      visibility: 'club',
      location: `CAPPED_EVENT_LOCATION_MUST_NOT_REACH_${index}`,
      description: `CAPPED_EVENT_DESCRIPTION_MUST_NOT_REACH_${index}`
    }));
    for (let index = 0; index < heavyEvents.length; index += 200) {
      await must(`create capped events ${index}-${Math.min(index + 199, heavyEvents.length - 1)}`,
        admin.from('events').insert(heavyEvents.slice(index, index + 200)));
    }
    const heavyResult = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Measure the heavy capped calendar fixture.',
      history: []
    });
    const heavyCapture = captured[captured.length - 1];
    const heavySerialized = JSON.stringify(heavyCapture.body);
    console.log(`  info heavy capped serialized provider request: ${heavySerialized.length} JSON characters (~${Math.ceil(heavySerialized.length / 4)} estimated input tokens)`);
    const heavyMonthPayload = {
      plannedSessions: heavyCapture.envelope.data.calendar.plannedSessions.byMonth,
      events: heavyCapture.envelope.data.calendar.events.byMonth
    };
    const heavyMonthPayloadWithoutFilledZeros = {
      plannedSessions: heavyMonthPayload.plannedSessions.filter((row) =>
        row.plannedCount !== 0 || row.totalPlannedMinutes !== 0 || row.included !== 0),
      events: heavyMonthPayload.events.filter((row) => row.count !== 0 || row.included !== 0)
    };
    const filledMonthCharacters = JSON.stringify(heavyMonthPayload).length -
      JSON.stringify(heavyMonthPayloadWithoutFilledZeros).length;
    const maximumFilledMonths = Math.max(
      heavyMonthPayload.plannedSessions.length,
      heavyMonthPayload.events.length
    );
    console.log(`  info heavy fixture fills at most ${maximumFilledMonths} calendar months; zero-filled buckets add ${filledMonthCharacters} JSON characters (~${Math.ceil(filledMonthCharacters / 4)} estimated input tokens)`);
    check('heavy fixture month fill stays bounded and its token cost is measured',
      maximumFilledMonths >= 2 &&
      filledMonthCharacters > 0,
      JSON.stringify({ maximumFilledMonths, filledMonthCharacters, heavyMonthPayload }));
    check('heavy calendar fixture is capped with honest totals and no private fields',
      heavyResult.status === 200 &&
      heavyCapture.envelope.data.calendar.plannedSessions.included === 100 &&
      heavyCapture.envelope.data.calendar.plannedSessions.total === 104 &&
      heavyCapture.envelope.data.calendar.plannedSessions.truncated === true &&
      heavyCapture.envelope.data.calendar.events.included === 50 &&
      heavyCapture.envelope.data.calendar.events.total === 1003 &&
      heavyCapture.envelope.data.calendar.events.truncated === true &&
      !heavySerialized.includes('CAPPED_PLAN_NOTE_MUST_NOT_REACH') &&
      !heavySerialized.includes('CAPPED_EVENT_LOCATION_MUST_NOT_REACH') &&
      !heavySerialized.includes('CAPPED_EVENT_DESCRIPTION_MUST_NOT_REACH'),
      JSON.stringify(heavyCapture.envelope.data.calendar));
    check('unrelated metrics do not inherit calendar cap disclosure',
      !heavyResult.body.limitations.includes('Calendar results were capped, so additional matching plans or events are not included.'),
      JSON.stringify(heavyResult.body));
    const heavyPlanMonth = heavyCapture.envelope.data.calendar.plannedSessions.byMonth
      .find((row) => row.month === CURRENT_MONTH_KEY);
    const heavyEventTotal = heavyCapture.envelope.data.calendar.events.byMonth
      .reduce((sum, row) => sum + row.count, 0);
    check('monthly calendar aggregates use complete pre-cap results',
      heavyPlanMonth &&
      heavyPlanMonth.plannedCount === 103 &&
      heavyPlanMonth.totalPlannedMinutes === 3125 &&
      heavyPlanMonth.truncated === true &&
      heavyEventTotal === 1003,
      JSON.stringify({
        plans: heavyCapture.envelope.data.calendar.plannedSessions.byMonth,
        events: heavyCapture.envelope.data.calendar.events.byMonth
      }));
    const truncatedMonthList = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return the truncated month list fixture.',
      history: []
    });
    check('truncated month list is server-rendered with bounded items and disclosure',
      truncatedMonthList.status === 200 &&
      /here are the first 10:/.test(truncatedMonthList.body.answer) &&
      truncatedMonthList.body.answer.includes('You have 103 planned sessions left') &&
      truncatedMonthList.body.limitations.includes('Calendar results were capped, so additional matching plans or events are not included.') &&
      truncatedMonthList.body.evidence.length === 11,
      JSON.stringify(truncatedMonthList.body));
    const futureCountTense = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return the future count tense fixture.',
      history: []
    });
    check('future monthly count metric renders in the present tense',
      futureCountTense.status === 200 &&
      futureCountTense.body.answer === `You have 103 planned sessions left in ${CURRENT_MONTH_YEAR_LABEL}.`,
      JSON.stringify(futureCountTense.body));

    const tampered = { ...privacyResult.body.historyTurn, answer: 'TAMPERED_CLIENT_ANSWER_123456' };
    const historyResult = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'What about last month?',
      history: [tampered]
    });
    const historyCapture = captured[captured.length - 1];
    check('request with tampered history still receives a safe current answer', historyResult.status === 200, JSON.stringify(historyResult));
    check('server reports zero accepted turns after HMAC tampering', historyResult.body.historyAccepted === 0, JSON.stringify(historyResult.body));
    check('tampered answer is discarded before model payload construction',
      Array.isArray(historyCapture.envelope.history) &&
      historyCapture.envelope.history.length === 0 &&
      !JSON.stringify(historyCapture.envelope).includes('TAMPERED_CLIENT_ANSWER_123456'),
      JSON.stringify(historyCapture.envelope));

    const usageBeforeFailure = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
    const forcedFailure = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Force provider failure for the quota refund proof.',
      history: []
    });
    const usageAfterFailure = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
    check('provider failure has its own error code and accurate copy',
      forcedFailure.status === 502 &&
      forcedFailure.body.error === 'ai_provider_unavailable' &&
      forcedFailure.body.message === 'AI Insights couldn’t reach its analysis provider. Your question was not counted. Please try again.',
      JSON.stringify(forcedFailure));
    check('provider failure refunds the exact quota slot',
      usageBeforeFailure.status === 200 &&
      usageAfterFailure.status === 200 &&
      usageAfterFailure.body.used === usageBeforeFailure.body.used &&
      usageAfterFailure.body.remaining === usageBeforeFailure.body.remaining,
      JSON.stringify({ before: usageBeforeFailure.body, after: usageAfterFailure.body }));

    const usageBeforeMalformed = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
    const fabricated = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return a fabricated number for the rejection proof.',
      history: []
    });
    check('fabricated number is rejected as an invalid typed finding', fabricated.status === 200 && fabricated.body.rejectedReason === 'invalid_finding', JSON.stringify(fabricated));
    check('fabricated answer is replaced by exact fallback copy',
      fabricated.body.answer === FALLBACK_COPY &&
      !fabricated.body.answer.includes('987654321'),
      JSON.stringify(fabricated.body));

    const missingPath = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return a fabricated number at a missing path for the rejection proof.',
      history: []
    });
    check('nonexistent evidence path is rejected before rendering',
      missingPath.status === 200 && missingPath.body.rejectedReason === 'missing_path',
      JSON.stringify(missingPath));
    check('nonexistent-path answer is replaced by exact fallback copy',
      missingPath.body.answer === FALLBACK_COPY &&
      !missingPath.body.answer.includes('987654321'),
      JSON.stringify(missingPath.body));

    const mismatched = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return mismatched evidence for the rejection proof.',
      history: []
    });
    check('valid evidence path with mismatched value is rejected', mismatched.status === 200 && mismatched.body.rejectedReason === 'mismatched_value', JSON.stringify(mismatched));
    check('mismatched-value answer is also replaced by exact fallback copy',
      mismatched.body.answer === FALLBACK_COPY,
      JSON.stringify(mismatched.body));

    const usageAfterMalformed = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
    check('all rejected or malformed model outputs refund their exact quota slots',
      usageBeforeMalformed.status === 200 &&
      usageAfterMalformed.status === 200 &&
      usageAfterMalformed.body.used === usageBeforeMalformed.body.used &&
      usageAfterMalformed.body.remaining === usageBeforeMalformed.body.remaining,
      JSON.stringify({ before: usageBeforeMalformed.body, after: usageAfterMalformed.body }));

    const numericString = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return the numeric string fixture.',
      history: []
    });
    check('strict numeric string matching the exposed number is accepted',
      numericString.status === 200 &&
      numericString.body.rejectedReason === undefined &&
      numericString.body.evidence.some((item) =>
        item.path === 'last12Months.10.durationHours' &&
        item.value === privacyCapture.envelope.data.last12Months[10].durationHours),
      JSON.stringify(numericString));

    const bracketPath = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return the bracket path fixture.',
      history: []
    });
    check('bracket notation is accepted and exposed as canonical dot notation',
      bracketPath.status === 200 &&
      bracketPath.body.rejectedReason === undefined &&
      bracketPath.body.evidence.some((item) =>
        item.path === 'last12Months.10.durationHours' &&
        item.value === privacyCapture.envelope.data.last12Months[10].durationHours),
      JSON.stringify(bracketPath));

    const usageBeforeComputed = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
    const computedValue = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return the computed value fixture.',
      history: []
    });
    const usageAfterComputed = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
    check('computed numeric value still fails the unchanged evidence comparison',
      computedValue.status === 200 &&
      computedValue.body.rejectedReason === 'mismatched_value' &&
      computedValue.body.answer === FALLBACK_COPY,
      JSON.stringify(computedValue));
    check('computed-value rejection refunds its exact quota slot',
      usageBeforeComputed.body.used === usageAfterComputed.body.used &&
      usageBeforeComputed.body.remaining === usageAfterComputed.body.remaining,
      JSON.stringify({ before: usageBeforeComputed.body, after: usageAfterComputed.body }));

    const listFilterDiagnostic = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return the list filter diagnostic fixture.',
      history: []
    });
    check('valid list filter plus an arbitrary key is rejected with filter diagnostics',
      listFilterDiagnostic.status === 200 &&
      listFilterDiagnostic.body.rejectedReason === 'invalid_finding' &&
      listFilterDiagnostic.body.answer === FALLBACK_COPY,
      JSON.stringify(listFilterDiagnostic));

    const rejectionLogs = app.output().split('\n').filter((line) => line.includes('AI Insights validation rejection:'));
    check('rejection diagnostics include safe scalar mismatch values and types only on allowlisted paths',
      rejectionLogs.some((line) => line.includes('"rejectedReason":"invalid_finding"') && line.includes('"offendingPath":"allTime.activityCount"')) &&
      rejectionLogs.some((line) => line.includes('"rejectedReason":"missing_path"') && line.includes('"offendingPath":"last12Months.99.durationHours"')) &&
      rejectionLogs.some((line) =>
        line.includes('"rejectedReason":"mismatched_value"') &&
        line.includes('"offendingPath":"allTime.activityCount"') &&
        line.includes('"expectedValue":8') &&
        line.includes('"receivedValue":9') &&
        line.includes('"expectedType":"number"') &&
        line.includes('"receivedType":"number"')) &&
      rejectionLogs.some((line) =>
        line.includes('"rejectedReason":"mismatched_value"') &&
        line.includes('"offendingPath":"last12Months.10.durationHours"') &&
        line.includes('"expectedType":"number"') &&
        line.includes('"receivedType":"number"')) &&
      rejectionLogs.some((line) =>
        line.includes('"rejectedReason":"invalid_finding"') &&
        line.includes('"offendingPath":"calendar.plannedSessions.items"') &&
        line.includes('"filterPresent":true') &&
        line.includes('"filterValid":true') &&
        line.includes('"type":"calendar_plan_list"')) &&
      rejectionLogs.every((line) =>
        line.includes('"filterPresent":') &&
        line.includes('"filterValid":') &&
        line.includes('"findingCount":') &&
        line.includes('"findings":') &&
        !line.includes('Return ') &&
        !line.includes('987654321') &&
        !line.includes('PRIVATE') &&
        !line.includes('"question"') &&
        !line.includes('"title"')),
      rejectionLogs.join(' | '));

    for (const question of ANSWERABLE_QUESTIONS) {
      const providerCountBefore = captured.length;
      const result = await api(proLogin, 'POST', '/api/profile/ai-insights', {
        question,
        history: []
      });
      const providerRecord = captured[captured.length - 1];
      check('answerable question reaches provider: ' + question,
        captured.length === providerCountBefore + 1 &&
        providerRecord.envelope.question === question,
        JSON.stringify(result));
      const expectedFindings = findingsForAnswerableQuestion(question, providerRecord.envelope.data);
      const expectedListKeys = new Set(expectedFindings.map((finding) => {
        if (finding.type === 'calendar_plan_list') return `plan:${finding.filter.month}`;
        if (finding.type === 'calendar_event_list') return `event:${finding.filter.month}`;
        return null;
      }).filter(Boolean));
      const expectedPaths = expectedFindings.flatMap((finding) => {
        if (finding.type === 'comparison') return [finding.leftPath, finding.rightPath];
        let countMatch = finding.type === 'metric' &&
          finding.path.match(/^calendar\.plannedSessions\.byMonth\.(\d+)\.plannedCount$/);
        if (countMatch) {
          const row = providerRecord.envelope.data.calendar.plannedSessions.byMonth[Number(countMatch[1])];
          if (row && expectedListKeys.has(`plan:${row.month}`)) return [];
        }
        countMatch = finding.type === 'metric' &&
          finding.path.match(/^calendar\.events\.byMonth\.(\d+)\.count$/);
        if (countMatch) {
          const row = providerRecord.envelope.data.calendar.events.byMonth[Number(countMatch[1])];
          if (row && expectedListKeys.has(`event:${row.month}`)) return [];
        }
        if (finding.type === 'calendar_plan_list' || finding.type === 'calendar_event_list') {
          const parentPath = finding.type === 'calendar_plan_list'
            ? 'calendar.plannedSessions' : 'calendar.events';
          const parent = valueAtPath(providerRecord.envelope.data, parentPath);
          const monthIndex = parent.byMonth.findIndex((row) => row.month === finding.filter.month);
          return [`${parentPath}.byMonth.${monthIndex}`];
        }
        return [finding.path];
      });
      check('answerable question returns relevant real findings: ' + question,
        result.status === 200 &&
        result.body.answer !== FALLBACK_COPY &&
        result.body.answer !== REFUSAL_COPY &&
        result.body.policyRefusal !== true &&
        result.body.notAnswerable !== true &&
        expectedPaths.every((expectedPath) => result.body.evidence.some((item) => item.path === expectedPath)) &&
        JSON.stringify(providerRecord.output.findings) === JSON.stringify(expectedFindings),
        JSON.stringify({ body: result.body, output: providerRecord.output, expectedPaths }));
      if (question === 'How many planned sessions do I have left this month and what are they?') {
        const countPhrase = `planned sessions left in ${CURRENT_MONTH_YEAR_LABEL}`;
        check('same-month count plus plan list renders one count-bearing sentence',
          (result.body.answer.match(new RegExp(countPhrase, 'g')) || []).length === 1 &&
          !result.body.answer.includes(`${countPhrase} was`),
          result.body.answer);
      }
    }

    for (const notAnswerableCase of NOT_ANSWERABLE_CASES) {
      const usageBeforeNotAnswerable = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
      const providerCountBefore = captured.length;
      const result = await api(proLogin, 'POST', '/api/profile/ai-insights', {
        question: notAnswerableCase.question,
        history: []
      });
      const usageAfterNotAnswerable = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
      const providerRecord = captured[captured.length - 1];
      check('not-answerable question reaches provider: ' + notAnswerableCase.question,
        captured.length === providerCountBefore + 1 &&
        providerRecord.envelope.question === notAnswerableCase.question,
        JSON.stringify(result));
      check('not-answerable question gets reason-specific server copy, not fallback: ' + notAnswerableCase.question,
        result.status === 200 &&
        result.body.answer === notAnswerableCase.copy &&
        result.body.answer !== FALLBACK_COPY &&
        result.body.notAnswerable === true &&
        result.body.notAnswerableReason === notAnswerableCase.reason &&
        result.body.evidence.length === 0 &&
        JSON.stringify(providerRecord.output.findings) === JSON.stringify([{ type: 'not_answerable', reason: notAnswerableCase.reason }]),
        JSON.stringify({ body: result.body, output: providerRecord.output }));
      check('not-answerable result does not consume quota: ' + notAnswerableCase.question,
        usageBeforeNotAnswerable.status === 200 &&
        usageAfterNotAnswerable.status === 200 &&
        usageAfterNotAnswerable.body.used === usageBeforeNotAnswerable.body.used &&
        usageAfterNotAnswerable.body.remaining === usageBeforeNotAnswerable.body.remaining,
        JSON.stringify({ before: usageBeforeNotAnswerable.body, after: usageAfterNotAnswerable.body }));
    }

    for (const policyCase of POLICY_REFUSAL_CASES) {
      const usageBeforePolicy = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
      const providerCountBefore = captured.length;
      const result = await api(proLogin, 'POST', '/api/profile/ai-insights', {
        question: policyCase.question,
        history: []
      });
      const usageAfterPolicy = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
      const providerRecord = captured[captured.length - 1];
      check('policy question reaches provider classification: ' + policyCase.question,
        captured.length === providerCountBefore + 1 &&
        providerRecord.envelope.question === policyCase.question,
        JSON.stringify(result));
      check('policy refusal uses exact server copy with no model prose: ' + policyCase.question,
        result.status === 200 &&
        result.body.answer === REFUSAL_COPY &&
        result.body.policyRefusal === true &&
        result.body.policyReason === policyCase.reason &&
        JSON.stringify(Object.keys(providerRecord.output.findings[0]).sort()) === JSON.stringify(['reason', 'type']),
        JSON.stringify({ body: result.body, output: providerRecord.output }));
      check('policy refusal does not consume quota: ' + policyCase.question,
        usageBeforePolicy.status === 200 &&
        usageAfterPolicy.status === 200 &&
        usageAfterPolicy.body.used === usageBeforePolicy.body.used &&
        usageAfterPolicy.body.remaining === usageBeforePolicy.body.remaining,
        JSON.stringify({ before: usageBeforePolicy.body, after: usageAfterPolicy.body }));
    }

    const usageBeforeMiss = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
    const classifierMiss = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Should I be doing more cardio? Force policy classifier miss.',
      history: []
    });
    const usageAfterMiss = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
    const missRecord = captured[captured.length - 1];
    check('classifier miss can only render a grounded descriptive metric, never advice',
      classifierMiss.status === 200 &&
      classifierMiss.body.answer === GROUNDED_METRIC_COPY &&
      classifierMiss.body.policyRefusal !== true &&
      missRecord.output.findings.length === 1 &&
      missRecord.output.findings[0].type === 'metric' &&
      !/should|recommend|increase|decrease|rest/i.test(classifierMiss.body.answer),
      JSON.stringify({ body: classifierMiss.body, output: missRecord.output }));
    check('grounded answer after classifier miss consumes one normal quota slot',
      usageBeforeMiss.status === 200 &&
      usageAfterMiss.status === 200 &&
      usageAfterMiss.body.used === usageBeforeMiss.body.used + 1 &&
      usageAfterMiss.body.remaining === usageBeforeMiss.body.remaining - 1,
      JSON.stringify({ before: usageBeforeMiss.body, after: usageAfterMiss.body }));

    const { launchBrowser } = await import('./lib/mobile-geometry.js');
    browser = await launchBrowser();
    const proContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await proContext.addCookies(proLogin.browserCookies);
    const proPage = await proContext.newPage();
    const proBrowserErrors = [];
    proPage.on('console', (message) => { if (message.type() === 'error') proBrowserErrors.push(message.text()); });
    proPage.on('pageerror', (error) => proBrowserErrors.push(String(error)));
    await proPage.goto(BASE + '/profile#insights', { waitUntil: 'networkidle' });
    await proPage.locator('#ai-insights-question').fill('How many activities have I logged?');
    await proPage.locator('#ai-insights-form button[type="submit"]').click();
    await proPage.locator('#ai-insights-thread').getByText('Your all-time activity count was 8.').waitFor();
    check('Pro browser renders the returned AI answer',
      (await proPage.locator('#ai-insights-thread').innerText()).includes('Your all-time activity count was 8.'));
    check('successful Pro browser rendering leaves the inline error empty',
      (await proPage.locator('#ai-insights-error').innerText()).trim() === '',
      await proPage.locator('#ai-insights-error').innerText());

    await proPage.route('**/api/profile/ai-insights', async (route) => {
      const providerResponse = await route.fetch();
      const body = await providerResponse.json();
      body.evidence = [null];
      await route.fulfill({
        response: providerResponse,
        contentType: 'application/json',
        body: JSON.stringify(body)
      });
    });
    await proPage.locator('#ai-insights-question').fill('Show this answer through the plain-text fallback.');
    await proPage.locator('#ai-insights-form button[type="submit"]').click();
    const renderedAnswers = proPage.locator('#ai-insights-thread').getByText('Your all-time activity count was 8.', { exact: true });
    await renderedAnswers.nth(1).waitFor();
    check('post-200 enhanced-render failure still displays the answer as plain text',
      await renderedAnswers.count() === 2);
    check('plain-text fallback leaves the inline error empty',
      (await proPage.locator('#ai-insights-error').innerText()).trim() === '',
      await proPage.locator('#ai-insights-error').innerText());
    check('Pro answer and fallback paths have zero console/page errors',
      proBrowserErrors.length === 0,
      proBrowserErrors.join(' | '));
    await proContext.close();
    await browser.close();
    browser = null;

    // Fill every still-open durable slot directly. Successful descriptive
    // answers remain claimed; provider failures, policy refusals, and malformed
    // outputs leave reusable holes by deleting their exact source key.
    const period = new Date().toISOString().slice(0, 7);
    const existingUsageRows = await must('read claimed quota slots', admin.from('notifications')
      .select('source_key')
      .eq('user_id', users.pro.id)
      .eq('type', 'ai_insights_usage')
      .like('source_key', `ai-insights:${period}:%`));
    const existingSourceKeys = new Set(existingUsageRows.map((row) => row.source_key));
    const remainingSlots = [];
    for (let slot = 1; slot <= 30; slot++) {
      const sourceKey = `ai-insights:${period}:${String(slot).padStart(2, '0')}`;
      if (existingSourceKeys.has(sourceKey)) continue;
      remainingSlots.push({
        user_id: users.pro.id,
        actor_id: null,
        type: 'ai_insights_usage',
        title: 'AI Insights usage',
        body: 'Monthly usage counter',
        link: null,
        read: true,
        source_key: sourceKey
      });
    }
    await must('fill quota slots', admin.from('notifications').insert(remainingSlots));
    const fullStatus = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
    check('status reports the durable 30-question cap is exhausted',
      fullStatus.status === 200 && fullStatus.body.used === 30 && fullStatus.body.remaining === 0,
      JSON.stringify(fullStatus));
    const providerCountBeforeLimit = captured.length;
    const capped = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'How many activities did I log?',
      history: []
    });
    check('31st question is refused with 429 and reset date',
      capped.status === 429 && capped.body.error === 'ai_insights_limit' && capped.body.remaining === 0 && !!capped.body.resetDate,
      JSON.stringify(capped));
    check('quota refusal happens before any provider call', captured.length === providerCountBeforeLimit);
    const visibleNotifications = await api(proLogin, 'GET', '/api/notifications');
    check('quota slot rows never appear in the notification API',
      visibleNotifications.status === 200 &&
      !(visibleNotifications.body.notifications || []).some((row) => row.type === 'ai_insights_usage'),
      JSON.stringify(visibleNotifications.body));

    browser = await launchBrowser();
    const freeContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await freeContext.addCookies(freeLogin.browserCookies);
    const page = await freeContext.newPage();
    const browserErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
    page.on('pageerror', (error) => browserErrors.push(String(error)));
    await page.goto(BASE + '/profile#insights', { waitUntil: 'networkidle' });
    check('AI Insights tab is visible between Stats & PRs and Goals',
      await page.locator('.htab').evaluateAll((tabs) => {
        const labels = tabs.map((tab) => tab.textContent.trim().replace(/\s+/g, ' '));
        return labels.indexOf('AI Insights') === labels.indexOf('Stats & PRs') + 1 &&
          labels.indexOf('Goals') === labels.indexOf('AI Insights') + 1;
      }));
    check('free user sees the visible $9/month upgrade prompt',
      await page.locator('#tab-insights').innerText().then((text) =>
        text.includes('AI Insights is a Pro feature') &&
        text.includes('Upgrade to Pro · $9/month')
      ));
    check('free profile AI tab has zero console/page errors', browserErrors.length === 0, browserErrors.join(' | '));
    await freeContext.close();
    await browser.close();
    browser = null;

    check('fixture manifest exists during verification', fs.existsSync(MANIFEST));
  } catch (error) {
    failures++;
    console.error('FATAL', error && error.stack ? error.stack : error);
    if (app) console.error('CHILD OUTPUT\n' + app.output());
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (app && app.child) {
      app.child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (app.child.exitCode == null) app.child.kill('SIGKILL');
    }
    if (stub) await new Promise((resolve) => stub.close(resolve));
    try {
      await cleanup();
      check('manifest removed after cleanup', !fs.existsSync(MANIFEST));
      const remainingUsers = await Promise.all(Object.values(users).map((user) => admin.auth.admin.getUserById(user.id)));
      check('all fixture auth users are gone', remainingUsers.every((result) => !result.data || !result.data.user));
      if (clubId) {
        const { count } = await admin.from('clubs').select('id', { count: 'exact', head: true }).eq('id', clubId);
        check('fixture club is gone', count === 0);
      }
    } catch (cleanupError) {
      failures++;
      console.error('CLEANUP FAILED', cleanupError && cleanupError.stack ? cleanupError.stack : cleanupError);
    }
  }
  if (failures) {
    console.error(`\n${failures} FAILURE(S)`);
    process.exitCode = 1;
  } else {
    console.log('\nALL AI INSIGHTS CHECKS PASSED');
  }
})();