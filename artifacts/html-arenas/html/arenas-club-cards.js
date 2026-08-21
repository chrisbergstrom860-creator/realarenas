// ── Shared club directory cards ─────────────────────────────────────────────
// Card renderer + join-request controller for the /clubs directory page.
// Mirrors the arenas-athlete-cards.js architecture (adc-) — the card template,
// empty states and request wiring live HERE so any future surface that lists
// discoverable clubs reuses the same component. CSS lives in arenas.css under
// the ccd- prefix.
//
// Data contract: club objects come from buildClubDirectory() in server.js
// (id, name, handle, sport, city, logo_url, headline, description, createdAt,
// memberCount, plan, viewerState, viewerRole, cooldownUntil) — served to the
// page via ARENAS_DATA.clubsDirectory and to scripts via
// GET /api/clubs/directory. viewerState is SERVER-DECIDED
// ('none'|'pending'|'cooldown'|'member'); the client renders it and applies
// optimistic transitions only after a confirmed API response.
//
// Usage:
//   var inst = window.ArenasClubCards.mount({
//     clubs: [...],              // directory array (mutated in place on request/cancel)
//     gridEl: el,
//     countEl: el | null,
//     base: window.BASE || '',
//     getFilters: function () { return { sport: ''|sportId, query: '', sort: 'name'|'new' }; },
//     gridClass: function () { return 'ccd-grid ccd-grid-2'; },
//     emptyStates: { none: {t,s,cta}, noMatch: {t,s} },
//     onCardClick: function (club) {} | null,
//     toast: function (msg) {} | undefined
//   });
//   inst.render();
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function sportName(id) {
    return window.arenasSportName(id);
  }

  function searchText(c) {
    return [c.name, c.handle, c.city, sportName(c.sport), c.headline, c.description]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) { return ''; }
  }

  // Server-decided viewerState → button markup. Never re-derived client-side.
  function buttonHTML(c) {
    if (c.viewerState === 'member') {
      return '<button class="ccd-btn ccd-btn-member" data-act="open" data-id="' + esc(c.id) + '">✓ Member</button>';
    }
    if (c.viewerState === 'pending') {
      return '<button class="ccd-btn ccd-btn-pending" data-act="cancel" data-id="' + esc(c.id) + '"><span class="ccd-label-wide">Requested — cancel?</span><span class="ccd-label-mobile">Cancel request</span></button>';
    }
    if (c.viewerState === 'cooldown') {
      return '<button class="ccd-btn ccd-btn-cooldown" disabled>Declined — retry ' + esc(fmtDate(c.cooldownUntil)) + '</button>';
    }
    return '<button class="ccd-btn ccd-btn-request" data-act="request" data-id="' + esc(c.id) + '"><span class="ccd-label-wide">Request to join</span><span class="ccd-label-mobile">Request</span></button>';
  }

  function tileHTML(c) {
    if (window.clubTileHtml) return window.clubTileHtml(c.logo_url, c.sport, 'ccd-tile');
    var icons = window.ARENAS_SPORT_ICONS || {};
    return '<div class="ccd-tile">' + (icons[c.sport] || '🏟') + '</div>';
  }

  function cardHTML(c, i, clickable) {
    var proBadge = c.plan === 'club_pro' ? '<span class="pro-badge">CLUB PRO</span>' : '';
    var meta = [sportName(c.sport), c.city, c.memberCount + ' member' + (c.memberCount === 1 ? '' : 's')]
      .filter(Boolean).map(esc).join(' · ');
    return '<div class="ccd-card" data-club-id="' + esc(c.id) + '"' + (clickable ? ' data-clickable="1"' : '') + ' style="animation-delay:' + Math.min(i * 25, 250) + 'ms">'
      + tileHTML(c)
      + '<div class="ccd-main">'
      + '<div class="ccd-title-row"><div class="ccd-name">' + esc(c.name) + '</div>' + proBadge + '</div>'
      + (c.headline ? '<div class="ccd-headline" title="' + esc(c.headline) + '">' + esc(c.headline) + '</div>' : '')
      + '<div class="ccd-sub">' + meta + '</div>'
      + '</div>'
      + '<div class="ccd-action">' + buttonHTML(c) + '</div>'
      + '</div>';
  }

  function emptyHTML(t, s, ctaHtml) {
    return '<div class="ccd-empty" style="grid-column:1/-1">'
      + '<div class="ccd-empty-t">' + esc(t) + '</div>'
      + '<div class="ccd-empty-s">' + esc(s) + '</div>'
      + (ctaHtml || '')
      + '</div>';
  }

  function mount(opts) {
    var clubs = opts.clubs || [];
    var grid = opts.gridEl;
    var base = opts.base || window.BASE || '';
    var empt = opts.emptyStates || {};
    if (!grid) return null;

    function toast(msg) {
      var fn = opts.toast || window.showToast;
      if (typeof fn === 'function') fn(msg);
    }
    function filters() {
      return (typeof opts.getFilters === 'function' ? opts.getFilters() : {}) || {};
    }
    function byId(id) {
      var found = null;
      clubs.forEach(function (c) { if (c.id === id) found = c; });
      return found;
    }

    function visibleList() {
      var f = filters();
      var list = clubs.slice();
      // "Any sport" clubs claim every sport, so they appear under every
      // sport filter as well as unfiltered — that's what the value means.
      if (f.sport) list = list.filter(function (c) { return c.sport === f.sport || c.sport === 'any'; });
      if (f.query) list = list.filter(function (c) { return searchText(c).indexOf(f.query) !== -1; });
      var sort = f.sort || 'name';
      list.sort(function (a, b) {
        if (sort === 'new') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        return (a.name || '').localeCompare(b.name || '');
      });
      return list;
    }

    function render() {
      var f = filters();
      var list = visibleList();
      grid.className = (typeof opts.gridClass === 'function' ? opts.gridClass() : 'ccd-grid ccd-grid-2');
      if (opts.countEl) opts.countEl.textContent = list.length + ' club' + (list.length === 1 ? '' : 's');
      if (!clubs.length) {
        var e0 = empt.none || { t: 'No clubs are listed yet', s: 'Clubs choose to be listed — if you run one, you can make it discoverable from your club settings.' };
        grid.innerHTML = emptyHTML(e0.t, e0.s, e0.cta || '');
      } else if (!list.length) {
        var e1 = (f.query)
          ? (empt.noMatch || { t: 'No matches', s: 'No clubs match your search.' })
          : { t: 'No ' + (f.sport ? sportName(f.sport) + ' ' : '') + 'clubs are listed yet', s: 'Try a different sport, or clear the filter.' };
        grid.innerHTML = emptyHTML(e1.t, e1.s);
      } else {
        var clickable = typeof opts.onCardClick === 'function';
        grid.innerHTML = list.map(function (c, i) { return cardHTML(c, i, clickable); }).join('');
      }
    }

    // Request / cancel / open — delegated so re-renders keep working.
    grid.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.ccd-btn[data-act]') : null;
      if (btn) {
        ev.stopPropagation();
        var club = byId(btn.getAttribute('data-id'));
        if (!club) return;
        var act = btn.getAttribute('data-act');
        if (act === 'open') {
          if (typeof window.nav === 'function') {
            window.nav(club.viewerRole === 'admin' || club.viewerRole === 'coach'
              ? '/clubs/dashboard?club=' + club.id : '/clubs/member/' + club.id);
          }
          return;
        }
        if (act === 'request') return doRequest(club, btn);
        if (act === 'cancel') return doCancel(club, btn);
        return;
      }
      var card = ev.target.closest ? ev.target.closest('.ccd-card[data-clickable="1"]') : null;
      if (card && typeof opts.onCardClick === 'function') {
        var c = byId(card.getAttribute('data-club-id'));
        if (c) opts.onCardClick(c);
      }
    });

    function doRequest(club, btn) {
      btn.disabled = true;
      btn.textContent = 'Sending…';
      fetch(base + '/api/clubs/' + club.id + '/join-request', { method: 'POST' })
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
        .then(function (r) {
          if (r.status === 200 && r.body && r.body.success) {
            club.viewerState = 'pending';
            if (window.arenasTrack) window.arenasTrack('Club Join Requested');
            toast('✓ Request sent — the club will review it');
          } else if (r.body && r.body.error === 'already_member') {
            club.viewerState = 'member';
            toast('You are already a member of this club');
          } else if (r.body && r.body.error === 'request_pending') {
            club.viewerState = 'pending';
          } else if (r.body && r.body.error === 'request_cooldown') {
            club.viewerState = 'cooldown';
            club.cooldownUntil = r.body.retryAt || null;
            toast('This club declined your last request — you can try again ' + fmtDate(club.cooldownUntil));
          } else {
            toast('Something went wrong — please try again');
          }
          render();
        })
        .catch(function () { toast('Something went wrong — please try again'); render(); });
    }

    function doCancel(club, btn) {
      if (!window.confirm('Cancel your request to join ' + club.name + '?')) return;
      btn.disabled = true;
      fetch(base + '/api/clubs/' + club.id + '/join-request', { method: 'DELETE' })
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
        .then(function (r) {
          if (r.status === 200 && r.body && r.body.success) {
            club.viewerState = 'none';
            toast('Request cancelled');
          } else {
            // 404 = nothing pending anymore (approved/declined in the
            // meantime) — refresh from the server-truth directory.
            fetch(base + '/api/clubs/directory').then(function (rr) { return rr.json(); }).then(function (d) {
              var fresh = ((d && d.clubs) || []).filter(function (c) { return c.id === club.id; })[0];
              if (fresh) { club.viewerState = fresh.viewerState; club.viewerRole = fresh.viewerRole; club.cooldownUntil = fresh.cooldownUntil; }
              render();
            }).catch(function () { render(); });
            return;
          }
          render();
        })
        .catch(function () { toast('Something went wrong — please try again'); render(); });
    }

    return { render: render };
  }

  window.ArenasClubCards = { mount: mount };
})();
