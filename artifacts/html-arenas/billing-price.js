'use strict';

// Single source of truth for the recurring-price string shown to a subscriber.
// The ARL confirmation email and the /billing/success page both use these
// helpers, so the price is always derived from the REAL Stripe price object and
// a Stripe price change (promo, increase) is reflected everywhere at once — the
// two can never drift or state a stale amount.

// Neutral, non-stale fallback used ONLY when the real price can't be read from
// Stripe. It deliberately states no numeric amount (an assumed number could be
// wrong and is the exact staleness bug we're preventing) and points the
// subscriber at their authoritative Stripe receipt instead.
const PRICE_FALLBACK_LABEL = 'the price shown on your Stripe receipt';

// Format a Stripe price object as a human "$9/month" label from its real
// unit_amount / currency / recurring.interval. Returns null when the price
// object is unusable (callers substitute PRICE_FALLBACK_LABEL). Whole amounts
// render as "$9/month", not "$9.00/month".
function formatStripePriceLabel(price) {
  if (!price || typeof price.unit_amount !== 'number') return null;
  const currency = String(price.currency || 'usd').toLowerCase();
  const symbols = { usd: '$', eur: '\u20ac', gbp: '\u00a3', cad: 'CA$', aud: 'A$', nzd: 'NZ$', jpy: '\u00a5' };
  const symbol = symbols[currency] || '';
  // JPY and other zero-decimal currencies have no minor units.
  const zeroDecimal = currency === 'jpy';
  const major = zeroDecimal ? price.unit_amount : price.unit_amount / 100;
  const amountStr = Number.isInteger(major) ? String(major) : major.toFixed(2);
  const money = symbol ? symbol + amountStr : amountStr + ' ' + currency.toUpperCase();
  const interval = (price.recurring && price.recurring.interval) || 'month';
  return money + '/' + interval;
}

// Pull the recurring price object off a retrieved Stripe subscription. The
// subscription's first item carries unit_amount/currency/recurring.interval.
function subscriptionPrice(sub) {
  const item = sub && sub.items && Array.isArray(sub.items.data) ? sub.items.data[0] : null;
  return (item && item.price) || null;
}

// Canonical label for a retrieved subscription: the real formatted price, or
// the neutral fallback. This is what callers should use so email and page share
// exactly one code path.
function subscriptionPriceLabel(sub) {
  return formatStripePriceLabel(subscriptionPrice(sub)) || PRICE_FALLBACK_LABEL;
}

module.exports = {
  PRICE_FALLBACK_LABEL,
  formatStripePriceLabel,
  subscriptionPrice,
  subscriptionPriceLabel
};
