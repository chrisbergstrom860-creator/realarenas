// Capability URLs must never cause the browser to load analytics. Keep this
// deliberately exact: all other HTML routes retain the global injection.
function shouldInjectAnalytics(requestPath, basePath = '') {
  const base = String(basePath || '').replace(/\/$/, '');
  return requestPath !== `${base}/email/unsubscribe/recap`;
}

module.exports = { shouldInjectAnalytics };