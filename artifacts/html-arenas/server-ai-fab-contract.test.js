const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function section(startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing section start: ${startText}`);
  const end = source.indexOf(endText, start);
  assert.notEqual(end, -1, `missing section end: ${endText}`);
  return source.slice(start, end);
}

const bottomNavSource = section(
  'function bnItem(activeKey, key, onclick, icon, label, primary) {',
  '// Avatar dropdown enhancement:'
);
const aiFabSource = section(
  'function hasInsightsLoader(html, loader, assetName) {',
  '// ── PRO BADGE ──'
);

function render(pageKey, showAiFab, head = '') {
  const context = vm.createContext({
    BASE: '/html',
    MANAGED_CLUBS_MENU_SCRIPT: '',
    injectNotificationsPanel: (html) => html
  });
  vm.runInContext(`${bottomNavSource}\n${aiFabSource}`, context);
  return context.injectBottomNav(
    `<html><head>${head}</head><body><main>Page</main></body></html>`,
    pageKey,
    { showAiFab }
  );
}

function count(html, needle) {
  return html.split(needle).length - 1;
}

function loaderIndex(html, loader) {
  return html.indexOf(`data-arenas-insights-loader="${loader}"`);
}

test('Pro athlete page renders both FABs, their nav classes, and ordered loaders', () => {
  const html = render('feed', true);
  assert.equal(count(html, 'class="bn-fab bn-fab-ai"'), 1);
  assert.match(html, /class="bottom-nav bn-has-fab bn-has-ai-fab"/);
  assert.equal(count(html, 'aria-label="Log activity"'), 1);
  assert.equal(count(html, 'aria-label="Ask AI Insights"'), 1);
  assert.equal(count(html, 'data-arenas-insights-loader="overlay"'), 1);
  assert.equal(count(html, 'data-arenas-insights-loader="module"'), 1);
  assert.equal(count(html, 'data-arenas-insights-loader="sheet"'), 1);
  assert.ok(loaderIndex(html, 'module') < loaderIndex(html, 'sheet'));
});

test('free athlete page renders no AI FAB or AI loaders', () => {
  const html = render('events', false);
  assert.equal(count(html, 'bn-fab-ai'), 0);
  assert.equal(count(html, 'bn-has-ai-fab'), 0);
  assert.equal(count(html, 'data-arenas-insights-loader='), 0);
  assert.equal(count(html, 'aria-label="Log activity"'), 1);
});

for (const pageKey of ['log', 'club-dashboard', 'club-member:overview', 'club-member-leaderboard']) {
  test(`AI is excluded from ${pageKey} even for Pro viewers`, () => {
    const html = render(pageKey, true);
    assert.equal(count(html, 'bn-fab-ai'), 0);
    assert.equal(count(html, 'bn-has-ai-fab'), 0);
    assert.equal(count(html, 'data-arenas-insights-loader='), 0);
  });
}

test('profile keeps its actual module tag and adds only the Pro sheet loader', () => {
  const html = render('profile', true, '<script src="/html/arenas-insights.js"></script>');
  assert.equal(count(html, 'arenas-insights.js'), 1);
  assert.equal(count(html, 'data-arenas-insights-loader="module"'), 0);
  assert.equal(count(html, 'data-arenas-insights-loader="sheet"'), 1);
  assert.equal(count(html, 'class="bn-fab bn-fab-ai"'), 1);
});

test('an actual preloaded module script is not injected a second time', () => {
  const html = render('feed', true, '<script src="/html/arenas-insights.js"></script>');
  assert.equal(count(html, 'arenas-insights.js'), 1);
  assert.equal(count(html, 'data-arenas-insights-loader="module"'), 0);
  assert.equal(count(html, 'data-arenas-insights-loader="sheet"'), 1);
});

test('loader detection ignores a user-data filename and remains marker-deduplicated', () => {
  const userData = '<script>window.ARENAS_DATA={"bio":"arenas-insights.js"}</script>';
  const first = render('feed', true, userData);
  assert.equal(count(first, 'data-arenas-insights-loader="module"'), 1);

  const context = vm.createContext({
    BASE: '/html',
    MANAGED_CLUBS_MENU_SCRIPT: '',
    injectNotificationsPanel: (html) => html
  });
  vm.runInContext(`${bottomNavSource}\n${aiFabSource}`, context);
  const second = context.injectAiInsightsLoaders(first, 'feed', true);
  assert.equal(count(second, 'data-arenas-insights-loader="overlay"'), 1);
  assert.equal(count(second, 'data-arenas-insights-loader="module"'), 1);
  assert.equal(count(second, 'data-arenas-insights-loader="sheet"'), 1);
});