'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const parsers = require('./html/arenas-parse');
const runtime = require('./ai-insights-runtime');
const { extractFunction } = require('./scripts/verify-calendar-stats-readonly');

// Pinned pre-extraction production source, not a reimplementation of the
// original parsers. Offline only: no server, network, or persisted fixtures.
const original = execFileSync('git', ['show', 'b247435:artifacts/html-arenas/server.js'], {
  cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
});
const legacy = vm.createContext({});
for (const name of ['parseDistanceKmUnitAware', 'parseDurationHours']) {
  vm.runInContext(extractFunction(original, name), legacy);
}
const browser = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(require.resolve('./html/arenas-parse'), 'utf8'), browser);

const parityInputs = [
  '10 mi', '2,000m', '12.4', '45:00', '1:30', '1h 20m', '45', '1', '', 'garbage',
  null, undefined, 0, 1, 45, '0 km', '10MI', '1,234.5km', '500 metres',
  '-5 km', '1.2.3km', '12', '12:59', '13:00', '0:59', '1:02', '1:75',
  '45:75', 'abc:30', '1:', ':30', '1x:2x', '1.5:30', '-1:30', ' 1:30 ',
  '2h', '20 min', '1.5h 20.5m', '-45', '12.1', 'Infinity:00'
];

for (const name of ['parseDistanceKmUnitAware', 'parseDurationHours']) {
  test(`${name}: old/new/Node/browser parity for all unchanged formats`, () => {
    for (const input of parityInputs) {
      const expected = legacy[name](input);
      assert.equal(parsers[name](input), expected, `${name}(${JSON.stringify(input)})`);
      assert.equal(browser.window.arenasParse[name](input), expected, `browser ${name}(${JSON.stringify(input)})`);
    }
  });
}

test('runtime exports the identical shared functions; server requires them and serves both browser routes', () => {
  assert.equal(runtime.parseDurationHours, parsers.parseDurationHours);
  assert.equal(runtime.parseDistanceKmUnitAware, parsers.parseDistanceKmUnitAware);
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  assert.match(source, /const \{ parseDistanceKmUnitAware, parseDurationHours, formatPace \} = require\('\.\/html\/arenas-parse'\)/);
  assert.doesNotMatch(source, /function parse(?:DistanceKmUnitAware|DurationHours)\(/);
  const context = vm.createContext({
    app: { get(routes, handler) {
      assert.deepEqual(Array.from(routes), ['/html/arenas-parse.js', '/arenas-parse.js']);
      handler({}, { sendFile(file) { assert.equal(file, '/html/arenas-parse.js'); } });
    } },
    HTML: '/html',
    path: require('node:path')
  });
  const route = source.match(/app\.get\(\['\/html\/arenas-parse\.js'[\s\S]*?\n\}\);/);
  assert.ok(route, 'shared browser module route');
  vm.runInContext(route[0], context);
  assert.match(source, /value: formatPace\(best\.pace\) \+ ' \/km'/);
});

test('strict three-part H:MM:SS includes seconds in Node, browser, and runtime', () => {
  for (const [input, seconds] of [
    ['1:02:15', 3735], ['0:59:59', 3599], ['2:00:00', 7200],
    ['0:00:00', 0], ['0:00:01', 1], ['12:59:59', 46799],
    ['13:00:00', 46800], [' 1:02:15 ', 3735], ['01:02:03', 3723]
  ]) {
    for (const api of [parsers, browser.window.arenasParse, runtime]) {
      assert.equal(api.parseDurationHours(input), seconds / 3600, input);
    }
  }
  assert.ok(Math.abs(parsers.parseDurationHours('1:02:15') * 3600 - 3735) < 1e-9);
  assert.equal(legacy.parseDurationHours('1:02:15'), 62 / 60, 'documents the approved change');
  assert.equal(parsers.parseDurationHours('1:02'), 62 / 60, 'two-part semantics unchanged');
});

test('malformed three-part and longer durations are invalid, never partially parsed', () => {
  for (const input of [
    '1:75:00', '1:60:00', '1:00:60', '1:02:', ':02:15', '1::15',
    '1:02:15:00', '1:02:15:', ':::',
    '1h:02:15', '1:02:15s', '-1:02:15', '1:-2:15', '1:02:-15',
    '+1:02:15', '1.5:02:15', '1:2.5:15', '1:02:1.5', '1: 02:15',
    'garbage:02:15', 'Infinity:02:15'
  ]) {
    for (const api of [parsers, browser.window.arenasParse, runtime]) {
      assert.equal(api.parseDurationHours(input), 0, input);
    }
  }
});

test('formatPace carries rounded seconds; requested run and swim values', () => {
  for (const api of [parsers, browser.window.arenasParse]) {
    assert.equal(api.formatPace(parsers.parseDurationHours('1:02:15') * 60 / parsers.parseDistanceKmUnitAware('12.4 km')), '5:01');
    assert.equal(api.formatPace(parsers.parseDurationHours('40:00') * 60 / (parsers.parseDistanceKmUnitAware('2,000m') * 10)), '2:00');
    assert.equal(api.formatPace(4 + 59.6 / 60), '5:00');
    assert.equal(api.formatPace(59 + 59.6 / 60), '60:00');
    assert.equal(api.formatPace(4 + 59.4 / 60), '4:59');
    assert.equal(api.formatPace(0), '0:00');
    for (const input of [NaN, Infinity, -1, null, undefined, '5']) assert.equal(api.formatPace(input), '');
  }
});

test('AI prose duration formatter delegates to shared parser and preserves legacy minute rounding/nulls', () => {
  const source = fs.readFileSync(require.resolve('./ai-insights'), 'utf8');
  assert.match(source, /const \{ parseDurationHours \} = require\('\.\/html\/arenas-parse'\)/);
  assert.doesNotMatch(extractFunction(source, 'durationMinutes'), /split\(':'\)/);
  const context = vm.createContext({ parseDurationHours: parsers.parseDurationHours });
  vm.runInContext(extractFunction(source, 'durationMinutes'), context);
  for (const input of parityInputs) {
    const expected = Math.round(legacy.parseDurationHours(input) * 60);
    assert.equal(context.durationMinutes(input), expected > 0 ? expected : null, String(input));
  }
  assert.equal(context.durationMinutes('1:02:15'), 62);
  assert.equal(context.durationMinutes('0:59:59'), 60);
  assert.equal(context.durationMinutes('2:00:00'), 120);
  assert.equal(context.durationMinutes('1:75:00'), null);
  assert.equal(context.durationMinutes('1:02:'), null);
});