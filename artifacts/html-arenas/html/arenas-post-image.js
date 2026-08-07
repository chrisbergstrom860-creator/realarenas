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
