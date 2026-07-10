'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  PRICE_FALLBACK_LABEL,
  formatStripePriceLabel,
  subscriptionPrice,
  subscriptionPriceLabel
} = require('./billing-price');

const price = (unit_amount, currency, interval) => ({
  unit_amount,
  currency,
  recurring: { interval: interval || 'month' }
});
const sub = (p) => ({ items: { data: p ? [{ price: p }] : [] } });

test('formats the current Individual Pro price as "$9/month"', () => {
  assert.strictEqual(formatStripePriceLabel(price(900, 'usd')), '$9/month');
});

test('formats the current Club Pro price as "$29/month"', () => {
  assert.strictEqual(formatStripePriceLabel(price(2900, 'usd')), '$29/month');
});

test('keeps cents for non-whole amounts (a price change to $12.50)', () => {
  assert.strictEqual(formatStripePriceLabel(price(1250, 'usd')), '$12.50/month');
});

test('reflects a Stripe price increase instead of a stale hardcoded value', () => {
  assert.strictEqual(formatStripePriceLabel(price(1200, 'usd')), '$12/month');
  assert.strictEqual(formatStripePriceLabel(price(3900, 'usd')), '$39/month');
});

test('honors currency and interval from the price object', () => {
  assert.strictEqual(formatStripePriceLabel(price(900, 'eur', 'year')), '\u20ac9/year');
  assert.strictEqual(formatStripePriceLabel(price(500, 'jpy')), '\u00a5500/month');
});

test('returns null for an unusable price object', () => {
  assert.strictEqual(formatStripePriceLabel(null), null);
  assert.strictEqual(formatStripePriceLabel({}), null);
  assert.strictEqual(formatStripePriceLabel({ currency: 'usd' }), null);
});

test('subscriptionPrice reads items.data[0].price', () => {
  const p = price(900, 'usd');
  assert.strictEqual(subscriptionPrice(sub(p)), p);
  assert.strictEqual(subscriptionPrice(sub(null)), null);
  assert.strictEqual(subscriptionPrice(null), null);
});

test('subscriptionPriceLabel returns the real formatted price, never a hardcoded $9/$29 guess', () => {
  assert.strictEqual(subscriptionPriceLabel(sub(price(900, 'usd'))), '$9/month');
  assert.strictEqual(subscriptionPriceLabel(sub(price(2900, 'usd'))), '$29/month');
});

test('subscriptionPriceLabel falls back to the neutral non-stale label, not a numeric amount', () => {
  const fallback = subscriptionPriceLabel(sub(null));
  assert.strictEqual(fallback, PRICE_FALLBACK_LABEL);
  assert.doesNotMatch(fallback, /\$\d/, 'fallback must not assert any numeric price');
});
