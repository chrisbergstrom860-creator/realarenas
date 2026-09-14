(function (window) {
  'use strict';

  var mounts = [];
  var nextMountId = 1;
  // This module is evaluated once per document. Signed history, rendered turns,
  // and quota therefore follow the page-load lifetime while each mount owns its
  // own DOM, busy state, and resize observers.
  var conversation = { history: [], usage: null, turns: [] };

  function escapeAiHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function renderInsightsChart(chart, measuredWidth) {
    chart = chart || {};
    var labels = Array.isArray(chart.labels) ? chart.labels : [];
    var series = Array.isArray(chart.series) ? chart.series : [];
    var period = chart.period === 'daily' || chart.period === 'monthly' ? chart.period : 'weekly';
    var unit = chart.unit == null ? '' : String(chart.unit);
    // The caller measures its own inserted chart host. There is intentionally no
    // page-layout or document-wide fallback here: this component may mount in
    // containers of any width.
    var width = Number(measuredWidth);
    if (!(width > 0)) return '';
    width = Math.max(120, Math.round(width));
    var isMobileViewport = typeof window !== 'undefined' && window.innerWidth <= 768;
    var isMobile = isMobileViewport || (typeof window === 'undefined' && width < 600);
    var height = isMobile ? 160 : 180;
    var margin = { top: 28, right: 5, bottom: 34, left: 38 };
    var plotWidth = Math.max(1, width - margin.left - margin.right);
    var plotHeight = Math.max(1, height - margin.top - margin.bottom);
    var bottom = margin.top + plotHeight;
    var count = labels.length;
    series.forEach(function (item) {
      if (item && Array.isArray(item.values) && item.values.length > count) count = item.values.length;
    });
    if (!count) count = 1;

    function finiteValue(value) {
      var number = Number(value);
      return isFinite(number) && number >= 0 ? number : 0;
    }
    function formatNumber(value) {
      var number = finiteValue(value);
      if (Math.abs(number - Math.round(number)) < 0.000001) return String(Math.round(number));
      return number.toFixed(1).replace(/\.0$/, '');
    }
    function unitSuffix() { return unit ? ' ' + unit : ''; }
    function dateFor(value) {
      if (value == null) return null;
      var text = String(value);
      if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(text)) return null;
      var date = new Date(text.length === 7 ? text + '-01T00:00:00Z' : text + 'T00:00:00Z');
      return isNaN(date.getTime()) ? null : date;
    }
    function monthName(date) { return date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }); }
    function labelFor(index) { return labels[index] == null ? '' : String(labels[index]); }
    function xFor(index) { return margin.left + (index * plotWidth / count); }
    function xCenter(index) { return xFor(index) + (plotWidth / count) / 2; }
    function safeColor(value) {
      var color = String(value == null ? '' : value);
      return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : 'transparent';
    }

    var totals = [];
    var maxValue = 0;
    for (var i = 0; i < count; i += 1) {
      var total = 0;
      series.forEach(function (item) { total += finiteValue(item && Array.isArray(item.values) ? item.values[i] : 0); });
      totals.push(total);
      if (total > maxValue) maxValue = total;
    }
    var countUnit = unit === 'sessions' || unit === 'count';
    var scaleMax = maxValue > 0 ? maxValue : 1;
    var ticks;
    if (countUnit) {
      var integerMax = Math.ceil(maxValue);
      var tickStep = 1;
      if (integerMax > 3) {
        var niceSteps = [1, 2, 5, 10, 20, 50, 100];
        tickStep = niceSteps[niceSteps.length - 1];
        for (var stepIndex = 0; stepIndex < niceSteps.length; stepIndex += 1) {
          if (Math.ceil(integerMax / niceSteps[stepIndex]) <= 3) { tickStep = niceSteps[stepIndex]; break; }
        }
      }
      var topTick = Math.ceil(integerMax / tickStep) * tickStep;
      scaleMax = topTick || 1;
      ticks = [];
      for (var tick = 0; tick <= topTick; tick += tickStep) ticks.push(tick);
    } else {
      ticks = [0, scaleMax / 2, scaleMax];
    }
    var titleText = chart.title == null ? 'Training chart' : String(chart.title);
    var hasUnitInTitle = unit && new RegExp('(^|[^a-z])' + unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i').test(titleText);
    if (unit && !hasUnitInTitle) titleText += ' (' + unit + ')';
    var maxIndex = 0;
    totals.forEach(function (total, index) { if (total > totals[maxIndex]) maxIndex = index; });
    var ariaLabel = titleText + '. Maximum ' + formatNumber(maxValue) + unitSuffix() + ' on ' + labelFor(maxIndex) + '.';

    var svg = '<svg class="ai-chart-svg" role="img" aria-label="' + escapeAiHtml(ariaLabel) +
      '" width="100%" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" focusable="false">';
    ticks.forEach(function (gridValue) {
      var y = bottom - (gridValue / scaleMax) * plotHeight;
      svg += '<line class="ai-chart-grid" x1="' + margin.left + '" y1="' + y + '" x2="' + (width - margin.right) + '" y2="' + y + '"></line>' +
        '<text class="ai-chart-axis-label" x="' + (margin.left - 6) + '" y="' + (y + 3) + '" text-anchor="end">' + escapeAiHtml(formatNumber(gridValue)) + '</text>';
    });
    if (period === 'daily') {
      labels.forEach(function (label, index) {
        var date = dateFor(label);
        if (!date) return;
        if (date.getUTCDay() === 1) svg += '<line class="ai-chart-monday" x1="' + xFor(index) + '" y1="' + margin.top + '" x2="' + xFor(index) + '" y2="' + bottom + '"></line>';
        if (date.getUTCDate() === 1) svg += '<text class="ai-chart-x-label" x="' + xCenter(index) + '" y="' + (height - 12) + '" text-anchor="middle">' + escapeAiHtml(monthName(date)) + '</text>';
      });
    } else {
      var slotEvery = period === 'weekly' && isMobile ? 2 : 1;
      labels.forEach(function (label, index) {
        if (index % slotEvery !== 0) return;
        var date = dateFor(label);
        var text = date ? (period === 'monthly' ? monthName(date) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })) : labelFor(index);
        svg += '<text class="ai-chart-x-label" x="' + xCenter(index) + '" y="' + (height - (period === 'monthly' ? 15 : 12)) + '" text-anchor="middle">' + escapeAiHtml(text) + '</text>';
        var previousDate = index > 0 ? dateFor(labels[index - 1]) : null;
        if (period === 'monthly' && date && (index === 0 || !previousDate || date.getUTCFullYear() !== previousDate.getUTCFullYear())) {
          svg += '<text class="ai-chart-year-label" x="' + xCenter(index) + '" y="' + (height - 3) + '" text-anchor="middle">' + escapeAiHtml(String(date.getUTCFullYear())) + '</text>';
        }
      });
    }
    var slotWidth = plotWidth / count;
    var gap = Math.max(1, Math.min(4, slotWidth * 0.24));
    var barWidth = Math.max(0.25, slotWidth - gap);
    var metricKey = chart.metric == null ? '' : String(chart.metric);
    var sportKeyedSeries = series.length > 0 && series.every(function (item) {
      var key = item && (item.key != null ? item.key : '');
      return key !== '' && String(key) !== metricKey;
    });
    var stacked = series.length > 1 || chart.metric === 'feelings' || sportKeyedSeries;
    for (var barIndex = 0; barIndex < count; barIndex += 1) {
      var x = xFor(barIndex) + gap / 2;
      var cumulative = 0;
      series.forEach(function (item) {
        var value = finiteValue(item && Array.isArray(item.values) ? item.values[barIndex] : 0);
        var segmentHeight = (value / scaleMax) * plotHeight;
        var y = bottom - cumulative - segmentHeight;
        var seriesLabel = item && (item.label != null ? item.label : item.key) != null ? String(item.label != null ? item.label : item.key) : 'Series';
        var tip = labelFor(barIndex) + ' — ' + seriesLabel + ': ' + formatNumber(value) + unitSuffix();
        svg += '<rect class="ai-chart-bar' + (stacked ? ' ai-chart-segment' : '') + '" x="' + x + '" y="' + y + '" width="' + barWidth + '" height="' + segmentHeight + '" fill="' + escapeAiHtml(safeColor(item && item.color)) + '"><title>' + escapeAiHtml(tip) + '</title></rect>';
        cumulative += segmentHeight;
      });
    }
    svg += '</svg>';
    var legend = '';
    if (stacked) {
      legend = '<div class="ai-chart-legend" role="list">' + series.map(function (item) {
        var seriesLabel = item && (item.label != null ? item.label : item.key) != null ? String(item.label != null ? item.label : item.key) : 'Series';
        return '<div class="ai-chart-legend-item" role="listitem"><span class="ai-chart-swatch" style="background-color:' + escapeAiHtml(safeColor(item && item.color)) + '"></span><span>' + escapeAiHtml(seriesLabel) + '</span></div>';
      }).join('') + '</div>';
    }
    var caption = chart.caption ? '<div class="ai-chart-caption">' + escapeAiHtml(chart.caption) + '</div>' : '';
    return '<div class="ai-chart-shell"><div class="ai-chart-title">' + escapeAiHtml(titleText) + '</div>' + svg + legend + caption + '</div>';
  }

  function usageText() {
    if (!conversation.usage) return '';
    return conversation.usage.used + ' of ' + conversation.usage.limit + ' questions used · resets ' +
      new Date(conversation.usage.resetDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function updateUsage(usage) {
    if (usage) conversation.usage = usage;
    mounts.forEach(function (instance) {
      if (!instance.active || !instance.ready) return;
      if (instance.refs.usage) instance.refs.usage.textContent = usageText();
      if (instance.refs.remaining && conversation.usage) instance.refs.remaining.textContent = conversation.usage.remaining + ' questions remaining';
    });
  }

  function lockedPanel() {
    return '<div style="text-align:center;padding:52px 24px;max-width:500px;margin:0 auto"><div style="font-size:38px;margin-bottom:12px">✦</div><div style="font-size:17px;font-weight:700;color:var(--gray-900);margin-bottom:8px">AI Insights is a Pro feature</div><div style="font-size:13px;color:var(--gray-500);line-height:1.65;margin-bottom:18px">Ask questions grounded in your logged activities, personal records, streaks, and your own standings. Answers are descriptive only and your questions are not saved.</div><button type="button" class="ai2-upgrade" style="padding:9px 20px;border-radius:8px;font-size:13px;font-weight:600;border:1px solid var(--yellow-dark);background:var(--yellow);color:var(--gray-900);cursor:pointer">🔒 Upgrade to Pro · $9/month →</button></div>';
  }

  function composerPanel(prefix, stats, usage, suggestions) {
    stats = stats || [];
    suggestions = suggestions || [];
    var remainingText = usage ? (usage.limit - usage.used) + ' questions remaining' : '30 questions a month';
    var icons = {
      hours: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
      rest: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
      sport: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path>',
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>',
      plans: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>',
      goal: '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle>'
    };
    var statsHtml = stats.map(function (s) {
      var icon = s.icon === 'hours' ? icons.hours : s.icon === 'activities' ? '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>' : s.icon === 'streak' ? '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>' : '<circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>';
      return '<div class="ai2-stat-row"><div class="ai2-stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + icon + '</svg></div><div class="ai2-stat-content"><div class="ai2-stat-value">' + escapeAiHtml(s.value) + '</div><div class="ai2-stat-label">' + escapeAiHtml(s.label) + (s.detail ? ' · ' + escapeAiHtml(s.detail) : '') + '</div></div></div>';
    }).join('');
    var suggestionsHtml = suggestions.map(function (suggestion) {
      var icon = icons[suggestion.icon] || icons.hours;
      return '<button type="button" class="ai2-chip" data-ai-question="' + escapeAiHtml(suggestion.question) + '"><div class="ai2-chip-header"><div class="ai2-chip-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + icon + '</svg></div>' + escapeAiHtml(suggestion.category) + '</div><div class="ai2-chip-text">"' + escapeAiHtml(suggestion.question) + '"</div></button>';
    }).join('');
    return '<div class="ai2-hero-band"><div class="ai2-hero"><div class="ai2-hero-copy"><div class="ai2-sparkle">✦</div><h2 class="ai2-hero-title">Your data, <span class="ai2-yellow">deeper insights.</span></h2><p class="ai2-hero-body">Ask questions about your logged training and get answers built from your own records — hours, sessions, distance, sports, how you felt (feeling), rest days, personal records, schedule, and goals. Every number is checked against your data before you see it.</p></div>' + (stats.length > 0 ? '<div class="ai2-stats-card">' + statsHtml + '</div>' : '') + '</div></div><div class="ai2-callout"><div class="ai2-callout-icon">ⓘ</div><div class="ai2-callout-text"><strong>Descriptive, not coaching.</strong> AI Insights can describe your recorded training, but it won\'t prescribe workouts or comment on diet, weight, body composition, or whether you are under-training.</div></div><div class="ai2-sugg-wrap"><h3 class="ai2-sugg-title">Try asking something like…</h3><div class="ai2-sugg-grid">' + suggestionsHtml + '</div></div><div class="ai2-composer-wrap"><form class="ai2-composer" data-ai-role="form"><label for="' + prefix + '-question" class="ai2-composer-label">Ask about your training data</label><textarea id="' + prefix + '-question" class="ai2-textarea" data-ai-role="question" maxlength="500" rows="3" placeholder="Ask a question or follow up on the conversation…"></textarea><div class="ai2-composer-footer"><div data-ai-role="error" style="font-size:11px;color:#A32D2D"></div><button type="submit" data-ai-role="submit" class="ai2-submit-btn"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg> Ask AI Insights</button></div></form><div class="ai2-composer-note">The last three exchanges stay in this browser tab for follow-ups and disappear when you leave or refresh.</div><div data-ai-role="thread" aria-live="polite" style="display:flex;flex-direction:column;gap:12px;margin-top:16px"></div></div><div class="ai2-trust-row"><div class="ai2-trust-item"><div class="ai2-trust-header"><div class="ai2-chip-icon" style="background:var(--yellow);color:var(--gray-900)">🔒</div> Your data only</div><div class="ai2-trust-desc">Answers use only your own activity — never other athletes\'.</div></div><div class="ai2-trust-item"><div class="ai2-trust-header"><div class="ai2-chip-icon" style="background:var(--yellow);color:var(--gray-900)">🛡</div> Verified answers</div><div class="ai2-trust-desc">Every metric is checked against your recorded activity before you see it.</div></div><div class="ai2-trust-item"><div class="ai2-trust-header"><div class="ai2-chip-icon" style="background:var(--yellow);color:var(--gray-900)">💬</div> 30 questions a month</div><div class="ai2-trust-desc"><span data-ai-role="remaining">' + escapeAiHtml(remainingText) + '</span> · Included with Individual Pro.</div></div></div>';
  }

  function removeEmpty(instance) {
    var empty = instance.container.querySelector('[data-ai-role="empty"]');
    if (empty) empty.remove();
  }
  function renderTurn(instance, question, response) {
    if (!instance.active || !instance.refs.thread) return;
    removeEmpty(instance);
    var limitations = (response.limitations || []).map(function (line) { return '<li>' + escapeAiHtml(line) + '</li>'; }).join('');
    var evidence = (response.evidence || []).map(function (item) { return '<span style="display:inline-block;padding:3px 7px;border-radius:999px;background:var(--gray-100);font-size:9px;color:var(--gray-500);margin:3px 3px 0 0">' + escapeAiHtml(item.path) + '</span>'; }).join('');
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div style="display:flex;justify-content:flex-end"><div style="max-width:82%;background:var(--gray-900);color:white;border-radius:12px 12px 3px 12px;padding:9px 12px;font-size:12px;line-height:1.55">' + escapeAiHtml(question) + '</div></div><div style="background:white;border:var(--border);border-radius:3px 12px 12px 12px;padding:13px 14px"><div style="font-size:10px;font-weight:700;letter-spacing:.05em;color:#9A7600;text-transform:uppercase;margin-bottom:6px">✦ AI Insights</div><div style="font-size:13px;color:var(--gray-800);line-height:1.65;white-space:pre-wrap">' + escapeAiHtml(response.answer) + '</div>' + (response.chart ? '<div class="ai-chart" data-ai-chart-pending="1"></div>' : '') + (limitations ? '<ul style="margin:10px 0 0;padding-left:18px;font-size:12px;color:var(--gray-500);line-height:1.5">' + limitations + '</ul>' : '') + (evidence ? '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--gray-200);font-size:10px;color:var(--gray-400)">Verified data:<br>' + evidence + '</div>' : '') + '</div>';
    var chartHost = wrap.querySelector('.ai-chart');
    while (wrap.firstChild) instance.refs.thread.appendChild(wrap.firstChild);
    if (!chartHost || !response.chart) return;
    var lastWidth = 0, lastHeight = 0;
    var redraw = function () {
      if (!instance.active) return;
      var measured = chartHost.getBoundingClientRect ? chartHost.getBoundingClientRect().width : chartHost.clientWidth;
      if (!(measured > 0)) measured = instance.container.getBoundingClientRect().width;
      // A hidden mount has no usable geometry yet. Its observer (or resize
      // fallback) will redraw once layout supplies a container-local width.
      if (!(measured > 0)) return;
      var roundedWidth = measured > 0 ? Math.round(measured) : 0;
      var expectedHeight = window.innerWidth <= 768 ? 160 : 180;
      if (roundedWidth === lastWidth && expectedHeight === lastHeight && chartHost.innerHTML) return;
      chartHost.innerHTML = renderInsightsChart(response.chart, roundedWidth);
      chartHost.removeAttribute('data-ai-chart-pending');
      lastWidth = roundedWidth;
      lastHeight = expectedHeight;
    };
    redraw();
    if (typeof ResizeObserver === 'function') {
      var observer = new ResizeObserver(redraw);
      observer.observe(chartHost);
      instance.cleanups.push(function () { observer.disconnect(); });
    } else {
      window.addEventListener('resize', redraw);
      instance.cleanups.push(function () { window.removeEventListener('resize', redraw); });
    }
  }
  function renderSharedTurns(instance) {
    conversation.turns.forEach(function (turn) { renderTurn(instance, turn.question, turn.response); });
  }

  function listen(instance, node, event, handler) {
    node.addEventListener(event, handler);
    instance.cleanups.push(function () { node.removeEventListener(event, handler); });
  }
  function restoreTrustIcons(instance) {
    var icons = [
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path><path d="M12 14v2"></path></svg>',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 19 6v5c0 4.6-2.8 7.8-7 10-4.2-2.2-7-5.4-7-10V6l7-3Z"></path><path d="m9 12 2 2 4-4"></path></svg>',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 18.5 3.5 21v-5A8 8 0 1 1 7 18.5H5Z"></path><path d="M8 10h8M8 14h5"></path></svg>'
    ];
    instance.refs.body.querySelectorAll('.ai2-trust-header .ai2-chip-icon').forEach(function (icon, index) {
      icon.innerHTML = icons[index] || '';
    });
  }
  function plainTextTurn(instance, question, response) {
    var thread = instance.refs.thread;
    if (!thread) throw new Error('AI Insights thread is unavailable');
    removeEmpty(instance);
    var questionRow = document.createElement('div');
    questionRow.style.cssText = 'display:flex;justify-content:flex-end';
    var questionBubble = document.createElement('div');
    questionBubble.style.cssText = 'max-width:82%;background:var(--gray-900);color:white;border-radius:12px 12px 3px 12px;padding:9px 12px;font-size:12px;line-height:1.55';
    questionBubble.textContent = question;
    questionRow.appendChild(questionBubble);
    var answerCard = document.createElement('div');
    answerCard.style.cssText = 'background:white;border:var(--border);border-radius:3px 12px 12px 12px;padding:13px 14px';
    var label = document.createElement('div');
    label.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:.05em;color:#9A7600;text-transform:uppercase;margin-bottom:6px';
    label.textContent = '✦ AI Insights';
    var answer = document.createElement('div');
    answer.style.cssText = 'font-size:13px;color:var(--gray-800);line-height:1.65;white-space:pre-wrap';
    answer.textContent = response.answer == null ? '' : String(response.answer);
    answerCard.appendChild(label);
    answerCard.appendChild(answer);
    thread.appendChild(questionRow);
    thread.appendChild(answerCard);
  }

  function submitQuestion(instance) {
    if (!instance.active || instance.busy) return;
    var input = instance.refs.input, button = instance.refs.button, error = instance.refs.error;
    var question = input ? input.value.trim() : '';
    if (!question) { if (error) error.textContent = 'Enter a question first.'; return; }
    instance.busy = true;
    if (error) error.textContent = '';
    if (button) { button.disabled = true; button.textContent = 'Reviewing your data…'; }
    fetch(instance.base + '/api/profile/ai-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question, history: conversation.history })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (result) {
        if (!response.ok) {
          var message = result.error === 'ai_insights_limit' ? (result.message || 'Monthly question limit reached.') : (result.message || 'AI Insights could not complete this request. Please try again.');
          var failure = new Error(message);
          failure.proRequired = result.error === 'pro_required';
          throw failure;
        }
        return result;
      });
    }).then(function (result) {
      if (!instance.active) return;
      conversation.turns.push({ question: question, response: result });
      mounts.forEach(function (mounted) {
        if (!mounted.active || !mounted.ready) return;
        try { renderTurn(mounted, question, result); } catch (renderError) { plainTextTurn(mounted, question, result); }
      });
      if (result.historyTurn) conversation.history = conversation.history.concat([result.historyTurn]).slice(-3);
      if (result.usage) updateUsage(result.usage);
      if (input) input.value = '';
    }).catch(function (requestError) {
      if (!instance.active) return;
      if (requestError.proRequired) {
        instance.refs.body.innerHTML = lockedPanel();
        bindUpgrade(instance);
      } else if (error) {
        error.textContent = requestError.message || 'AI Insights could not complete this request. Please try again.';
      }
    }).then(function () {
      if (!instance.active) return;
      instance.busy = false;
      if (button) { button.disabled = false; button.textContent = 'Ask AI Insights'; }
    });
  }

  function bindUpgrade(instance) {
    var button = instance.refs.body.querySelector('.ai2-upgrade');
    if (!button) return;
    listen(instance, button, 'click', function () {
      if (typeof instance.onUpgrade === 'function') instance.onUpgrade();
      else window.location.href = instance.base + '/billing';
    });
  }
  function load(instance) {
    if (!instance.active || instance.loaded) return;
    instance.loaded = true;
    if (!instance.proEntitled) {
      instance.refs.body.innerHTML = lockedPanel();
      bindUpgrade(instance);
      return;
    }
    Promise.all([
      fetch(instance.base + '/api/profile/ai-insights/status'),
      fetch(instance.base + '/api/profile/ai-insights/hero-stats').catch(function () { return { ok: false }; })
    ]).then(function (responses) {
      return responses[0].json().catch(function () { return {}; }).then(function (status) {
        return (responses[0].ok ? Promise.resolve(status) : Promise.reject(new Error(status.message || 'AI Insights could not load its status.'))).then(function () {
          return responses[1] && responses[1].ok ? responses[1].json().catch(function () { return { stats: [] }; }) : { stats: [] };
        }).then(function (stats) { return { status: status, stats: stats }; });
      });
    }).then(function (data) {
      if (!instance.active) return;
      instance.refs.body.innerHTML = composerPanel(instance.prefix, data.stats.stats, data.status, data.stats.suggestions);
      restoreTrustIcons(instance);
      instance.refs.form = instance.container.querySelector('[data-ai-role="form"]');
      instance.refs.input = instance.container.querySelector('[data-ai-role="question"]');
      instance.refs.button = instance.container.querySelector('[data-ai-role="submit"]');
      instance.refs.error = instance.container.querySelector('[data-ai-role="error"]');
      instance.refs.thread = instance.container.querySelector('[data-ai-role="thread"]');
      instance.refs.remaining = instance.container.querySelector('[data-ai-role="remaining"]');
      instance.ready = true;
      updateUsage(conversation.usage || data.status);
      renderSharedTurns(instance);
      listen(instance, instance.refs.form, 'submit', function (event) { event.preventDefault(); submitQuestion(instance); });
      instance.container.querySelectorAll('[data-ai-question]').forEach(function (chip) {
        listen(instance, chip, 'click', function () {
          if (!instance.refs.input) return;
          instance.refs.input.value = chip.getAttribute('data-ai-question') || '';
          submitQuestion(instance);
        });
      });
    }).catch(function (error) {
      if (instance.active) instance.refs.body.innerHTML = '<div style="padding:48px 24px;text-align:center;font-size:13px;color:var(--gray-500)">' + escapeAiHtml(error.message || 'AI Insights could not load its status.') + '</div>';
    });
  }

  function mount(container, options) {
    if (!container || !container.querySelector) throw new Error('ArenasInsights.mount requires a container element');
    unmount(container);
    options = options || {};
    var prefix = 'ai-insights-' + nextMountId++;
    var instance = {
      container: container, prefix: prefix, base: typeof options.base === 'string' ? options.base.replace(/\/$/, '') : '',
      proEntitled: !!options.proEntitled, onUpgrade: options.onUpgrade, active: true, loaded: false, ready: false, busy: false,
      cleanups: [], refs: {}
    };
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:var(--border);background:white;flex-wrap:wrap"><div><div style="font-size:13px;font-weight:600">AI Insights</div><div style="font-size:11px;color:var(--gray-500);margin-top:1px">Ask descriptive questions about the training data you’ve logged</div></div><div data-ai-role="usage" style="font-size:11px;color:var(--gray-500)"></div></div><div data-ai-role="body"><div style="padding:40px;text-align:center;font-size:13px;color:var(--gray-400)">Loading AI Insights…</div></div>';
    instance.refs.usage = container.querySelector('[data-ai-role="usage"]');
    instance.refs.body = container.querySelector('[data-ai-role="body"]');
    mounts.push(instance);
    load(instance);
    return instance;
  }
  function unmount(container) {
    mounts.slice().forEach(function (instance) {
      if (instance.container !== container) return;
      instance.active = false;
      instance.cleanups.splice(0).forEach(function (cleanup) { cleanup(); });
      var index = mounts.indexOf(instance);
      if (index !== -1) mounts.splice(index, 1);
    });
  }

  window.ArenasInsights = { mount: mount, unmount: unmount };
})(window);