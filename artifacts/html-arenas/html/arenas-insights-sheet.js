(function (window) {
  'use strict';

  var sheetHome = null;
  var sheetNode = null;
  var sheetBody = null;
  var sheetMounted = false;
  var overlayElement = null;
  var open = false;
  var generation = 0;
  var geometryFrame = 0;
  var focusFrame = 0;
  var readyObserver = null;
  var observedViewport = null;

  function cancelFrame(frame) {
    if (frame) window.cancelAnimationFrame(frame);
    return 0;
  }

  function disconnectReadyObserver() {
    if (readyObserver) readyObserver.disconnect();
    readyObserver = null;
  }

  function getVisualViewport() {
    return window.visualViewport || null;
  }

  function applyGeometry() {
    geometryFrame = 0;
    if (!open || !sheetNode) return;

    var viewport = getVisualViewport();
    var visualHeight = viewport ? viewport.height : window.innerHeight;
    var visualTop = viewport ? viewport.offsetTop : 0;
    var maxHeight = Math.min(window.innerHeight * 0.92, visualHeight);
    var bottom = Math.max(0, window.innerHeight - visualTop - visualHeight);

    // These are runtime viewport measurements; the sheet presentation, including
    // safe-area padding, belongs to the .ai-sheet CSS contract.
    sheetNode.style.position = 'absolute';
    sheetNode.style.left = '0';
    sheetNode.style.right = '0';
    sheetNode.style.bottom = bottom + 'px';
    sheetNode.style.maxHeight = maxHeight + 'px';
    sheetNode.style.boxSizing = 'border-box';
    keepComposerVisible();
  }

  function scheduleGeometry() {
    if (!open || geometryFrame) return;
    geometryFrame = window.requestAnimationFrame(applyGeometry);
  }

  function rectInsideBody(rect, visibleTop, visibleBottom) {
    if (rect.height <= visibleBottom - visibleTop) {
      if (rect.top < visibleTop) return rect.top - visibleTop;
      if (rect.bottom > visibleBottom) return rect.bottom - visibleBottom;
      return 0;
    }
    return null;
  }

  function keepComposerVisible() {
    if (!open || !sheetBody) return;
    var focusedInput = sheetBody.querySelector('[data-ai-role="question"]');
    if (!focusedInput || document.activeElement !== focusedInput) return;

    var form = sheetBody.querySelector('[data-ai-role="form"]');
    if (!form || !form.getBoundingClientRect) return;

    var viewport = getVisualViewport();
    var bodyRect = sheetBody.getBoundingClientRect();
    var viewportTop = viewport ? viewport.offsetTop : 0;
    var viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    var visibleTop = Math.max(bodyRect.top, viewportTop);
    var visibleBottom = Math.min(bodyRect.bottom, viewportBottom);
    if (visibleBottom <= visibleTop) return;

    var formRect = form.getBoundingClientRect();
    var adjustment = rectInsideBody(formRect, visibleTop, visibleBottom);

    // A form taller than the available sheet cannot fit in full. Keep the text
    // field usable instead of scrolling the document or another ancestor.
    if (adjustment === null) {
      var input = sheetBody.querySelector('[data-ai-role="question"]');
      if (!input || !input.getBoundingClientRect) return;
      adjustment = rectInsideBody(input.getBoundingClientRect(), visibleTop, visibleBottom);
    }
    if (adjustment) sheetBody.scrollTop += adjustment;
  }

  function visibleFocusables() {
    if (!sheetNode) return [];
    var candidates = sheetNode.querySelectorAll(
      'a[href], area[href], button, input, select, textarea, [contenteditable="true"], [tabindex]'
    );
    return Array.prototype.filter.call(candidates, function (node) {
      if (node.disabled || node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
      if (node.hasAttribute('tabindex') && Number(node.getAttribute('tabindex')) < 0) return false;
      for (var parent = node; parent && parent !== sheetNode.parentElement; parent = parent.parentElement) {
        if (parent.hidden || parent.getAttribute('aria-hidden') === 'true') return false;
        var style = window.getComputedStyle ? window.getComputedStyle(parent) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
        if (parent === sheetNode) break;
      }
      return !node.getClientRects || node.getClientRects().length > 0;
    });
  }

  function focusNode(node) {
    if (!node || typeof node.focus !== 'function') return;
    try {
      node.focus({ preventScroll: true });
    } catch (err) {
      try { node.focus(); } catch (ignore) {}
    }
  }

  function trapTab(event) {
    if (event.key !== 'Tab' || !open || !sheetNode) return;
    var focusables = visibleFocusables();
    if (!focusables.length) {
      event.preventDefault();
      focusNode(sheetNode);
      return;
    }

    var active = document.activeElement;
    var insideSheet = sheetNode.contains(active);
    if (!insideSheet) {
      event.preventDefault();
      focusNode(event.shiftKey ? focusables[focusables.length - 1] : focusables[0]);
      return;
    }

    if (event.shiftKey && active === focusables[0]) {
      event.preventDefault();
      focusNode(focusables[focusables.length - 1]);
    } else if (!event.shiftKey && active === focusables[focusables.length - 1]) {
      event.preventDefault();
      focusNode(focusables[0]);
    }
  }

  function queueComposerFocus(input, expectedGeneration) {
    focusFrame = cancelFrame(focusFrame);
    focusFrame = window.requestAnimationFrame(function () {
      focusFrame = 0;
      if (!open || expectedGeneration !== generation || !sheetBody || !sheetBody.contains(input)) return;
      focusNode(input);
      keepComposerVisible();
    });
  }

  function focusComposerWhenReady(expectedGeneration) {
    disconnectReadyObserver();
    var input = sheetBody && sheetBody.querySelector('[data-ai-role="question"]');
    if (input) {
      queueComposerFocus(input, expectedGeneration);
      return;
    }
    if (!window.MutationObserver || !sheetBody) return;

    readyObserver = new window.MutationObserver(function () {
      if (!open || expectedGeneration !== generation) {
        disconnectReadyObserver();
        return;
      }
      var composerInput = sheetBody.querySelector('[data-ai-role="question"]');
      if (!composerInput) return;
      disconnectReadyObserver();
      queueComposerFocus(composerInput, expectedGeneration);
    });
    readyObserver.observe(sheetBody, { childList: true, subtree: true });
  }

  function bindViewportListeners() {
    observedViewport = getVisualViewport();
    if (observedViewport) {
      observedViewport.addEventListener('resize', scheduleGeometry);
      observedViewport.addEventListener('scroll', scheduleGeometry);
    }
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', trapTab);
  }

  function unbindViewportListeners() {
    if (observedViewport) {
      observedViewport.removeEventListener('resize', scheduleGeometry);
      observedViewport.removeEventListener('scroll', scheduleGeometry);
    }
    observedViewport = null;
    window.removeEventListener('resize', onWindowResize);
    document.removeEventListener('keydown', trapTab);
  }

  function onWindowResize() {
    if (!open) return;
    if (window.innerWidth > 768) {
      window.arenasOverlay.close('ai-insights-sheet');
      return;
    }
    scheduleGeometry();
  }

  function handleClose() {
    open = false;
    overlayElement = null;
    generation += 1;
    geometryFrame = cancelFrame(geometryFrame);
    focusFrame = cancelFrame(focusFrame);
    disconnectReadyObserver();
    unbindViewportListeners();
  }

  function createSheet() {
    sheetHome = document.createElement('div');
    sheetHome.hidden = true;
    sheetHome.setAttribute('aria-hidden', 'true');

    sheetNode = document.createElement('section');
    sheetNode.className = 'ai-sheet';
    sheetNode.tabIndex = -1;

    var header = document.createElement('header');
    header.className = 'ai-sheet-header';
    var title = document.createElement('div');
    title.className = 'ai-sheet-title';
    title.id = 'ai-sheet-title';
    title.textContent = 'AI Insights';

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'ai-sheet-close';
    close.setAttribute('aria-label', 'Close AI Insights');
    close.textContent = '×';
    close.addEventListener('click', function () {
      if (window.arenasOverlay) window.arenasOverlay.close('ai-insights-sheet');
    });
    header.appendChild(title);
    header.appendChild(close);

    sheetBody = document.createElement('div');
    sheetBody.className = 'ai-sheet-body';
    sheetBody.addEventListener('focusin', function (event) {
      if (event.target.closest && event.target.closest('[data-ai-role="form"]')) keepComposerVisible();
    });

    sheetNode.setAttribute('aria-labelledby', title.id);
    sheetNode.appendChild(header);
    sheetNode.appendChild(sheetBody);
    sheetHome.appendChild(sheetNode);
    document.body.appendChild(sheetHome);
  }

  function mountInsightsOnce() {
    if (sheetMounted || !window.ArenasInsights || typeof window.ArenasInsights.mount !== 'function') return;
    window.ArenasInsights.mount(sheetBody, {
      base: window.BASE || '',
      proEntitled: true
    });
    sheetMounted = true;
  }

  function openSheet(trigger) {
    if (window.innerWidth > 768 || open || !window.arenasOverlay) return;
    if (!sheetNode) createSheet();

    generation += 1;
    var thisGeneration = generation;
    open = true;
    overlayElement = window.arenasOverlay.open({
      id: 'ai-insights-sheet',
      label: 'AI Insights',
      node: sheetNode,
      trigger: trigger,
      onClose: handleClose
    });

    // arenasOverlay owns escape, backdrop closing, scroll locking, and focus
    // restoration. Its default padded/centered flex layout is not appropriate
    // for this bottom sheet.
    overlayElement.classList.add('ai-sheet-backdrop');
    overlayElement.style.padding = '0';
    overlayElement.style.alignItems = 'flex-end';

    // The node has now been adopted into the visible overlay. Do not mount it
    // while it is parked in its hidden home, so layout-aware Insights UI starts
    // with a measurable container.
    mountInsightsOnce();
    bindViewportListeners();
    scheduleGeometry();
    focusComposerWhenReady(thisGeneration);
  }

  function openProfileInsights() {
    var tab = document.getElementById('htab-insights');
    if (!tab) return;
    tab.click();
    window.requestAnimationFrame(function () {
      var panel = document.getElementById('tab-insights');
      if (panel) panel.scrollIntoView({ block: 'start' });
    });
  }

  function init() {
    var fab = document.querySelector('.bn-fab-ai');
    if (!fab) return;
    fab.addEventListener('click', function (event) {
      event.preventDefault();
      if (window.innerWidth > 768) return; // The mobile-only sheet has no desktop fallback.
      if (document.getElementById('htab-insights')) {
        openProfileInsights();
        return;
      }
      openSheet(fab);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);