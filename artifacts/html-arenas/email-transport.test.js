const test = require('node:test');
const assert = require('node:assert/strict');
const { sendFrozenEmail } = require('./email-transport');

test('frozen recap transport preserves the stored payload bytes and adds headers', async () => {
  const payload = '{\\n  \"to\":[\"founder@example.test\"], \"subject\":\"x\"\\n}';
  let request;
  const result = await sendFrozenEmail(payload, 'weekly-recap-email:abc', {
    'List-Unsubscribe': '<https://www.realarenas.com/email/unsubscribe/recap?t=x>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  }, {
    apiKey: 'test-key',
    fetch: async (url, init) => {
      request = { url, init };
      return { ok: true, status: 200, json: async () => ({ id: 'email-id' }) };
    }
  });
  assert.deepEqual(result, { ok: true, id: 'email-id' });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.init.body, payload);
  assert.equal(request.init.headers['Idempotency-Key'], 'weekly-recap-email:abc');
  assert.equal(request.init.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('frozen recap transport never logs or returns a provider body', async () => {
  const privateDetail = 'recipient=founder@example.test&token=private-unsubscribe-token';
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const result = await sendFrozenEmail('{"to":["founder@example.test"]}', 'weekly-recap-email:reject', {}, {
      apiKey: 'test-key',
      fetch: async () => ({
        ok: false,
        status: 422,
        text: async () => privateDetail
      })
    });
    assert.deepEqual(result, {
      ok: false,
      status: 422,
      error: 'Email provider rejected recap delivery'
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(logged.join('\n').includes(privateDetail), false);
  assert.equal(logged.join('\n').includes('founder@example.test'), false);
  assert.equal(logged.join('\n').includes('private-unsubscribe-token'), false);
});