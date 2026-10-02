// ── Shared athlete directory cards ──────────────────────────────────────────
// One card renderer + follow controller for every surface that lists athletes
// with Follow buttons (today: the /athletes page and the my-profile
// "Athletes" tab). The card template, empty states, follow wiring and
// follower-counter sync live HERE so the two renderings of the same person
// can never drift. Component CSS lives in arenas.css under the adc- prefix.
//
// Data contract: the athlete objects come from buildAthleteDirectory() in
// server.js (id, name, avatar_url, bio, location, countryName, stateName,
// state, sports[], sportsRegistry[], sportsCount, banner_url, banner_card_url,
// initials, createdAt, postCount, followerCount, isFollowing) — served to the page via ARENAS_DATA.athletes and to the tab
// via GET /api/athletes/directory.
//
// Usage:
//   var inst = window.ArenasAthleteCards.mount({
//     athletes: [...],           // the directory array (mutated in place on follow)
//     gridEl: el,                // container that receives the cards
//     countEl: el | null,        // optional "N athletes" text target
//     base: window.BASE || '',
//     source: 'athletes-page',   // tag for cross-surface follow events
//     getFilters: function () { return { show: 'all'|'following', query: '', sort: 'followers'|'name'|'new', sport: 'all'|registryId, view: 'grid'|'list' }; },
//     total: number | undefined, // eligible athletes before the server display cap
//     gridClass: function () { return 'adc-grid adc-grid-2'; },
//     emptyStates: { none: {t,s}, noFollowing: {t,s}, noMatch: {t,s} },
//     onCardClick: function (athlete) {} | null,   // null → cards not clickable
//     onFollowChange: function (athlete, isFollowing, followerCount) {} | null,
//     onRender: function (visibleCount) {} | null,
//     toast: function (msg) {} | undefined         // falls back to window.showToast
//   });
//   inst.render(); inst.syncFollowUI(id, isFollowing);
//
// Cross-surface sync: every confirmed follow/unfollow dispatches a document
// CustomEvent 'arenas:follow-change' {id, following, athlete, source}; mounted
// instances apply changes coming from OTHER sources automatically, and page
// code (e.g. the my-profile Following tab) can dispatch/listen to the same
// event to stay consistent without coupling to this module.
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Same deterministic palette the /athletes page has always used: index in
  // the directory array picks the avatar fallback colors, so the same person
  // gets the same colors on every surface fed by the same directory.
  var AV_COLORS = [
    { bg: '#FEF9C3', color: '#854D0E' }, { bg: '#FCE7F3', color: '#9D174D' },
    { bg: '#E0F2FE', color: '#0369A1' }, { bg: '#F5F3FF', color: '#5B21B6' },
    { bg: '#ECFDF5', color: '#065F46' }, { bg: '#FFF7ED', color: '#9A3412' },
    { bg: '#F0FDFA', color: '#134E4A' }, { bg: '#FBEAF0', color: '#72243E' }
  ];
  function avColor(i) { return AV_COLORS[((i % AV_COLORS.length) + AV_COLORS.length) % AV_COLORS.length]; }

  // Plain sport label ("Running") for secondary lines — no emoji, unlike the
  // pill tags from arenasSportTag().
  function sportName(id) {
    var s = (window.ARENAS_SPORTS_BY_ID || {})[id];
    if (s) return s.label;
    var t = String(id == null ? '' : id);
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }

  function sportById(id) {
    var map = window.ARENAS_SPORTS_BY_ID;
    if (map) return map[id] || null;
    var found = null;
    (window.ARENAS_SPORTS || []).forEach(function (s) { if (s.id === id) found = s; });
    return found;
  }

  function sportColorStyle(id) {
    var found = sportById(id);
    return found ? 'background:' + found.colors.bg + ';color:' + found.colors.text + ';border-color:' + found.colors.border : '';
  }

  // Registry sports only (deduped, declared order). Server sends
  // sportsRegistry; fall back to filtering the raw field so older payloads
  // never show legacy/unknown values as chips or count them.
  function registrySports(a) {
    if (Array.isArray(a.sportsRegistry)) return a.sportsRegistry.slice();
    var seen = {};
    return (a.sports || []).filter(function (id) {
      if (!sportById(id) || seen[id]) return false;
      seen[id] = true; return true;
    });
  }
  function sportsCount(a) {
    return a.sportsCount == null ? registrySports(a).length : a.sportsCount;
  }

  // Filter chips: registry sports declared by at least one listed athlete,
  // in registry order.
  function availableSports(list) {
    var declared = {};
    (list || []).forEach(function (a) { registrySports(a).forEach(function (id) { declared[id] = true; }); });
    return (window.ARENAS_SPORTS || []).filter(function (s) { return declared[s.id]; });
  }

  // Banner fallback: gradient from the athlete's first registry sport colours.
  function bannerGradient(a) {
    var s = sportById(registrySports(a)[0]);
    return s
      ? 'linear-gradient(120deg,' + s.colors.bg + ' 0%,' + s.colors.border + ' 100%)'
      : 'linear-gradient(120deg,var(--yellow-light) 0%,var(--gray-100) 100%)';
  }

  // Country/state fold in as display names + the USPS code so "United
  // States", "California" and "CA" all match; cards still render city-only.
  function searchText(a) {
    return [a.name, a.location, a.countryName, a.stateName, a.state, (a.sports || []).join(' ')]
      .join(' ').toLowerCase();
  }

  function chipsHTML(a) {
    var reg = registrySports(a);
    var shown = reg.slice(0, 3).map(function (id) {
      var label = window.arenasSportTag ? window.arenasSportTag(id) : sportName(id);
      return '<span class="adc-pill" data-sport="' + esc(id) + '" style="' + sportColorStyle(id) + '">' + esc(label) + '</span>';
    }).join('');
    var more = reg.length > 3 ? '<span class="adc-pill adc-pill-more">+' + (reg.length - 3) + '</span>' : '';
    return shown + more;
  }

  // view: 'grid' (banner strip + overlapping avatar) | 'list' (row; NO
  // banner element and therefore no banner request).
  function cardHTML(a, directoryIndex, listIndex, clickable, view) {
    var av = avColor(directoryIndex);
    var followers = a.followerCount || 0;
    var isGrid = view !== 'list';
    var banner = '';
    if (isGrid) {
      banner = '<div class="adc-banner" style="background:' + bannerGradient(a) + '">' +
        (a.banner_card_url
          ? '<img class="adc-banner-img" src="' + esc(a.banner_card_url) + '" alt="" loading="lazy" decoding="async" width="640" height="160">'
          : '') +
        '</div>';
    }
    return '' +
      '<div class="adc-card' + (isGrid ? ' adc-card-grid' : ' adc-card-row') + '" data-user-id="' + esc(a.id) + '"' + (clickable ? ' data-clickable="1"' : '') +
        ' style="animation-delay:' + (listIndex * 0.03) + 's">' +
        banner +
        '<div class="adc-head">' +
          window.avatarHtml(a.avatar_url || null, a.name || 'Athlete', 'adc-av', 'background:' + av.bg + ';color:' + av.color) +
          // Text block gets an explicit class: a positional .adc-head>div rule
          // would also catch the avatar wrapper div and its flex:1 would beat
          // .adc-av's fixed 42px box (higher specificity) — that exact bug
          // shipped once as stretched/unrounded avatars.
          '<div class="adc-head-main">' +
            '<div class="adc-name">' + esc(a.name || 'Athlete') + '</div>' +
            '<div class="adc-location">' + (a.location ? '📍 ' + esc(a.location) : '📍 Location not set') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="adc-tags">' + chipsHTML(a) + '</div>' +
        '<div class="adc-stats">' +
          '<div class="adc-stat"><span class="adc-stat-val">' + followers + '</span><span class="adc-stat-label">followers</span></div>' +
          '<div class="adc-stat"><span class="adc-stat-val">' + (a.postCount || 0) + '</span><span class="adc-stat-label">posts</span></div>' +
          '<div class="adc-stat"><span class="adc-stat-val">' + sportsCount(a) + '</span><span class="adc-stat-label">sports</span></div>' +
        '</div>' +
        '<div class="adc-foot">' +
          '<button class="adc-follow-btn' + (a.isFollowing ? ' is-following' : '') + '" data-user-id="' + esc(a.id) + '">' +
            (a.isFollowing ? 'Following' : 'Follow') +
          '</button>' +
        '</div>' +
      '</div>';
  }

  function emptyHTML(t, s) {
    return '<div style="grid-column:1/-1;text-align:center;padding:56px 24px;background:white;border:var(--border);border-radius:var(--radius-lg)">' +
      '<div style="font-size:36px;margin-bottom:12px">👥</div>' +
      '<h3 style="font-size:16px;font-weight:600;color:var(--gray-900);margin-bottom:6px">' + esc(t) + '</h3>' +
      '<p style="font-size:13px;color:var(--gray-500);line-height:1.6">' + esc(s) + '</p>' +
      '</div>';
  }

  function mount(opts) {
    var athletes = opts.athletes || [];
    var grid = opts.gridEl;
    var base = opts.base || window.BASE || '';
    var source = opts.source || 'athlete-cards';
    var empt = opts.emptyStates || {};
    if (!grid) return null;

    function toast(msg) {
      var fn = opts.toast || window.showToast;
      if (typeof fn === 'function') fn(msg);
    }
    function filters() {
      return (typeof opts.getFilters === 'function' ? opts.getFilters() : {}) || {};
    }

    function visibleList() {
      var f = filters();
      var list = athletes.slice();
      if (f.show === 'following') list = list.filter(function (a) { return a.isFollowing; });
      if (f.query) list = list.filter(function (a) { return searchText(a).indexOf(f.query) !== -1; });
      if (f.sport && f.sport !== 'all') list = list.filter(function (a) { return registrySports(a).indexOf(f.sport) !== -1; });
      var sort = f.sort || 'followers';
      list.sort(function (a, b) {
        if (sort === 'name') return (a.name || '').localeCompare(b.name || '');
        if (sort === 'new') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        return (b.followerCount || 0) - (a.followerCount || 0);
      });
      return list;
    }

    function render() {
      var f = filters();
      var list = visibleList();
      grid.className = (typeof opts.gridClass === 'function' ? opts.gridClass() : 'adc-grid adc-grid-2');
      if (opts.countEl) opts.countEl.textContent = opts.total > athletes.length
        ? 'Showing ' + list.length + ' of ' + opts.total + ' — refine with search'
        : list.length + ' athlete' + (list.length === 1 ? '' : 's');
      if (!athletes.length) {
        var e0 = empt.none || { t: 'No athletes yet', s: 'As more people join Arenas they will appear here.' };
        grid.innerHTML = emptyHTML(e0.t, e0.s);
      } else if (!list.length) {
        // Search wins over the tab: an empty search inside Following is a
        // search miss, not "not following anyone".
        var sportLbl = (f.sport && f.sport !== 'all') ? sportName(f.sport) : '';
        var followingAny = athletes.some(function (a) { return a.isFollowing; });
        var e1 = f.query
          ? (empt.noMatch || { t: 'No athletes match your search', s: 'Try a different name, sport or location.' })
          : (sportLbl
            ? (empt.noSport || { t: 'No ' + sportLbl.toLowerCase() + ' athletes here', s: f.show === 'following' ? 'Nobody you follow lists ' + sportLbl + ' yet.' : 'Pick another sport or show all sports.' })
            : ((f.show === 'following' && !followingAny)
              ? (empt.noFollowing || { t: 'Not following anyone yet', s: 'Follow athletes and they will show up here.' })
              : { t: 'No athletes', s: 'Nothing to show right now.' }));
        grid.innerHTML = emptyHTML(e1.t, e1.s);
      } else {
        var clickable = typeof opts.onCardClick === 'function';
        grid.innerHTML = list.map(function (a, i) {
          return cardHTML(a, athletes.indexOf(a), i, clickable, f.view === 'list' ? 'list' : 'grid');
        }).join('');
      }
      if (typeof opts.onRender === 'function') opts.onRender(list.length);
    }

    // The in-memory athlete model is the source of truth for the follower
    // count; every visible counter (card footer, card mini-stat, whatever the
    // host page shows via onFollowChange) derives from it so they never drift.
    function syncFollowUI(id, isFollowing, quiet) {
      var a = null;
      athletes.forEach(function (x) { if (x.id === id) a = x; });
      if (a) {
        if (isFollowing && !a.isFollowing) a.followerCount = (a.followerCount || 0) + 1;
        else if (!isFollowing && a.isFollowing) a.followerCount = Math.max(0, (a.followerCount || 0) - 1);
        a.isFollowing = isFollowing;
      }
      var followers = a ? (a.followerCount || 0) : 0;
      var btn = grid.querySelector('.adc-follow-btn[data-user-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      if (btn) {
        btn.classList.toggle('is-following', isFollowing);
        btn.textContent = isFollowing ? 'Following' : 'Follow';
        btn.disabled = false;
        var card = btn.closest('.adc-card');
        if (card) {
          var mutual = card.querySelector('.adc-mutual');
          if (mutual) mutual.textContent = followers + ' follower' + (followers === 1 ? '' : 's');
          var firstStat = card.querySelector('.adc-stats .adc-stat .adc-stat-val');
          if (firstStat) firstStat.textContent = followers;
        }
      }
      if (typeof opts.onFollowChange === 'function' && a) opts.onFollowChange(a, isFollowing, followers);
      // When viewing "Following", a membership change must drop/keep the card.
      if (filters().show === 'following') render();
      if (!quiet) {
        try {
          document.dispatchEvent(new CustomEvent('arenas:follow-change', {
            detail: { id: id, following: isFollowing, athlete: a, source: source }
          }));
        } catch (e) { /* older browsers: cross-surface sync is best-effort */ }
      }
    }

    async function toggleFollow(id, btn) {
      var wasFollowing = btn.classList.contains('is-following');
      btn.disabled = true;
      btn.textContent = wasFollowing ? 'Unfollowing…' : 'Following…';
      try {
        var res = await fetch(base + '/api/follow/' + id, { method: wasFollowing ? 'DELETE' : 'POST' });
        var result = await res.json();
        if (result.error) {
          toast('Error: ' + result.error);
          btn.disabled = false;
          btn.textContent = wasFollowing ? 'Following' : 'Follow';
          return;
        }
        syncFollowUI(id, !!result.following);
        toast(result.following ? '✓ Following — their posts will appear in your feed' : 'Unfollowed');
      } catch (err) {
        toast('Something went wrong — please try again');
        btn.disabled = false;
        btn.textContent = wasFollowing ? 'Following' : 'Follow';
      }
    }

    // A failed banner load falls back to the sport gradient underneath
    // (error does not bubble — capture phase on the grid).
    grid.addEventListener('error', function (ev) {
      var t = ev.target;
      if (t && t.classList && t.classList.contains('adc-banner-img')) {
        t.parentNode && t.parentNode.classList.add('adc-banner-failed');
        t.remove();
      }
    }, true);

    // One delegated listener: follow buttons + (optional) card clicks. No
    // inline onclick globals, so multiple instances can coexist on a page.
    grid.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.adc-follow-btn') : null;
      if (btn && grid.contains(btn) && btn.dataset.userId) {
        ev.stopPropagation();
        toggleFollow(btn.dataset.userId, btn);
        return;
      }
      if (typeof opts.onCardClick !== 'function') return;
      var card = ev.target.closest ? ev.target.closest('.adc-card') : null;
      if (card && grid.contains(card) && card.dataset.userId) {
        var a = null;
        athletes.forEach(function (x) { if (x.id === card.dataset.userId) a = x; });
        if (a) opts.onCardClick(a);
      }
    });

    // Apply follow changes made on OTHER surfaces (e.g. the Following tab's
    // Unfollow button) without re-dispatching.
    document.addEventListener('arenas:follow-change', function (ev) {
      var d = (ev && ev.detail) || {};
      if (!d.id || d.source === source) return;
      var a = null;
      athletes.forEach(function (x) { if (x.id === d.id) a = x; });
      if (a && a.isFollowing !== !!d.following) syncFollowUI(d.id, !!d.following, true);
    });

    return { render: render, syncFollowUI: syncFollowUI, athletes: athletes, avColor: avColor };
  }

  window.ArenasAthleteCards = {
    mount: mount,
    esc: esc,
    avColor: avColor,
    sportName: sportName,
    searchText: searchText,
    registrySports: registrySports,
    sportsCount: sportsCount,
    availableSports: availableSports,
    cardHTML: cardHTML
  };
})();
