// Arenas PWA bootstrap: service-worker registration + the install experience.
//
// Loaded (deferred) on every served page. Registration runs everywhere so the
// deploy-wins worker controls the whole app from any entry point. The install
// card, however, only ever appears for LOGGED-IN users on app-shell pages at
// mobile widths — the landing page's only mention is its own static whisper
// line, and marketing/auth/legal pages never show install UI.
//
// Platform matrix:
//   - Android/Chrome: capture beforeinstallprompt, suppress the default
//     mini-infobar, show our card; Install triggers the real prompt.
//   - iOS Safari: no programmatic prompt exists — same card with the
//     two-step "Share → Add to Home Screen" instruction instead of a button.
//   - In-app browsers (Instagram/Facebook/etc. webviews): cannot install —
//     all install UI suppressed.
//   - Already installed (display-mode: standalone / navigator.standalone,
//     or a previous appinstalled event): never show anything.
//
// Dismissal policy: tapping ✕ stores a timestamp in
// localStorage.arenas_install_dismissed — the card stays gone for 60 days,
// then may be offered again. A successful install stores
// arenas_install_done and retires the card permanently.
(function () {
  'use strict';

  var BASE = window.location.pathname.indexOf('/html') === 0 ? '/html' : '';
  var DISMISS_KEY = 'arenas_install_dismissed';
  var DONE_KEY = 'arenas_install_done';
  var REOFFER_MS = 60 * 24 * 60 * 60 * 1000; // ~60 days

  // ── Service worker: every page, every user ──
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(BASE + '/sw.js').catch(function () {
        /* registration failure = app behaves exactly as before */
      });
    });
  }

  // ── Environment detection ──
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }
  function isIos() {
    var ua = navigator.userAgent || '';
    return /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
  }
  function isInAppBrowser() {
    var ua = navigator.userAgent || '';
    return /instagram|fban|fbav|fb_iab|messenger|line\/|micromessenger|twitter|tiktok|musical_ly|snapchat|; wv\)/i.test(ua);
  }
  function isMobileWidth() {
    return window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  }
  function isLoggedInAppPage() {
    // The server injects the bottom nav on every authenticated app-shell page
    // (and only there) — its presence in the DOM is the logged-in signal.
    return !!document.querySelector('.bottom-nav');
  }
  function dismissedRecently() {
    var t = parseInt(lsGet(DISMISS_KEY) || '0', 10);
    return t > 0 && (Date.now() - t) < REOFFER_MS;
  }
  function eligible() {
    return isLoggedInAppPage() && isMobileWidth() && !isStandalone() &&
      !isInAppBrowser() && !dismissedRecently() && lsGet(DONE_KEY) !== '1';
  }

  // Debug/test hook: lets automation assert WHY the card is or isn't shown.
  window.__arenasPwaState = function () {
    return {
      base: BASE,
      standalone: isStandalone(),
      ios: isIos(),
      inApp: isInAppBrowser(),
      mobileWidth: isMobileWidth(),
      loggedInAppPage: isLoggedInAppPage(),
      dismissedRecently: dismissedRecently(),
      installDone: lsGet(DONE_KEY) === '1',
      eligible: eligible(),
      cardShown: !!document.getElementById('arenas-install-card')
    };
  };

  // ── Install card ──
  var deferredPrompt = null;
  var MARK_SVG =
    '<svg width="26" height="26" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<rect x="118" y="170" width="276" height="172" rx="86" fill="none" stroke="#111827" stroke-width="30"/>' +
    '<rect x="182" y="224" width="148" height="64" rx="32" fill="none" stroke="#111827" stroke-width="20"/>' +
    '<rect x="248" y="152" width="16" height="58" rx="8" fill="#111827"/></svg>';

  function ensureStyles() {
    if (document.getElementById('arenas-install-css')) return;
    var css =
      '#arenas-install-card{position:fixed;left:12px;right:12px;' +
      'bottom:calc(76px + env(safe-area-inset-bottom, 0px));z-index:500;' +
      'background:white;border:1px solid #E5E7EB;border-radius:12px;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.12);padding:12px;display:flex;' +
      'align-items:center;gap:10px;max-width:520px;margin:0 auto;' +
      'font-family:inherit;animation:aic-up .25s ease both}' +
      '@keyframes aic-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}' +
      '#arenas-install-card .aic-mark{width:42px;height:42px;border-radius:10px;' +
      'background:#FFD21E;display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
      '#arenas-install-card .aic-body{flex:1;min-width:0}' +
      '#arenas-install-card .aic-title{font-size:13px;font-weight:700;color:#111827;line-height:1.35}' +
      '#arenas-install-card .aic-sub{font-size:12px;color:#6B7280;line-height:1.45;margin-top:2px}' +
      '#arenas-install-card .aic-sub b{color:#374151}' +
      '#arenas-install-card .aic-install{font:inherit;font-size:13px;font-weight:600;' +
      'background:#FFD21E;color:#111827;border:1px solid #E6B800;border-radius:7px;' +
      'padding:8px 14px;cursor:pointer;flex-shrink:0}' +
      '#arenas-install-card .aic-close{font-size:16px;line-height:1;background:none;' +
      'border:none;color:#9CA3AF;cursor:pointer;padding:6px;flex-shrink:0;align-self:flex-start}' +
      '@media (min-width:769px){#arenas-install-card{display:none}}';
    var el = document.createElement('style');
    el.id = 'arenas-install-css';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function hideCard() {
    var card = document.getElementById('arenas-install-card');
    if (card && card.parentNode) card.parentNode.removeChild(card);
  }

  function showCard(mode) {
    if (!eligible()) return;
    if (document.getElementById('arenas-install-card')) return;
    ensureStyles();

    var card = document.createElement('div');
    card.id = 'arenas-install-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Install Arenas');

    var sub = mode === 'ios'
      ? 'Tap <b>Share</b> \u2192 <b>Add to Home Screen</b>.'
      : 'One tap to log \u2014 no app store needed.';

    card.innerHTML =
      '<div class="aic-mark">' + MARK_SVG + '</div>' +
      '<div class="aic-body">' +
      '<div class="aic-title">Add Arenas to your home screen</div>' +
      '<div class="aic-sub">' + sub + '</div>' +
      '</div>' +
      (mode === 'android' ? '<button class="aic-install" type="button">Install</button>' : '') +
      '<button class="aic-close" type="button" aria-label="Dismiss">\u2715</button>';

    card.querySelector('.aic-close').addEventListener('click', function () {
      lsSet(DISMISS_KEY, String(Date.now()));
      hideCard();
    });

    var installBtn = card.querySelector('.aic-install');
    if (installBtn) {
      installBtn.addEventListener('click', function () {
        if (!deferredPrompt || typeof deferredPrompt.prompt !== 'function') return;
        var p = deferredPrompt;
        deferredPrompt = null;
        p.prompt();
        var choice = p.userChoice && typeof p.userChoice.then === 'function'
          ? p.userChoice : Promise.resolve({ outcome: 'dismissed' });
        choice.then(function (res) {
          if (res && res.outcome === 'accepted') {
            lsSet(DONE_KEY, '1');
          } else {
            // Declining the native prompt counts as a dismissal too.
            lsSet(DISMISS_KEY, String(Date.now()));
          }
          hideCard();
        }).catch(function () { hideCard(); });
      });
    }

    document.body.appendChild(card);
  }

  // Android/Chrome path: only offer when the browser says install is possible.
  // preventDefault is called unconditionally: it suppresses Chrome's own
  // mini-infobar so install UI is OURS alone (logged-out, dismissed-recently
  // and in-app contexts must stay quiet). This is a multi-page app — the
  // event re-fires on every navigation, so suppressing it on an ineligible
  // page never costs a later, eligible page its chance. Desktop Chrome's
  // omnibox install icon is unaffected by preventDefault.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); // suppress Chrome's mini-infobar; we present our card
    deferredPrompt = e;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { showCard('android'); });
    } else {
      showCard('android');
    }
  });

  window.addEventListener('appinstalled', function () {
    lsSet(DONE_KEY, '1');
    hideCard();
  });

  // iOS path: no beforeinstallprompt exists — show the instruction card.
  function iosOffer() {
    if (isIos() && !isStandalone()) showCard('ios');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iosOffer);
  } else {
    iosOffer();
  }
})();
