// Shared Resend transport. This module deliberately has no Express dependency
// so background jobs can use the same sender as web-request paths.
const EMAIL_FROM = 'Arenas <noreply@send.realarenas.com>';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Existing request-path sender. Keep its graceful return contract and recipient
// logging unchanged for account and invite mail callers.
async function sendEmail({ to, subject, html, text, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log('[email skipped: no RESEND_API_KEY] To:', to, '| Subject:', subject);
    return { ok: false, skipped: true };
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {})
      })
    });
    if (!resp.ok) {
      let detail = '';
      try { detail = await resp.text(); } catch (e) { /* ignore */ }
      console.error('[email failed]', resp.status, '| To:', to, '| Subject:', subject, '|', detail.slice(0, 500));
      return { ok: false, status: resp.status, error: detail };
    }
    let id = null;
    try { const j = await resp.json(); id = j && j.id; } catch (e) { /* ignore */ }
    console.log('[email sent]', id || '(no id)', '| To:', to, '| Subject:', subject);
    return { ok: true, id };
  } catch (err) {
    console.error('[email error]', (err && err.message) || err, '| To:', to, '| Subject:', subject);
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

// Sends a previously persisted JSON payload without parsing or serializing it.
// Its stable key and exact body make every retry byte-identical. Unlike the
// legacy sender, it never logs a recipient or message content.
async function sendFrozenEmail(payloadString, idempotencyKey, extraHeaders = {}, deps = {}) {
  const key = deps.apiKey === undefined ? process.env.RESEND_API_KEY : deps.apiKey;
  const doFetch = deps.fetch || fetch;
  if (typeof payloadString !== 'string' || !payloadString) {
    return { ok: false, error: 'Invalid frozen email payload' };
  }
  if (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 256) {
    return { ok: false, error: 'Invalid email idempotency key' };
  }
  if (!key) {
    console.log('[recap email skipped: no RESEND_API_KEY]');
    return { ok: false, skipped: true };
  }
  try {
    const resp = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...extraHeaders
      },
      body: payloadString
    });
    if (!resp.ok) {
      // Provider bodies may reflect recipient addresses or List-Unsubscribe
      // URLs. Do not write or return them on the recap path.
      try { await resp.text(); } catch (e) { /* ignore */ }
      console.error('[recap email failed]', resp.status);
      return { ok: false, status: resp.status, error: 'Email provider rejected recap delivery' };
    }
    let id = null;
    try { const body = await resp.json(); id = body && body.id; } catch (e) { /* ignore */ }
    if (!id) return { ok: false, status: resp.status, error: 'Resend response did not include a message id' };
    console.log('[recap email sent]', id);
    return { ok: true, id };
  } catch (err) {
    // Network/client messages can include request details. Keep this transport
    // opaque; the runner records a generic delivery failure instead.
    console.error('[recap email transport error]');
    return { ok: false, error: 'Recap email transport error' };
  }
}

module.exports = { EMAIL_FROM, escapeHtml, sendEmail, sendFrozenEmail };