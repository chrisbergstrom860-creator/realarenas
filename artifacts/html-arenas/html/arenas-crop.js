// Shared 3:1 cover-image cropper (ONE copy — served via its own dual route,
// same convention as every shared script). Dependency-free canvas cropper on
// top of the arenasOverlay primitive.
//
// Design decisions (approved spec):
//   - Single-axis control. Once a photo is cover-fitted into a fixed 3:1
//     frame exactly ONE axis is free (vertical for tall sources, horizontal
//     for ultra-wide ones). Drag directly on the frame along that axis,
//     mirrored by a range slider (thumb-friendly at 360px + accessible).
//     No pan-and-zoom: zoom could only discard pixels the frame keeps.
//   - The frame IS the live preview (WYSIWYG — its pixels are the output).
//   - The ORIGINAL never leaves the browser: export is a 1200×400 PNG blob
//     (lossless, so the server's WebP q82 stays the only lossy encode) that
//     the caller uploads through the existing endpoint. Server untouched.
//   - Large-image safety (iOS Safari caps canvas area/decoded memory and
//     fails SILENTLY with a blank draw): the source is downscaled to a
//     working bitmap of max 2400px per edge at decode time when possible
//     (createImageBitmap resize), and the export is sanity-checked — a
//     blank/black export from a non-black source fails HONESTLY instead of
//     uploading a black banner.
//
// API:
//   window.arenasCrop.open({ file, image, onDone(blob), onCancel })
//     file  : File from an <input type=file> (normal path)
//     image : HTMLImageElement/ImageBitmap or data-URL string (test/geometry
//             hook — file pickers can't be automated in the harness)
//     onDone: called with the cropped 1200×400 PNG Blob after "Use this crop"
//     onCancel: called when the overlay is dismissed without exporting
(function () {
  var OVERLAY_ID = 'arenas-crop-overlay';
  var MAX_WORK_EDGE = 2400;   // working-bitmap cap: well under iOS's ~4096
                              // edge / ~16.7M-pixel canvas limits, and ≥2× the
                              // 1200px output so quality is untouched.
  var OUT_W = 1200, OUT_H = 400;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Decode a File to a working bitmap capped at MAX_WORK_EDGE. Prefer
  // createImageBitmap with decode-time resize (never materialises the full
  // pixel grid). Fallback: <img> + canvas draw (the sanity check below is the
  // net if a huge source blanks that draw on iOS).
  function decodeFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { URL.revokeObjectURL(url); return reject(new Error('empty image')); }
        var scale = Math.min(1, MAX_WORK_EDGE / Math.max(w, h));
        var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
        var finish = function (source) {
          try {
            var c = document.createElement('canvas');
            c.width = tw; c.height = th;
            c.getContext('2d').drawImage(source, 0, 0, tw, th);
            URL.revokeObjectURL(url);
            resolve(c);
          } catch (err) { URL.revokeObjectURL(url); reject(err); }
        };
        if (window.createImageBitmap && scale < 1) {
          // Decode-time downscale: the safe path for 12–48MP phone photos.
          createImageBitmap(file, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' })
            .then(function (bmp) { finish(bmp); bmp.close && bmp.close(); })
            .catch(function () { finish(img); });
        } else {
          finish(img);
        }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  }

  function decodeAny(opts) {
    if (opts.image) {
      if (typeof opts.image === 'string') {
        return new Promise(function (resolve, reject) {
          var img = new Image();
          img.onload = function () { resolve(imgToWorkCanvas(img)); };
          img.onerror = function () { reject(new Error('decode failed')); };
          img.src = opts.image;
        });
      }
      return Promise.resolve(imgToWorkCanvas(opts.image));
    }
    return decodeFile(opts.file);
  }
  function imgToWorkCanvas(source) {
    var w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
    var scale = Math.min(1, MAX_WORK_EDGE / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  // Sample a canvas on an 8×8 grid. Returns { allTransparent, allBlack }.
  function sampleCanvas(canvas, sx, sy, sw, sh) {
    if (sx === undefined) { sx = 0; sy = 0; sw = canvas.width; sh = canvas.height; }
    var data;
    try { data = canvas.getContext('2d').getImageData(sx, sy, sw, sh).data; }
    catch (err) { return { allTransparent: false, allBlack: false }; }
    var allTransparent = true, allBlack = true;
    for (var gy = 0; gy < 8; gy++) {
      for (var gx = 0; gx < 8; gx++) {
        var px = Math.min(sw - 1, Math.floor((gx + 0.5) * sw / 8));
        var py = Math.min(sh - 1, Math.floor((gy + 0.5) * sh / 8));
        var i = (py * sw + px) * 4;
        if (data[i + 3] !== 0) allTransparent = false;
        if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) allBlack = false;
      }
    }
    return { allTransparent: allTransparent, allBlack: allBlack };
  }

  function open(opts) {
    opts = opts || {};
    if (!window.arenasOverlay) { if (opts.onCancel) opts.onCancel(); return; }
    var done = false;

    decodeAny(opts).then(function (work) {
      var imgW = work.width, imgH = work.height;
      // Crop rect in source coords: full extent on the constrained axis.
      var vertical = (imgH / imgW) > (1 / 3);          // taller than 3:1 → vertical slice choice
      var cropW = vertical ? imgW : Math.round(imgH * 3);
      var cropH = vertical ? Math.round(imgW / 3) : imgH;
      if (cropH > imgH) cropH = imgH;                   // exact-3:1 guard
      if (cropW > imgW) cropW = imgW;
      var range = vertical ? (imgH - cropH) : (imgW - cropW); // px of freedom
      var offset = 0.5;                                 // 0..1, start centered

      var overlay = window.arenasOverlay.open({
        id: OVERLAY_ID,
        label: 'Choose the crop',
        html:
          '<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:18px">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
              '<div style="font-size:15px;font-weight:700;color:var(--gray-900)">Choose the crop</div>' +
              '<div id="ac-close" style="cursor:pointer;font-size:20px;color:var(--gray-400);line-height:1">×</div>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--gray-400);margin-bottom:8px">' +
              (range > 0
                ? (vertical ? 'Drag the photo (or use the slider) to pick the slice that\u2019s kept.'
                            : 'Drag the photo (or use the slider) to pick the section that\u2019s kept.')
                : 'This photo is already 3:1 — nothing to choose.') +
            '</div>' +
            '<canvas id="ac-frame" style="display:block;width:100%;border-radius:8px;background:var(--gray-100);cursor:' +
              (range > 0 ? (vertical ? 'ns-resize' : 'ew-resize') : 'default') + ';touch-action:none"></canvas>' +
            (range > 0
              ? '<input id="ac-slider" type="range" min="0" max="1000" value="500" aria-label="Crop position" style="display:block;width:100%;margin-top:10px">'
              : '') +
            '<div id="ac-err" style="display:none;font-size:12px;color:#b91c1c;margin-top:8px"></div>' +
            '<div style="display:flex;gap:8px;margin-top:12px">' +
              '<button id="ac-use" class="evx-rbtn" style="flex:1;font-weight:600" data-autofocus>Use this crop</button>' +
              '<button id="ac-cancel" class="evx-rbtn">Cancel</button>' +
            '</div>' +
          '</div>',
        onClose: function () { if (!done && opts.onCancel) opts.onCancel(); }
      });

      var frame = overlay.querySelector('#ac-frame');
      var slider = overlay.querySelector('#ac-slider');
      var errBox = overlay.querySelector('#ac-err');
      // Frame pixels at layout size (crisp on retina is unnecessary for a
      // positioning preview; the EXPORT is always drawn from the working
      // bitmap at full 1200×400).
      var frameW = Math.max(1, Math.round(frame.getBoundingClientRect().width)) || 400;
      var frameH = Math.round(frameW / 3);
      frame.width = frameW; frame.height = frameH;
      frame.style.height = frameH + 'px';

      function cropRect() {
        var o = Math.max(0, Math.min(1, offset));
        return {
          sx: vertical ? 0 : Math.round(o * range),
          sy: vertical ? Math.round(o * range) : 0,
          sw: cropW, sh: cropH
        };
      }
      function render() {
        var r = cropRect();
        var ctx = frame.getContext('2d');
        ctx.clearRect(0, 0, frameW, frameH);
        ctx.drawImage(work, r.sx, r.sy, r.sw, r.sh, 0, 0, frameW, frameH);
      }
      function setOffset(o, fromSlider) {
        offset = Math.max(0, Math.min(1, o));
        if (slider && !fromSlider) slider.value = String(Math.round(offset * 1000));
        render();
      }
      render();

      // Drag along the free axis (pointer events cover mouse + touch).
      if (range > 0) {
        var dragging = false, startPos = 0, startOffset = 0.5;
        frame.addEventListener('pointerdown', function (e) {
          dragging = true; startPos = vertical ? e.clientY : e.clientX; startOffset = offset;
          frame.setPointerCapture && frame.setPointerCapture(e.pointerId);
          e.preventDefault();
        });
        frame.addEventListener('pointermove', function (e) {
          if (!dragging) return;
          var deltaPx = (vertical ? e.clientY : e.clientX) - startPos;
          // Dragging the PHOTO: moving it up shows a lower slice → invert,
          // and convert frame px to source px via the cover scale.
          var scale = frameW / cropW;                    // frame px per source px
          setOffset(startOffset - deltaPx / (range * scale || 1));
        });
        var end = function () { dragging = false; };
        frame.addEventListener('pointerup', end);
        frame.addEventListener('pointercancel', end);
        slider.addEventListener('input', function () { setOffset(Number(slider.value) / 1000, true); });
      }

      overlay.querySelector('#ac-cancel').addEventListener('click', function () {
        window.arenasOverlay.close(OVERLAY_ID);
      });
      overlay.querySelector('#ac-close').addEventListener('click', function () {
        window.arenasOverlay.close(OVERLAY_ID);
      });
      overlay.querySelector('#ac-use').addEventListener('click', function () {
        var r = cropRect();
        var out = document.createElement('canvas');
        out.width = OUT_W; out.height = OUT_H;
        out.getContext('2d').drawImage(work, r.sx, r.sy, r.sw, r.sh, 0, 0, OUT_W, OUT_H);
        // Silent-corruption net: a blank/black export from a source that is
        // NOT itself black in the chosen region means the draw failed (iOS
        // canvas limits fail without throwing). Fail honestly — never upload
        // a black banner. A genuinely black photo passes (source matches).
        var outS = sampleCanvas(out);
        var srcS = sampleCanvas(work, r.sx, r.sy, r.sw, r.sh);
        if (outS.allTransparent || (outS.allBlack && !srcS.allBlack)) {
          errBox.textContent = 'Couldn\u2019t process this photo on this device \u2014 try a smaller copy of it.';
          errBox.style.display = 'block';
          return;
        }
        out.toBlob(function (blob) {
          if (!blob) {
            errBox.textContent = 'Couldn\u2019t process this photo on this device \u2014 try a smaller copy of it.';
            errBox.style.display = 'block';
            return;
          }
          done = true;
          window.arenasOverlay.close(OVERLAY_ID);
          if (opts.onDone) opts.onDone(blob);
        }, 'image/png');
      });
    }).catch(function () {
      // Decode failed — the caller decides (events pages fall back to the
      // raw file, which the server center-crops exactly as before).
      if (opts.onCancel) opts.onCancel('decode');
    });
  }

  window.arenasCrop = { open: open };
})();
