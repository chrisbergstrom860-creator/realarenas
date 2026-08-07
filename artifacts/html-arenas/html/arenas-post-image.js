/* Shared post-image fragment — the ONE renderer for a post photo, used by
 * every surface that renders a post card (main feed postCardHtml + the club
 * dashboard Feed tab post branch), so the image renders once, not per page.
 *
 * Display contract (approved): the stored file preserves the source aspect
 * ratio (fit:'inside' server-side, never cropped). In the card the image is
 * width:100%, natural height up to a 700px cap; anything taller than the cap
 * is object-fit:cover trimmed FOR DISPLAY ONLY, and when that actually
 * happens a visible "⤢ Full image" pill appears (no silent crop). Tapping
 * the image opens a lightbox at natural aspect. Square/landscape photos get
 * no pill and no chrome.
 *
 * If the image 404s later, onerror removes the whole figure — no broken
 * image icon, text/chips unaffected.
 */
(function () {
  'use strict';

  function escAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Only http(s) URLs render — a corrupted pointer never becomes markup.
  function safeUrl(u) {
    return typeof u === 'string' && /^https?:\/\//.test(u) ? u : null;
  }

  // Fragment builder. post = any object with image_url. Returns '' when the
  // post has no image, so callers can concatenate unconditionally.
  window.postImageHtml = function (post) {
    var url = safeUrl(post && post.image_url);
    if (!url) return '';
    return '<figure class="pi-wrap" onclick="window.openPostImage(this)">' +
      '<img class="pi-img" src="' + escAttr(url) + '" alt="Post photo" loading="lazy"' +
      ' onload="window.postImageLoaded(this)"' +
      ' onerror="var f=this.closest(\'.pi-wrap\');if(f)f.remove()">' +
      '<span class="pi-expand" hidden>⤢ Full image</span>' +
      '</figure>';
  };

  // ── Delete affordance (shared) ── the ONE renderer + handler for the
  // author-only post delete, used by every surface that renders a post card
  // (main feed, club dashboard Feed tab post/announcement branches, club
  // member-home coach announcements). Rendered ONLY when the viewer is the
  // author; the server enforces authorship regardless (zero-leak 404).
  // opts.pushRight adds margin-left:auto for heads with no right-aligned
  // sibling before the button.
  window.postDeleteButtonHtml = function (post, viewerId, opts) {
    var owner = post && (post.user_id || post.userId);
    if (!owner || !viewerId || owner !== viewerId || !post.id) return '';
    var kudos = parseInt(post.likeCount, 10) || 0;
    var comments = parseInt(post.commentCount, 10) || 0;
    var hasPhoto = !!safeUrl(post.image_url);
    var style = (opts && opts.pushRight) ? ' style="margin-left:auto"' : '';
    return '<button class="pi-del" title="Delete post"' + style +
      ' onclick="window.deletePost(this,\'' + escAttr(post.id) + '\',' +
      (hasPhoto ? 1 : 0) + ',' + kudos + ',' + comments + ')">\u2715</button>';
  };

  // Confirmation copy names the photo, kudos and comments ONLY when present;
  // a bare post gets the short form.
  window.deletePost = function (btn, postId, hasPhoto, kudos, comments) {
    var parts = [];
    if (hasPhoto) parts.push('its photo');
    if (kudos > 0) parts.push(kudos + ' kudos');
    if (comments > 0) parts.push(comments + ' comment' + (comments === 1 ? '' : 's'));
    var what = parts.length
      ? 'This removes the post, ' + (parts.length > 1
          ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]
          : parts[0]) + '.'
      : 'This removes the post.';
    if (!confirm('Delete this post? ' + what + ' This can\u2019t be undone.')) return;
    btn.disabled = true;
    var B = window.BASE || (location.pathname.indexOf('/html') === 0 ? '/html' : '');
    fetch(B + '/api/posts/' + encodeURIComponent(postId), { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.success) throw new Error((data && data.error) || 'failed');
        var root = btn.closest('[data-post-root]');
        if (root) {
          // On the main feed the card sits inside a .feed-item-wrap — remove
          // the wrap so no empty timeline slot is left behind.
          var wrap = root.parentElement && root.parentElement.classList &&
            root.parentElement.classList.contains('feed-item-wrap')
            ? root.parentElement : root;
          wrap.style.transition = 'opacity .25s';
          wrap.style.opacity = '0';
          setTimeout(function () { wrap.remove(); }, 280);
        }
        if (typeof window.showToast === 'function') window.showToast('Post deleted');
      })
      .catch(function () {
        btn.disabled = false;
        if (typeof window.showToast === 'function') window.showToast('Could not delete — please try again');
        else alert('Could not delete — please try again');
      });
  };

  // After load: show the expand pill ONLY when the display cap actually
  // trimmed the image (rendered box shorter than the natural aspect implies).
  window.postImageLoaded = function (img) {
    try {
      if (!img.naturalWidth || !img.naturalHeight) return;
      var naturalDisplayH = img.clientWidth * (img.naturalHeight / img.naturalWidth);
      if (naturalDisplayH > img.clientHeight + 2) {
        var pill = img.parentElement && img.parentElement.querySelector('.pi-expand');
        if (pill) pill.hidden = false;
      }
    } catch (err) { /* cosmetic only */ }
  };

  // Lightbox: full image at natural aspect, dark backdrop, click/Esc closes.
  // No history push — same modal grammar as the in-app points modal.
  window.openPostImage = function (figure) {
    var img = figure && figure.querySelector('.pi-img');
    if (!img || !img.src) return;
    var overlay = document.createElement('div');
    overlay.className = 'pi-lightbox';
    overlay.innerHTML = '<img src="' + escAttr(img.src) + '" alt="Post photo">';
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  };
})();
