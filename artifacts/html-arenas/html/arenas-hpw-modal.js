// In-app "How points work" modal (shared across app-shell pages).
// Intercepts in-app links to /how-points-work and opens the SAME
// server-rendered content in an overlay, fetched from
// /how-points-work?fragment=1 — single source of truth is the sports
// registry; this file contains ZERO scoring content.
// Chrome follows the manage-invites overlay pattern (backdrop + ✕), plus:
// Escape closes, body scroll locks, focus moves into the panel and returns
// to the trigger on close. Deliberately NO history manipulation — consistent
// with the notifications panel (which pushes no history either): the back
// button always navigates the page and is never swallowed by the overlay.
(function () {
  var B = window.BASE || (window.location.pathname.indexOf('/html') === 0 ? '/html' : '');
  var prevOverflow = '';
  var triggerEl = null;

  function close() {
    var ov = document.getElementById('hpw-modal-overlay');
    if (!ov) return;
    ov.remove();
    document.body.style.overflow = prevOverflow;
    document.removeEventListener('keydown', onKey);
    if (triggerEl && typeof triggerEl.focus === 'function') {
      try { triggerEl.focus(); } catch (e) {}
    }
    triggerEl = null;
  }
  window.closeHpwModal = close;

  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(trigger) {
    close();
    triggerEl = trigger || null;
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    var ov = document.createElement('div');
    ov.id = 'hpw-modal-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:700;display:flex;align-items:flex-start;justify-content:center;padding:20px;backdrop-filter:blur(2px)';
    ov.innerHTML =
      '<div role="dialog" aria-modal="true" aria-label="How points work" style="background:#fff;border-radius:14px;width:100%;max-width:720px;max-height:calc(100vh - 40px);display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.2);margin:auto 0">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid var(--gray-100,#F3F4F6);flex-shrink:0">' +
          '<div style="font-size:16px;font-weight:700;color:var(--gray-900,#111827)">How points work</div>' +
          '<button id="hpw-modal-close" aria-label="Close" style="width:36px;height:36px;border-radius:50%;border:1px solid var(--gray-200,#E5E7EB);background:#fff;cursor:pointer;font-size:15px;color:var(--gray-500,#6B7280);flex-shrink:0">✕</button>' +
        '</div>' +
        '<div id="hpw-modal-body" style="overflow-y:auto;-webkit-overflow-scrolling:touch;border-radius:0 0 14px 14px">' +
          '<div style="padding:44px 24px;text-align:center;font-size:13px;color:var(--gray-400,#9CA3AF)">Loading…</div>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    document.addEventListener('keydown', onKey);
    var closeBtn = document.getElementById('hpw-modal-close');
    closeBtn.onclick = close;
    closeBtn.focus();

    fetch(B + '/how-points-work?fragment=1')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (htmlText) {
        var body = document.getElementById('hpw-modal-body');
        if (!body) return; // closed while loading
        body.innerHTML = htmlText +
          // Fit the page's prose styles to the modal column.
          '<style>#hpw-modal-body .prose{max-width:none;padding:6px 24px 28px}#hpw-modal-body .content{background:#fff}</style>';
      })
      .catch(function () {
        var body = document.getElementById('hpw-modal-body');
        if (!body) return;
        body.innerHTML =
          '<div style="padding:40px 24px;text-align:center">' +
            '<div style="font-size:14px;color:var(--gray-600,#4B5563);margin-bottom:10px">Couldn\u2019t load the scoring guide.</div>' +
            '<a data-hpw-full="1" href="' + B + '/how-points-work" style="font-size:13px;font-weight:600;color:var(--gray-900,#111827);text-decoration:underline">Open the full page</a>' +
          '</div>';
      });
  }

  // Delegated interception: any in-app link whose href targets
  // /how-points-work opens the modal instead of navigating. Skips modified
  // clicks / new-tab targets and the error-state escape link (data-hpw-full),
  // which must genuinely navigate.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.getAttribute('data-hpw-full')) return;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('how-points-work') === -1) return;
    if (!/^\/(html\/)?how-points-work\/?([?#].*)?$/.test(href)) return;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
    e.preventDefault();
    open(a);
  });
})();
