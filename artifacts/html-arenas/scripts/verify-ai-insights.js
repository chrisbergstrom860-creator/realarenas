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
      timezone: 'UTC',
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
  if (/fabricated/i.test(question)) {
    output = {
      findings: [{ type: 'metric', path: 'allTime.activityCount', value: count, displayValue: 987654321 }],
      limitations: []
    };
  } else if (/mismatched/i.test(question)) {
    output = {
      findings: [{ type: 'metric', path: 'allTime.activityCount', value: count + 1 }],
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
          captured.push({ path: req.url, headers: req.headers, body, envelope });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(responseFor(envelope)));
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
      activityRows.push({
        user_id: users.pro.id,
        sport: 'running',
        title: 'PRO_PRIVATE_TITLE_' + i,
        date: new Date(today.getTime() - i * 7 * 86400000).toISOString(),
        duration: '1h',
        distance: (10 + i) + ' km'
      });
    }
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
    check('actual provider request selects Claude Haiku 4.5', privacyCapture.body.model === 'claude-haiku-4-5', JSON.stringify(privacyCapture.body));
    check('actual model payload contains the allowlisted data object', !!privacyCapture.envelope.data && privacyCapture.envelope.data.allTime.activityCount === 8, serializedPayload);
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

    const fabricated = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return a fabricated number for the rejection proof.',
      history: []
    });
    check('fabricated number is rejected as an invalid typed finding', fabricated.status === 200 && fabricated.body.rejectedReason === 'invalid_finding', JSON.stringify(fabricated));
    check('fabricated answer is replaced by exact fallback copy',
      fabricated.body.answer === "I couldn’t produce an answer supported by your recorded data. Try asking about your activity count, volume, sports, streaks, personal records, or standings." &&
      !fabricated.body.answer.includes('987654321'),
      JSON.stringify(fabricated.body));

    const mismatched = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Return mismatched evidence for the rejection proof.',
      history: []
    });
    check('valid evidence path with mismatched value is rejected', mismatched.status === 200 && mismatched.body.rejectedReason === 'mismatched_value', JSON.stringify(mismatched));
    check('mismatched-value answer is also replaced by exact fallback copy',
      mismatched.body.answer === "I couldn’t produce an answer supported by your recorded data. Try asking about your activity count, volume, sports, streaks, personal records, or standings.",
      JSON.stringify(mismatched.body));

    const providerCountBeforeAdvice = captured.length;
    const advice = await api(proLogin, 'POST', '/api/profile/ai-insights', {
      question: 'Should I rest tomorrow and increase my mileage next week?',
      history: []
    });
    check('advice request gets exact deterministic refusal',
      advice.status === 200 &&
      advice.body.answer === "I can describe your recorded training, but I can’t prescribe workouts or comment on diet, weight, body composition, or whether you are under-training. Try asking what changed in your volume, consistency, sports, personal records, or standings.",
      JSON.stringify(advice.body));
    check('deterministic advice refusal consumes no model call', captured.length === providerCountBeforeAdvice);

    // Fill the remaining durable quota slots directly. The route's four prior
    // provider calls claimed slots 01–04 through the same unique constraint.
    const period = new Date().toISOString().slice(0, 7);
    const remainingSlots = [];
    for (let slot = 5; slot <= 30; slot++) {
      remainingSlots.push({
        user_id: users.pro.id,
        actor_id: null,
        type: 'ai_insights_usage',
        title: 'AI Insights usage',
        body: 'Monthly usage counter',
        link: null,
        read: true,
        source_key: `ai-insights:${period}:${String(slot).padStart(2, '0')}`
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

    const { launchBrowser } = await import('./lib/mobile-geometry.js');
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