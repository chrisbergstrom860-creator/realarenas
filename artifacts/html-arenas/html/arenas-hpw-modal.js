// In-app "How points work" modal (shared across app-shell pages).
// Intercepts in-app links to /how-points-work and opens the SAME
// server-rendered content in an overlay, fetched from
// /how-points-work?fragment=1 — single source of truth is the sports
// registry; this file contains ZERO scoring content.
// Overlay behavior (backdrop/Escape/✕ close, scroll lock, focus restore, no
// history manipulation) comes from the shared arenasOverlay primitive
// (arenas-overlay.js — must be loaded before this file).
(function () {
  var B = window.BASE || (window.location.pathname.indexOf('/html') === 0 ? '/html' : '');
  var OVERLAY_ID = 'hpw-modal-overlay';

  function close() {
    if (window.arenasOverlay) window.arenasOverlay.close(OVERLAY_ID);
  }
  window.closeHpwModal = close;

  function open(trigger) {
    window.arenasOverlay.open({
      id: OVERLAY_ID,
      label: 'How points work',
      zIndex: 700,
      trigger: trigger,
      html:
        '<div style="background:#fff;border-radius:14px;width:100%;max-width:720px;max-height:calc(100vh - 40px);display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.2)">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid var(--gray-100,#F3F4F6);flex-shrink:0">' +
            '<div style="font-size:16px;font-weight:700;color:var(--gray-900,#111827)">How points work</div>' +
            '<button id="hpw-modal-close" data-autofocus aria-label="Close" style="width:36px;height:36px;border-radius:50%;border:1px solid var(--gray-200,#E5E7EB);background:#fff;cursor:pointer;font-size:15px;color:var(--gray-500,#6B7280);flex-shrink:0">✕</button>' +
          '</div>' +
          '<div id="hpw-modal-body" style="overflow-y:auto;-webkit-overflow-scrolling:touch;border-radius:0 0 14px 14px">' +
            '<div style="padding:44px 24px;text-align:center;font-size:13px;color:var(--gray-400,#9CA3AF)">Loading…</div>' +
          '</div>' +
        '</div>'
    });
    document.getElementById('hpw-modal-close').onclick = close;

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
  // which must genuinely navigate. If the overlay primitive failed to load,
  // links degrade to normal navigation.
  document.addEventListener('click', function (e) {
    if (!window.arenasOverlay) return;
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
