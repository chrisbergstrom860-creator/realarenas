// Shared full-screen overlay/modal primitive (ONE copy — this project has
// been burned by "identical" inline copies drifting; never re-inline this).
// Provides the generic behavior every modal must have:
//   backdrop click closes · Escape closes (topmost) · body scroll lock with
//   restore · focus moved into the panel ([data-autofocus] or first control)
//   and restored to the trigger on close · aria dialog semantics.
// Consumers: the HPW modal (arenas-hpw-modal.js) and the challenges page's
// create-challenge, manage-invites and challenge-leaderboard overlays.
// Deliberately NO history manipulation — consistent with the notifications
// panel: the back button always navigates and is never swallowed.
(function () {
  var stack = []; // open overlays, last = topmost: { el, id, trigger, onClose }
  var prevOverflow = '';

  function onKey(e) {
    if (e.key === 'Escape' && stack.length) close(stack[stack.length - 1].id);
  }

  function focusFirst(el) {
    var target = el.querySelector('[data-autofocus]') ||
      el.querySelector('button, [href], input, select, textarea');
    if (target && typeof target.focus === 'function') {
      try { target.focus(); } catch (err) {}
    }
  }

  // opts: { id, label, html, align: 'center'|'top', zIndex, trigger, onClose }
  // 'top' = flex-start with the OVERLAY scrolling (long forms); 'center'
  // (default) = centered panel that scrolls internally.
  function open(opts) {
    opts = opts || {};
    if (opts.id) close(opts.id); // replace an existing same-id overlay cleanly
    if (!stack.length) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', onKey);
    }
    var ov = document.createElement('div');
    var entry = {
      el: ov,
      id: opts.id || ('arenas-overlay-' + Math.random().toString(36).slice(2)),
      trigger: opts.trigger || document.activeElement,
      onClose: opts.onClose || null
    };
    ov.id = entry.id;
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:' +
      (opts.zIndex || 600) + ';display:flex;align-items:' +
      (opts.align === 'top' ? 'flex-start' : 'center') +
      ';justify-content:center;padding:20px;backdrop-filter:blur(2px)' +
      (opts.align === 'top' ? ';overflow-y:auto' : '');
    ov.innerHTML = opts.html || '';
    var panel = ov.firstElementChild;
    if (panel) {
      if (!panel.getAttribute('role')) panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      if (opts.label && !panel.getAttribute('aria-label')) {
        panel.setAttribute('aria-label', opts.label);
      }
    }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(entry.id); });
    stack.push(entry);
    document.body.appendChild(ov);
    focusFirst(ov);
    return ov;
  }

  // close(id) closes that overlay; close() closes the topmost. No-op if absent.
  function close(id) {
    var idx = -1;
    if (id === undefined) idx = stack.length - 1;
    else { for (var i = stack.length - 1; i >= 0; i--) { if (stack[i].id === id) { idx = i; break; } } }
    if (idx === -1) return;
    var entry = stack.splice(idx, 1)[0];
    if (entry.el && entry.el.parentNode) entry.el.remove();
    if (!stack.length) {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    }
    if (entry.trigger && typeof entry.trigger.focus === 'function' &&
        document.contains(entry.trigger)) {
      try { entry.trigger.focus(); } catch (err) {}
    }
    if (typeof entry.onClose === 'function') {
      try { entry.onClose(); } catch (err) {}
    }
  }

  window.arenasOverlay = { open: open, close: close };
})();
