// Pure browser guard for the real container-mounted AI Insights SVG renderer.
// It deliberately drives arenas-insights.js rather than copying the renderer:
// fixed response fixtures exercise daily (84 slots),
// stacked weekly, monthly, and six-series feelings output without any server,
// login, or durable test data.
//
// Run only after arenas-insights.js is present:
//   node scripts/verify-insights-chart.js
//
// Screenshots are diagnostic artifacts only and are written exclusively to
// /tmp/verify-insights-chart-<variant>-<width>.png.
import { createRequire } from 'node:module';
import { launchBrowser } from './lib/mobile-geometry.js';
import { currentCss, currentModule, setProofPage } from './lib/insights-proof.js';

const require = createRequire(import.meta.url);
const { SPORTS } = require('../sports');
const {
  INSIGHTS_CHART_BAR_COLOR,
  INSIGHTS_FEELING_SERIES
} = require('../ai-insights');
const SPORT_BY_ID = new Map(SPORTS.map((sport) => [sport.id, sport]));
const WIDTHS = [
  { viewport: 360 },
  { viewport: 414 },
  { viewport: 1280 }
];
let failures = 0;
let assertions = 0;
function check(name, ok, detail) {
  assertions++;
  if (ok) console.log('  ok  ' + name);
  else {
    failures++;
    console.error('FAIL  ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 1000) : ''));
  }
}

function dateAt(start, offset) {
  const date = new Date(start + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function totals(series, labels) {
  return labels.map((_, index) => series.reduce((sum, item) => sum + item.values[index], 0));
}

function sportSeries(key, label, values) {
  const sport = SPORT_BY_ID.get(key);
  if (!sport) throw new Error(`Unknown canonical fixture sport: ${key}`);
  return { key, label: label == null ? sport.label : label, color: sport.colors.text, values };
}

function feelingSeries(key, values) {
  const feeling = INSIGHTS_FEELING_SERIES.find((item) => item.key === key);
  if (!feeling) throw new Error(`Unknown canonical fixture feeling: ${key}`);
  return { key, label: feeling.label, color: feeling.color, values };
}

const fixtures = {
  daily: (() => {
    const labels = Array.from({ length: 84 }, (_, index) => dateAt('2026-07-01', index));
    const values = labels.map((_, index) => index % 11 === 0 ? 4 : index % 5 === 0 ? 1 : 0);
    return {
      metric: 'sessions', unit: 'sessions', period: 'daily',
      title: 'Sessions per day — last 12 weeks', caption: '',
      labels, relative: [],
      series: [{ key: 'sessions', label: 'Sessions', color: INSIGHTS_CHART_BAR_COLOR, values }],
      totals: values
    };
  })(),
  weeklyStacked: (() => {
    const labels = Array.from({ length: 12 }, (_, index) => dateAt('2026-07-06', index * 7));
    const series = [
      // Labels are deliberately hostile; colors still come only from the
      // registered sport palette rather than a test-only alternate palette.
      sportSeries('running', 'Running <unsafe>', [3, 1, 0, 2, 3, 1, 4, 0, 2, 1, 3, 2]),
      sportSeries('cycling', 'Cycling & gravel', [1, 2, 3, 0, 1, 2, 0, 3, 1, 2, 0, 1]),
      sportSeries('weightlifting', 'Weightlifting "strength"', [0, 2, 1, 3, 0, 1, 2, 1, 3, 0, 1, 2])
    ];
    return {
      metric: 'sessions', unit: 'sessions', period: 'weekly',
      title: 'Sessions <unsafe> per week', caption: 'Includes <cycling> & hiking',
      labels, relative: labels.map((_, index) => `${11 - index}_weeks_ago`), series,
      totals: totals(series, labels)
    };
  })(),
  // A server-resolved stack can contain just one sport. Its key is still the
  // sport id (rather than chart.metric), which is the client contract for
  // retaining the segment class and its legend instead of treating it as a
  // filtered single-series chart.
  singleSportStacked: (() => {
    const labels = Array.from({ length: 12 }, (_, index) => dateAt('2026-07-06', index * 7));
    const values = [2, 0, 3, 1, 2, 4, 1, 2, 0, 3, 2, 1];
    return {
      metric: 'sessions', unit: 'sessions', period: 'weekly',
      title: 'Sessions per week — Cycling', caption: 'Cycling',
      labels, relative: labels.map((_, index) => `${11 - index}_weeks_ago`),
      series: [sportSeries('cycling', null, values)],
      totals: values,
      expectLegend: true,
      screenshot: false
    };
  })(),
  monthly: (() => {
    const labels = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return `2025-${String(month).padStart(2, '0')}`;
    });
    const values = [0, 4, 7, 2, 8, 5, 10, 6, 3, 9, 1, 11];
    return {
      metric: 'distanceKm', unit: 'km', period: 'monthly',
      title: 'Distance (km) per month — last 12 months', caption: 'Includes cycling and hiking',
      labels, relative: labels.map((_, index) => `${11 - index}_months_ago`),
      series: [{ key: 'distanceKm', label: 'Distance (km)', color: INSIGHTS_CHART_BAR_COLOR, values }],
      totals: values
    };
  })(),
  feelings: (() => {
    const labels = Array.from({ length: 12 }, (_, index) => dateAt('2026-07-06', index * 7));
    const series = [
      feelingSeries('strong', [1, 0, 2, 1, 0, 3, 1, 0, 2, 1, 0, 1]),
      feelingSeries('motivated', [0, 2, 1, 0, 1, 0, 2, 1, 0, 2, 1, 0]),
      feelingSeries('easy', [2, 1, 0, 1, 2, 0, 1, 2, 1, 0, 2, 1]),
      feelingSeries('tired', [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2]),
      feelingSeries('sore', [1, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1]),
      feelingSeries('struggled', [0, 1, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0])
    ];
    return {
      metric: 'feelings', unit: 'count', period: 'weekly',
      title: 'Feeling counts per week — last 12 weeks', caption: '',
      labels, relative: labels.map((_, index) => `${11 - index}_weeks_ago`), series,
      totals: totals(series, labels)
    };
  })()
};

// Stored recap extras use sport (not key) and decimal durationHours. Adapt
// only the envelope here, exactly as mountStoredRecap does in the browser.
const recapHours = (() => {
  const labels = Array.from({ length: 11 }, (_, index) => dateAt('2026-07-06', index * 7));
  const storedSeries = [
    { sport: 'running', label: 'Running <unsafe>', color: SPORT_BY_ID.get('running').colors.text,
      values: [1.2, 0, 2.5, 0, 1.1, 0, 0.8, 2.2, 0, 1, 1.4] },
    { sport: 'cycling', label: 'Cycling & gravel', color: SPORT_BY_ID.get('cycling').colors.text,
      values: [0.7, 0, 0, 0, 2.3, 0, 0.5, 0, 0, 0, 0.2] }
  ];
  const series = storedSeries.map((item) => ({ ...item, key: item.sport }));
  return {
    metric: 'hours', unit: 'hours', period: 'weekly',
    title: 'Hours per week — 11 weeks to Sep 20', caption: 'Includes <cycling> & running',
    labels, relative: labels.map((_, index) => index === 10 ? 'last_week' : `${11 - index}_weeks_ago`),
    series, totals: totals(series, labels), zeroSlot: 1, expectWrap: false
  };
})();
fixtures.recapHours = recapHours;

// Founder-shaped synthetic feelings data: six series over twelve weeks,
// with a stacked peak of 11 (no account reads or durable fixtures).
fixtures.feelingsMax11 = {
  ...fixtures.feelings,
  series: fixtures.feelings.series.map((item, index) => ({
    ...item, values: item.values.map((value, week) => week === 5 ? [3, 2, 1, 2, 1, 2][index] : value)
  })),
  expectedTicks: [0, 5, 10, 15]
};
fixtures.feelingsMax11.totals = totals(fixtures.feelingsMax11.series, fixtures.feelingsMax11.labels);
for (const [max, expectedTicks] of [[2, [0, 1, 2]], [47, [0, 20, 40, 60]]]) {
  fixtures['sessionsMax' + max] = {
    metric: 'sessions', unit: 'sessions', period: 'weekly',
    title: 'Sessions per week', labels: ['2026-08-31', '2026-09-07'],
    series: [{ key: 'sessions', label: 'Sessions', color: INSIGHTS_CHART_BAR_COLOR, values: [1, max] }],
    totals: [1, max], expectedTicks, screenshot: false
  };
}

async function renderFixture(page, fixture, width, css, moduleSource) {
  await setProofPage(page, { css, moduleSource, width: width.viewport });
  await page.evaluate((chart) => { window.__insightsProofFixture = { chart }; }, fixture);
  const hostLocator = page.locator('#tab-insights');
  await hostLocator.locator('textarea').fill('Render this resolved chart.');
  await hostLocator.locator('form').evaluate((form) => form.requestSubmit());
  await hostLocator.locator('svg[role="img"]').waitFor();
  const report = await page.evaluate((fixture) => {
    const host = document.getElementById('tab-insights');
    const svg = host.querySelector('svg[role="img"]');
    const colors = [...host.querySelectorAll('[fill], [style*="fill"]')].flatMap((node) => {
      const values = [node.getAttribute('fill'), node.style.fill];
      return values.filter((value) => /^#[0-9a-f]{6}$/i.test(value || '')).map((value) => value.toUpperCase());
    });
    const titles = svg ? [...svg.querySelectorAll('title')].map((node) => node.textContent) : [];
    const firstLabelTitles = titles.slice(0, fixture.series.length);
    const legend = host.querySelector('.ai-chart-legend');
    const legendItems = legend ? [...legend.querySelectorAll('[role="listitem"]')].map((node) => node.getBoundingClientRect().toJSON()) : [];
    const hostRect = host.getBoundingClientRect();
    const svgRect = svg && svg.getBoundingClientRect();
    const gridYs = [...svg.querySelectorAll('.ai-chart-grid')].map((node) => node.getBoundingClientRect().top);
    const baseline = Math.max(...gridYs);
    const plotHeight = baseline - Math.min(...gridYs);
    const bars = [...svg.querySelectorAll('.ai-chart-bar')];
    const barTops = bars.map((node) => node.getBoundingClientRect().top);
    return {
      yLabels: [...svg.querySelectorAll('.ai-chart-axis-label')].map((node) => node.textContent),
      plotHeight,
      barCount: bars.length,
      emptySlotHeights: fixture.zeroSlot == null ? null :
        bars.slice(fixture.zeroSlot * fixture.series.length, (fixture.zeroSlot + 1) * fixture.series.length)
          .map((node) => Number(node.getAttribute('height'))),
      tallestBarHeight: baseline - Math.min(baseline, ...barTops),
      html: host.innerHTML,
      svgCount: host.querySelectorAll('svg[role="img"]').length,
      aria: svg && svg.getAttribute('aria-label'),
      titleCount: titles.length,
      titles,
      firstLabelTitles,
      colors,
      host: hostRect.toJSON(),
      svg: svgRect && svgRect.toJSON(),
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      injectedNodes: [...host.querySelectorAll('unsafe, cycling, script, img')].map((node) => node.tagName.toLowerCase()),
      legendRole: legend && legend.getAttribute('role'),
      legendItems,
      legendRows: new Set(legendItems.map((rect) => Math.round(rect.top))).size,
      // outerHTML intentionally normalizes '<' inside ARIA attributes.  Test
      // the text-node serialization separately so a safe aria label does not
      // look like an escaping regression merely because of DOM serialization.
      escapedText: [...host.querySelectorAll('.ai-chart-title, .ai-chart-caption, .ai-chart-legend-item, .ai-chart-svg title')]
        .map((node) => node.innerHTML).join('\n')
    };
  }, fixture);
  return report;
}

function assertFixture(name, fixture, result, width) {
  const tickValues = result.yLabels.map(Number);
  const max = Math.max(...totals(fixture.series, fixture.labels));
  const countUnit = fixture.unit === 'sessions' || fixture.unit === 'count';
  if (countUnit) {
    check(`${name}@${width.viewport}: count tick labels are integers`,
      result.yLabels.length > 0 && result.yLabels.every((label) => /^\d+$/.test(label)), result.yLabels);
    check(`${name}@${width.viewport}: ticks strictly increase`,
      tickValues.every((value, index) => index === 0 || value > tickValues[index - 1]), tickValues);
    check(`${name}@${width.viewport}: top tick covers the stacked maximum`,
      tickValues.at(-1) >= max, { tickValues, max });
    check(`${name}@${width.viewport}: count scale has two to four ticks`,
      tickValues.length >= 2 && tickValues.length <= 4, tickValues);
  } else {
    check(`${name}@${width.viewport}: continuous tick labels have at most one decimal`,
      result.yLabels.every((label) => /^\d+(?:\.\d)?$/.test(label)), result.yLabels);
  }
  check(`${name}@${width.viewport}: tallest stacked bar fits the plot`,
    result.barCount === fixture.labels.length * fixture.series.length &&
    result.plotHeight > 0 && result.tallestBarHeight <= result.plotHeight + 0.01, result);
  if (fixture.zeroSlot != null) {
    check(`${name}@${width.viewport}: zero week is an empty slot`,
      result.emptySlotHeights.length === fixture.series.length &&
      result.emptySlotHeights.every((height) => height === 0), result.emptySlotHeights);
  }
  if (fixture.expectedTicks) {
    check(`${name}@${width.viewport}: exact nice ticks`,
      JSON.stringify(tickValues) === JSON.stringify(fixture.expectedTicks), tickValues);
  }
  const expectedTitleCount = fixture.labels.length * fixture.series.length;
  const hasEscapingSentinel = JSON.stringify(fixture).includes('<unsafe>') || JSON.stringify(fixture).includes('<cycling>');
  check(`${name}@${width.viewport}: exactly one accessible SVG`, result.svgCount === 1 &&
    typeof result.aria === 'string' && result.aria.includes(fixture.title.replace('<unsafe>', '&lt;unsafe&gt;') === fixture.title ? fixture.title : 'Sessions') &&
    /(?:max|highest|peak)/i.test(result.aria), result);
  check(`${name}@${width.viewport}: one titled bar or segment per resolved value`,
    result.titleCount === expectedTitleCount, { expectedTitleCount, actual: result.titleCount });
  check(`${name}@${width.viewport}: bar titles preserve every context label, series, and value`,
    result.titles.length === expectedTitleCount && fixture.labels.every((label, index) =>
      fixture.series.every((series) => {
        const title = result.titles[index * fixture.series.length + fixture.series.indexOf(series)] || '';
        return title.includes(label) && title.includes(series.label) && title.includes(String(series.values[index]));
      })), { titles: result.titles.slice(0, Math.max(12, fixture.series.length)) });
  check(`${name}@${width.viewport}: stacked segment order follows resolved series order`,
    fixture.series.length === 1 || fixture.series.every((series, index) =>
      (result.firstLabelTitles[index] || '').includes(series.label)), result.firstLabelTitles);
  check(`${name}@${width.viewport}: every resolved series colour is used by the SVG`,
    fixture.series.every((series) => result.colors.includes(series.color.toUpperCase())),
    { expected: fixture.series.map((series) => series.color), actual: [...new Set(result.colors)] });
  check(`${name}@${width.viewport}: all renderer text is escaped`,
    !result.escapedText.includes('<unsafe>') && !result.escapedText.includes('<cycling>') &&
    (!hasEscapingSentinel || (result.escapedText.includes('&lt;unsafe&gt;') && result.escapedText.includes('&lt;cycling&gt;'))) &&
    result.injectedNodes.length === 0, result);
  check(`${name}@${width.viewport}: stacked legends expose every series and multi-series legends wrap on mobile`,
    !(fixture.expectLegend || fixture.series.length > 1) ||
    (result.legendRole === 'list' && result.legendItems.length === fixture.series.length &&
       (fixture.series.length === 1 || width.viewport > 768 || fixture.expectWrap === false || result.legendRows >= 2)),
    { role: result.legendRole, items: result.legendItems, rows: result.legendRows });
  check(`${name}@${width.viewport}: SVG does not overflow its measured container`,
    result.svg && result.svg.width <= result.host.width + 1 &&
    result.svg.left >= result.host.left - 1 && result.svg.right <= result.host.right + 1 &&
    result.pageOverflow <= 1, { host: result.host, svg: result.svg, overflow: result.pageOverflow });
}

async function assertStoredRecap(page, width, css, moduleSource) {
  await setProofPage(page, { css, moduleSource, width: width.viewport });
  const result = await page.evaluate((hours) => {
    const host = document.getElementById('tab-insights');
    const chart = { ...hours, extras: {
      sportSplit: [
        { sport: 'running', label: 'Running <unsafe>', color: hours.series[0].color, sessions: 2, hours: 1.2, km: 8 },
        { sport: 'cycling', label: 'Cycling & gravel', color: hours.series[1].color, sessions: 1, hours: 0.7, km: 0 }
      ],
      hoursBySport: { labels: hours.labels, relative: hours.relative, totals: hours.totals,
        series: hours.series.map((item) => ({
          sport: item.key, label: item.label, color: item.color, values: item.values
        })) }
    } };
    const extras = chart.extras;
    const recap = { weekStart: '2026-09-14', prose: '3 sessions last week.', chart };
    window.ArenasInsights.mountStoredRecap(host, recap);
    const split = host.querySelector('.recap-sport-split');
    const hoursSvg = host.querySelector('.recap-hours-chart svg');
    const oldSvg = host.querySelector('.recap-chart svg');
    const card = host.querySelector('.recap-answer-card');
    const cardRect = card.getBoundingClientRect();
    const hoursRect = hoursSvg.getBoundingClientRect();
    const oldRect = oldSvg.getBoundingClientRect();
    const saved = {
      completedWeeks: extras.hoursBySport.labels.length === 11 &&
        extras.hoursBySport.labels.at(-1) === recap.weekStart &&
        extras.hoursBySport.relative.at(-1) === 'last_week' &&
        !extras.hoursBySport.relative.includes('this_week'),
      splitText: split.textContent, unsafe: !!split.querySelector('unsafe'),
      swatches: [...split.querySelectorAll('.recap-sport-swatch')].map((node) => node.style.backgroundColor),
      hoursTitle: host.querySelector('.recap-hours-chart .ai-chart-title').textContent,
      legends: host.querySelectorAll('.recap-hours-chart .ai-chart-legend-item').length,
      bars: hoursSvg.querySelectorAll('.ai-chart-segment').length,
      zeroBars: [...hoursSvg.querySelectorAll('.ai-chart-segment')].slice(2, 4)
        .every((node) => Number(node.getAttribute('height')) === 0),
      fits: [hoursRect, oldRect].every((rect) => rect.left >= cardRect.left - 1 &&
        rect.right <= cardRect.right + 1) && hoursRect.bottom <= oldRect.top &&
        document.documentElement.scrollWidth <= innerWidth + 1
    };
    delete chart.extras;
    window.ArenasInsights.mountStoredRecap(host, recap);
    saved.legacy = host.querySelectorAll('.recap-sport-split, .recap-hours-chart').length === 0 &&
      host.querySelectorAll('.recap-chart svg').length === 1;
    // The runner stores { extras } when validation returns no feelings chart.
    // It must draw the hours chart without an empty/base feelings SVG.
    window.ArenasInsights.mountStoredRecap(host, { ...recap, chart: { extras } });
    const onlyHours = host.querySelector('.recap-hours-chart svg');
    const onlyCard = host.querySelector('.recap-answer-card').getBoundingClientRect();
    const onlyRect = onlyHours && onlyHours.getBoundingClientRect();
    saved.extrasOnly = host.querySelectorAll('.recap-chart, .recap-chart svg').length === 0 &&
      host.querySelectorAll('.recap-hours-chart svg').length === 1 &&
      host.querySelectorAll('.recap-sport-split li').length === 2 &&
      onlyHours.getAttribute('aria-label').includes('Hours per week — 11 weeks to Sep 20') &&
      onlyRect.left >= onlyCard.left - 1 && onlyRect.right <= onlyCard.right + 1 &&
      document.documentElement.scrollWidth <= innerWidth + 1;
    return saved;
  }, recapHours);
  check(`storedRecap@${width.viewport}: split is escaped, ordered, and omits zero km`,
    result.splitText.includes('Running <unsafe> — 2 sessions, 1.2 h, 8 km') &&
    result.splitText.includes('Cycling & gravel — 1 session, 0.7 h') &&
    !result.splitText.includes('0 km') && !result.unsafe, result);
  check(`storedRecap@${width.viewport}: stacked SVG precedes and fits feelings chart`,
    result.hoursTitle === 'Hours per week — 11 weeks to Sep 20' &&
    result.completedWeeks && result.legends === 2 && result.bars === 22 && result.zeroBars && result.fits, result);
  check(`storedRecap@${width.viewport}: legacy row does not gain extras`, result.legacy, result);
  check(`storedRecap@${width.viewport}: extras-only row renders hours without feelings`, result.extrasOnly, result);
}

let browser;
try {
  const css = currentCss();
  const moduleSource = currentModule();
  browser = await launchBrowser();
  const page = await browser.newPage();
  for (const width of WIDTHS) {
    for (const [name, fixture] of Object.entries(fixtures)) {
      const result = await renderFixture(page, fixture, width, css, moduleSource);
      assertFixture(name, fixture, result, width);
      // Keep screenshots in /tmp, including the max-11 feelings harness.
      if (fixture.screenshot !== false) {
        await page.screenshot({ path: `/tmp/verify-insights-chart-${name}-${width.viewport}.png` });
      }
    }
    await assertStoredRecap(page, width, css, moduleSource);
  }
  await page.close();
} catch (error) {
  check('chart renderer harness completed', false, error && error.stack ? error.stack : String(error));
} finally {
  if (browser) await browser.close().catch(() => {});
}

console.log(failures ? `\n${failures} FAILURE(S) of ${assertions} chart assertions` :
  `\nALL ${assertions} INSIGHTS CHART ASSERTIONS PASSED`);
process.exitCode = failures ? 1 : 0;