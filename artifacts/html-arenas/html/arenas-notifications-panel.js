// ── SHARED IN-PLACE NOTIFICATIONS DROPDOWN ──
// Extracted verbatim from the club dashboard's inline panel so athlete shell
// pages get the same in-place bell dropdown (replaces the old /notifications
// page). Served at /html/arenas-notifications-panel.js and /arenas-notifications-panel.js
// and injected (markup + this <script>) via injectNotificationsPanel() in server.js.
// The dashboard keeps its own identical inline copy on purpose; the injection
// no-ops there because the panel id already exists.

// Reflect the real unread notification count on the bell icon.
(function(){
  var B = window.BASE || (location.pathname.indexOf("/html") === 0 ? "/html" : "");
  fetch(B + "/api/notifications").then(function(r){ return r.json(); }).then(function(data){
    var unread = (data && data.unreadCount) || 0;
    var dot = document.querySelector(".notif-dot");
    if (dot) dot.style.display = unread > 0 ? "block" : "none";
    var navBadge = document.getElementById("nav-unread-badge");
    if (navBadge) navBadge.textContent = unread > 0 ? unread : "";
  }).catch(function(){});
})();

// ── INLINE NOTIFICATIONS DROPDOWN (coach dashboard bell) ──
// Opens a panel in place instead of navigating away. Reuses the .notif-dot
// indicator (no separate number badge exists). All DB-derived text (n.body)
// is escaped before innerHTML — it contains user-supplied actor names.
(function () {
  var B = window.BASE || (location.pathname.indexOf('/html') === 0 ? '/html' : '');
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Notification links are server-generated, root-relative paths (e.g. /feed,
  // /join/<token>). Only follow ones that start with a single '/': this rejects
  // protocol-relative URLs (//evil.com), absolute URLs, and javascript: so a
  // malformed or hostile DB row can't turn a click into an open-redirect or
  // script execution.
  function isSafeLink(link) {
    return typeof link === 'string' && /^\/(?!\/)/.test(link);
  }
  var panelOpen = false;
  var typeIcons = { like: '👍', follow: '👤', comment: '💬', club: '🏃', challenge: '⚡', event: '📅', system: '✦' };
  var allNotifs = [];
  var showAll = false;
  var COLLAPSED = 15;

  function syncDot(unread) {
    var dot = document.querySelector('.notif-dot');
    if (dot) dot.style.display = unread > 0 ? 'block' : 'none';
  }
  function timeAgo(dateStr) {
    var s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (isNaN(s)) return '';
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function refreshCount() {
    fetch(B + '/api/notifications').then(function (r) { return r.json(); })
      .then(function (d) { syncDot((d && d.unreadCount) || 0); }).catch(function () {});
  }

  function renderNotificationsList() {
    var list = document.getElementById('notifications-panel-list');
    if (!list) return;
    var seeAll = document.getElementById('notif-see-all');
    if (!allNotifs.length) {
      list.innerHTML = '<div style="text-align:center;padding:32px;font-size:13px;color:var(--gray-400)">No notifications yet</div>';
      if (seeAll) seeAll.style.display = 'none';
      return;
    }
    var visible = showAll ? allNotifs : allNotifs.slice(0, COLLAPSED);
    list.innerHTML = visible.map(function (n) {
      var id = esc(n.id);
      var bg = n.read ? 'white' : '#FFFDF0';
      return '<div data-nid="' + id + '" onclick="openNotification(\'' + id + '\')"' +
        ' style="display:flex;align-items:flex-start;gap:10px;padding:11px 16px;border-bottom:var(--border);cursor:pointer;background:' + bg + '"' +
        ' onmouseenter="this.style.background=\'var(--gray-50)\'" onmouseleave="this.style.background=\'' + bg + '\'">' +
          '<div style="width:32px;height:32px;border-radius:50%;background:var(--yellow-light);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;margin-top:1px">' + (typeIcons[n.type] || '✦') + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:12px;color:var(--gray-900);line-height:1.5;margin-bottom:2px">' + esc(n.body) + '</div>' +
            '<div style="font-size:10px;color:var(--gray-400)">' + esc(timeAgo(n.created_at)) + '</div>' +
          '</div>' +
          (!n.read ? '<div style="width:7px;height:7px;border-radius:50%;background:#FFD21E;flex-shrink:0;margin-top:5px"></div>' : '') +
        '</div>';
    }).join('');
    // "See all" only matters when the collapsed view hides some notifications.
    if (seeAll) seeAll.style.display = (!showAll && allNotifs.length > COLLAPSED) ? 'inline' : 'none';
  }

  // Expand the in-place panel to the full list — the user never leaves the
  // page (replaces the old nav to the athlete /notifications page).
  window.showAllNotifications = function () {
    showAll = true;
    renderNotificationsList();
  };

  async function loadNotificationsPanel() {
    var list = document.getElementById('notifications-panel-list');
    if (!list) return;
    showAll = false;
    try {
      var r = await fetch(B + '/api/notifications');
      var data = await r.json();
      allNotifs = (data && !data.error && data.notifications) || [];
      renderNotificationsList();
      syncDot((data && data.unreadCount) || 0);
    } catch (err) {
      allNotifs = [];
      var seeAll = document.getElementById('notif-see-all');
      if (seeAll) seeAll.style.display = 'none';
      list.innerHTML = '<div style="text-align:center;padding:32px;font-size:13px;color:var(--gray-400)">Could not load notifications</div>';
    }
  }

  window.toggleNotificationsPanel = function () {
    var panel = document.getElementById('notifications-panel');
    if (!panel) return;
    panelOpen = !panelOpen;
    panel.style.display = panelOpen ? 'flex' : 'none';
    if (panelOpen) loadNotificationsPanel();
  };

  window.markNotificationRead = async function (id) {
    try { await fetch(B + '/api/notifications/' + id + '/read', { method: 'POST' }); } catch (e) {}
    for (var i = 0; i < allNotifs.length; i++) {
      if (String(allNotifs[i].id) === String(id)) { allNotifs[i].read = true; break; }
    }
    var item = document.querySelector('#notifications-panel-list [data-nid="' + id + '"]');
    if (item) {
      item.style.background = 'white';
      item.setAttribute('onmouseleave', "this.style.background='white'");
      var dot = item.querySelector('div[style*="FFD21E"]');
      if (dot) dot.remove();
    }
    refreshCount();
  };

  // Clicking a notification marks it read; if it carries a link, navigate there
  // too (e.g. a club invite -> /join/:token, a like/comment -> /feed). Rows with
  // no link just mark read. The panel is a sibling of the bell, so this click
  // never bubbles into the bell's toggle. We await the read POST before
  // navigating so it isn't cancelled by the page unloading.
  window.openNotification = async function (id) {
    var link = '';
    for (var i = 0; i < allNotifs.length; i++) {
      if (String(allNotifs[i].id) === String(id)) { link = allNotifs[i].link || ''; break; }
    }
    await window.markNotificationRead(id);
    if (isSafeLink(link)) {
      if (typeof window.nav === 'function') window.nav(link);
      else window.location.href = (window.BASE || B) + link;
    }
  };

  window.markAllNotificationsRead = async function () {
    try { await fetch(B + '/api/notifications/read-all', { method: 'POST' }); } catch (e) {}
    allNotifs.forEach(function (n) { n.read = true; });
    document.querySelectorAll('#notifications-panel-list [data-nid]').forEach(function (item) {
      item.style.background = 'white';
      item.setAttribute('onmouseleave', "this.style.background='white'");
      var dot = item.querySelector('div[style*="FFD21E"]');
      if (dot) dot.remove();
    });
    syncDot(0);
    if (typeof showToast === 'function') showToast('All notifications marked as read');
  };

  // Close the panel when clicking outside it (and not on the bell).
  document.addEventListener('click', function (e) {
    var panel = document.getElementById('notifications-panel');
    var bell = document.querySelector('[onclick*="toggleNotificationsPanel"]');
    if (panel && !panel.contains(e.target) && bell && !bell.contains(e.target)) {
      panel.style.display = 'none';
      panelOpen = false;
    }
  });
})();
