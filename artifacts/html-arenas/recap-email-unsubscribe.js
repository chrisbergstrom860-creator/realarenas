const { verifyRecapEmailToken } = require('./recap-email-token');

// Kept transport-agnostic so it can be exercised without starting Express.
// The callback is the same server-side preference writer used by Settings.
async function unsubscribeRecapEmail(token, { secret, writePreference }) {
  const verified = verifyRecapEmailToken(token, secret);
  if (!verified) return { ok: false, status: 400, reason: 'invalid_token' };
  if (typeof writePreference !== 'function') return { ok: false, status: 503, reason: 'unavailable' };
  const result = await writePreference(verified.userId, 'weekly_recap_email', false);
  if (!result || !result.ok) {
    return { ok: false, status: (result && result.status) || 503, reason: (result && result.error) || 'unavailable' };
  }
  return { ok: true, userId: verified.userId };
}

module.exports = { unsubscribeRecapEmail };