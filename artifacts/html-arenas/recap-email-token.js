const crypto = require('crypto');

const PURPOSE = 'weekly_recap_email';
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validIssuedAt(value) {
  return typeof value === 'string' && value.length <= 80 && Number.isFinite(Date.parse(value));
}

function payloadFor(userId, issuedAt) {
  return JSON.stringify({ userId, purpose: PURPOSE, issuedAt });
}

function signingInput(userId, issuedAt) {
  return `${userId}\n${PURPOSE}\n${issuedAt}`;
}

function signRecapEmailToken(userId, issuedAt, secret = process.env.SESSION_SECRET) {
  if (!USER_ID_RE.test(String(userId || '')) || !validIssuedAt(issuedAt) || typeof secret !== 'string' || !secret) {
    throw new Error('Cannot sign weekly recap email token');
  }
  const payload = Buffer.from(payloadFor(userId, issuedAt)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(signingInput(userId, issuedAt))
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifyRecapEmailToken(token, secret = process.env.SESSION_SECRET) {
  if (typeof token !== 'string' || typeof secret !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (error) {
    return null;
  }
  if (!payload || Object.keys(payload).length !== 3 ||
      !USER_ID_RE.test(String(payload.userId || '')) ||
      payload.purpose !== PURPOSE || !validIssuedAt(payload.issuedAt)) return null;
  const expected = crypto.createHmac('sha256', secret)
    .update(signingInput(payload.userId, payload.issuedAt))
    .digest('base64url');
  const actual = Buffer.from(parts[1]);
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length) return null;
  try {
    if (!crypto.timingSafeEqual(actual, expectedBuffer)) return null;
  } catch (error) {
    return null;
  }
  return { userId: payload.userId, issuedAt: payload.issuedAt };
}

module.exports = { PURPOSE, signRecapEmailToken, verifyRecapEmailToken };