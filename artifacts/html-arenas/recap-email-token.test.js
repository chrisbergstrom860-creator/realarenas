const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { signRecapEmailToken, verifyRecapEmailToken } = require('./recap-email-token');
const { unsubscribeRecapEmail } = require('./recap-email-unsubscribe');

const USER = '4e3cd18f-2c09-4ce9-ada1-67fbe725fcd4';
const ISSUED = '2026-09-14T07:00:00.000Z';
const SECRET = 'test-secret';

test('weekly recap email tokens verify, reject tampering, and reject a wrong purpose', async () => {
  const token = signRecapEmailToken(USER, ISSUED, SECRET);
  assert.deepEqual(verifyRecapEmailToken(token, SECRET), { userId: USER, issuedAt: ISSUED });
  assert.equal(verifyRecapEmailToken(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), SECRET), null);

  const wrongPayload = Buffer.from(JSON.stringify({
    userId: USER, purpose: 'another_purpose', issuedAt: ISSUED
  })).toString('base64url');
  const wrongSignature = crypto.createHmac('sha256', SECRET)
    .update(`${USER}\nanother_purpose\n${ISSUED}`)
    .digest('base64url');
  assert.equal(verifyRecapEmailToken(`${wrongPayload}.${wrongSignature}`, SECRET), null);
});

test('unsubscribe sets only the email preference and remains idempotent', async () => {
  const token = signRecapEmailToken(USER, ISSUED, SECRET);
  const calls = [];
  const writePreference = async (userId, key, value) => {
    calls.push({ userId, key, value });
    return { ok: true, prefs: { weekly_recap: true, weekly_recap_email: false } };
  };
  assert.deepEqual(await unsubscribeRecapEmail(token, { secret: SECRET, writePreference }), { ok: true, userId: USER });
  assert.deepEqual(await unsubscribeRecapEmail(token, { secret: SECRET, writePreference }), { ok: true, userId: USER });
  assert.deepEqual(calls, [
    { userId: USER, key: 'weekly_recap_email', value: false },
    { userId: USER, key: 'weekly_recap_email', value: false }
  ]);
  assert.deepEqual(await unsubscribeRecapEmail('not-a-token', { secret: SECRET, writePreference }), {
    ok: false, status: 400, reason: 'invalid_token'
  });
  assert.equal(calls.length, 2, 'a malformed token must not invoke the preference writer');
});