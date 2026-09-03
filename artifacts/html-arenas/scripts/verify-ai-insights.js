const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const APP_PORT = 3987;
const STUB_PORT = 3988;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PASSWORD = 'AiInsightsVerify!234';
const MANIFEST = '/tmp/verify-ai-insights-manifest.json';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const nonce = Date.now().toString(36);
const users = {};
let clubId = null;
let subscriptionId = null;
let failures = 0;
const captured = [];
const REFUSAL_COPY = "I can describe your recorded training, but I can’t prescribe workouts or comment on diet, weight, body composition, or whether you are under-training. Try asking what changed in your volume, consistency, sports, personal records, or standings.";
const GROUNDED_METRIC_COPY = 'Your all-time activity count was 8.';
const FALLBACK_COPY = "I couldn’t produce an answer supported by your recorded data. Try asking about your activity count, volume, sports, streaks, personal records, or standings.";
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
  'What percentage of my recorded training was running?'
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
    await must('cleanup notifications', admin.from('notifications').delete().in('user_id', ids));
  }
  if (subscriptionId) await must('cleanup subscription', admin.from('subscriptions').delete().eq('id', subscriptionId));
  if (clubId) {
    await must('cleanup memberships', admin.from('memberships').delete().eq('club_id', clubId));
    await must('cleanup club', admin.from('clubs').delete().eq('id', clubId));
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
    const serializedPayload = JSON.stringify(privacyCapture.envelope);
    const hybridContextChars = JSON.stringify(privacyCapture.envelope.data).length;
    const legacyContextChars = JSON.stringify(legacyContextProjection(privacyCapture.envelope.data)).length;
    const addedContextChars = hybridContextChars - legacyContextChars;
    console.log(`  info hybrid context adds ${addedContextChars} JSON characters (~${Math.ceil(addedContextChars / 4)} estimated input tokens for this fixture)`);
    check('hybrid context stays within the expected incremental token budget',
      addedContextChars > 0 && addedContextChars < 12000,
      JSON.stringify({ hybridContextChars, legacyContextChars, addedContextChars }));
    check('actual provider request selects Claude Haiku 4.5', privacyCapture.body.model === 'claude-haiku-4-5', JSON.stringify(privacyCapture.body));
    check('actual model payload contains the allowlisted data object', !!privacyCapture.envelope.data && privacyCapture.envelope.data.allTime.activityCount === 8, serializedPayload);
    check('actual model payload has 12 timezone-calendar month buckets including zero months',
      privacyCapture.envelope.data.schemaVersion === 2 &&
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
    check('actual model payload contains no raw activity title or user id fields',
      !/"title"|"userId"|"email"|"notes"/.test(serializedPayload), serializedPayload);

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
      fabricated.body.answer === "I couldn’t produce an answer supported by your recorded data. Try asking about your activity count, volume, sports, streaks, personal records, or standings." &&
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
      missingPath.body.answer === "I couldn’t produce an answer supported by your recorded data. Try asking about your activity count, volume, sports, streaks, personal records, or standings." &&
      !missingPath.body.answer.includes('987654321'),
      JSON.stringify(missingPath.body));

    const mismatched = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return mismatched evidence for the rejection proof.',
      history: []
    });
    check('valid evidence path with mismatched value is rejected', mismatched.status === 200 && mismatched.body.rejectedReason === 'mismatched_value', JSON.stringify(mismatched));
    check('mismatched-value answer is also replaced by exact fallback copy',
      mismatched.body.answer === "I couldn’t produce an answer supported by your recorded data. Try asking about your activity count, volume, sports, streaks, personal records, or standings.",
      JSON.stringify(mismatched.body));

    const usageAfterMalformed = await api(proLogin, 'GET', '/api/profile/ai-insights/status');
    check('all rejected or malformed model outputs refund their exact quota slots',
      usageBeforeMalformed.status === 200 &&
      usageAfterMalformed.status === 200 &&
      usageAfterMalformed.body.used === usageBeforeMalformed.body.used &&
      usageAfterMalformed.body.remaining === usageBeforeMalformed.body.remaining,
      JSON.stringify({ before: usageBeforeMalformed.body, after: usageAfterMalformed.body }));
    const rejectionLogs = app.output().split('\n').filter((line) => line.includes('AI Insights validation rejection:'));
    check('rejection diagnostics log only reason and offending path',
      rejectionLogs.some((line) => line.includes('"rejectedReason":"invalid_finding"') && line.includes('"offendingPath":"allTime.activityCount"')) &&
      rejectionLogs.some((line) => line.includes('"rejectedReason":"missing_path"') && line.includes('"offendingPath":"last12Months.99.durationHours"')) &&
      rejectionLogs.some((line) => line.includes('"rejectedReason":"mismatched_value"') && line.includes('"offendingPath":"allTime.activityCount"')) &&
      rejectionLogs.every((line) => !line.includes('Return ') && !line.includes('987654321')),
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
      const expectedPaths = expectedFindings.flatMap((finding) =>
        finding.type === 'comparison' ? [finding.leftPath, finding.rightPath] : [finding.path]);
      check('answerable question returns relevant real findings: ' + question,
        result.status === 200 &&
        result.body.answer !== FALLBACK_COPY &&
        result.body.answer !== REFUSAL_COPY &&
        result.body.policyRefusal !== true &&
        result.body.notAnswerable !== true &&
        expectedPaths.every((expectedPath) => result.body.evidence.some((item) => item.path === expectedPath)) &&
        JSON.stringify(providerRecord.output.findings) === JSON.stringify(expectedFindings),
        JSON.stringify({ body: result.body, output: providerRecord.output, expectedPaths }));
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