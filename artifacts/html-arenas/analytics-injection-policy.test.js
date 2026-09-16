const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldInjectAnalytics } = require('./analytics-injection-policy');

test('only the recap unsubscribe capability route is excluded from analytics injection', () => {
  assert.equal(shouldInjectAnalytics('/email/unsubscribe/recap'), false);
  assert.equal(shouldInjectAnalytics('/html/email/unsubscribe/recap', '/html'), false);
  assert.equal(shouldInjectAnalytics('/privacy'), true);
  assert.equal(shouldInjectAnalytics('/email/unsubscribe/recap/other'), true);
});