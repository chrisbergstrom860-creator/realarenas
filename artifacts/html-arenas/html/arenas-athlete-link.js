// arenas-athlete-link.js — ONE shared mechanism for making athlete names and
// avatars navigate to the public profile (/athletes/:id). Surfaces add
// window.athleteLinkAttrs(userId, reachable) to the avatar wrapper and/or the
// name element; a single capture-phase delegated handler does the rest.
//
// Rules baked in here (never re-implement per surface):
// - reachable === false → NO attrs → not a link at all. Opted-out athletes'
//   profiles 404 (zero-leak), so their names must never be links.
// - Clicks that land on an interactive descendant (button/a/input/...) are
//   ignored, so kudos / delete / follow buttons inside a linked region keep
//   working with no per-surface stopPropagation.
// - Capture phase + stopPropagation means the athlete link wins over any
//   card-level inline onclick (e.g. a whole-card nav) without touching it.
// - Clicking your own name goes to /profile (the server also 302s
//   /athletes/<self> there, so this is a fast path, not the only guard).
(function () {
  function attrs(userId, reachable) {
    if (!userId || reachable === false) return '';
    var safe = String(userId).replace(/[^a-zA-Z0-9-]/g, '');
    if (!safe) return '';
    return ' data-athlete-link="' + safe + '" role="link" tabindex="0"';
  }

  function go(id) {
    var me = window.ARENAS_DATA && window.ARENAS_DATA.userId;
    var target = me && id === me ? '/profile' : '/athletes/' + id;
    if (typeof window.nav === 'function') window.nav(target);
    else window.location.href = (window.ARENAS_BASE || '') + target;
  }

  function resolve(ev) {
    var t = ev.target;
    if (!t || !t.closest) return null;
    var el = t.closest('[data-athlete-link]');
    if (!el) return null;
    // A click on a real control inside the linked region belongs to that
    // control, not to navigation.
    var interactive = t.closest('button, a, input, select, textarea, label');
    if (interactive && el.contains(interactive)) return null;
    return el;
  }

  document.addEventListener(
    'click',
    function (ev) {
      var el = resolve(ev);
      if (!el) return;
      ev.preventDefault();
      ev.stopPropagation();
      go(el.getAttribute('data-athlete-link'));
    },
    true
  );

  document.addEventListener(
    'keydown',
    function (ev) {
      if (ev.key !== 'Enter') return;
      var el = ev.target && ev.target.closest && ev.target.closest('[data-athlete-link]');
      if (!el || el !== ev.target) return;
      ev.preventDefault();
      ev.stopPropagation();
      go(el.getAttribute('data-athlete-link'));
    },
    true
  );

  window.athleteLinkAttrs = attrs;
})();
