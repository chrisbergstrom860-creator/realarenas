// ── ARENAS SHARED EVENT FORM ─────────────────────────────────────────────
// One implementation of the event create/edit form, shared by:
//   - the events page create overlay      (context 'events-page',  prefix 'evx')
//   - the club dashboard create modal     (context 'club-dashboard', prefix 'cev')
//   - the club dashboard edit modal       (context 'club-dashboard', prefix 'edit-ev')
// The module owns: field markup (registry with per-context include/exclude,
// select-vs-freetext and chips flags), prefill in edit mode, validation, the
// cover-image crop state machine + selection token, create-first-then-upload
// with the honest failure toast, PATCH body assembly, and teardown. Hosts own
// only chrome: overlay shell, header, button copy, notify banners, and
// post-success behavior.
//
// Guards preserved verbatim from the pre-convergence forms:
//   - crop state machine ('none'/'pending'/'ready'/'fallback') + selection
//     token: the raw file uploads ONLY on the explicit decode-fallback path,
//     never because an async crop hadn't resolved; stale callbacks from a
//     superseded selection are dropped (token check first).
//   - submit blocks while a crop is 'pending' (honest message, no race).
//   - dismissing the crop without choosing clears the input — never a silent
//     center-crop the user hasn't seen.
//   - teardown() invalidates in-flight callbacks and closes a crop overlay
//     that may still be open (or arrive late); hosts MUST route every close
//     path (✕, Cancel, backdrop, post-submit) through their teardown.
//   - create-first-then-upload: a failed image upload never rolls back the
//     create — it reports honestly; the card's Image action is the retry path.
//   - image_path never appears anywhere: previews use the authenticated
//     proxy URL with the payload's version token.
(function () {
  'use strict';
  var B = window.BASE || (location.pathname.indexOf('/html') === 0 ? '/html' : '');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(msg) { if (window.showToast) window.showToast(msg); }

  var TYPE_OPTIONS = ['Group training', 'Track session', 'Long run / ride', 'Race',
    'Social run / ride', 'Open water swim', 'Climbing session', 'Other'];
  var LEVEL_OPTIONS = ['All abilities', 'Beginner friendly', 'Intermediate', 'Advanced', 'Elite / competitive'];

  // The image URL is the authenticated proxy — never a storage URL. ?v= is
  // the version token from the payload; replacing the image changes it.
  function eventImageUrl(id, version) {
    return B + '/api/events/' + encodeURIComponent(id) + '/image?v=' + encodeURIComponent(version);
  }

  // ── build(opts) ──────────────────────────────────────────────────────────
  // opts: {
  //   mode: 'create'|'edit', context: 'events-page'|'club-dashboard',
  //   prefix: id prefix ('evx'|'cev'|'edit-ev'), clubId, event (edit mode),
  //   clubs: [{id,name}], following: [{id,name,avatar_url,location}],
  //   submitBtn: () => HTMLElement (resolved at submit time; host owns copy),
  //   submitBusyLabel, submitIdleLabel,
  //   toasts: { created, imageFailedPrefix }, onSuccess: function(result)
  // }
  // Returns { el (a <form>), submit(), teardown() }.
  function build(opts) {
    var p = opts.prefix;
    var mode = opts.mode;
    var ctx = opts.context;
    var onDashboard = ctx === 'club-dashboard';
    var ev = opts.event || {};
    var id = function (suffix) { return p + '-' + suffix; };

    // Per-context field set. Order matters — it is the render order.
    var fields = [];
    fields.push('title');
    if (mode === 'create') fields.push('sport');
    fields.push('event_type', 'datetime', 'location', 'distance_level_row', 'fee_max_row', 'description');
    if (mode === 'create') fields.push('image');
    if (ctx === 'events-page' && mode === 'create') fields.push('club_visibility', 'invitees');

    // Edit-mode prefill values (separate date + time inputs everywhere; the
    // ISO string is composed client-side on submit).
    var dateVal = '', timeVal = '07:00';
    if (mode === 'edit' && ev.date) {
      var d = new Date(ev.date);
      dateVal = d.toISOString().split('T')[0];
      timeVal = d.toTimeString().slice(0, 5);
    } else if (mode === 'create') {
      var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      dateVal = tomorrow.toISOString().split('T')[0];
    }

    function field(labelHtml, inner) {
      return '<div class="evx-field"><label class="evx-label">' + labelHtml + '</label>' + inner + '</div>';
    }
    function optHtml(list, current) {
      // A stored value outside the fixed list (free-text-created event, data
      // migration) must be PRESERVED as a selected option — otherwise the
      // browser silently submits the first option on any save, rewriting the
      // field the user never touched.
      var opts = list.indexOf(current) === -1 && current ? [current].concat(list) : list;
      return opts.map(function (o) {
        return '<option' + (current === o ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('');
    }

    var parts = [];
    parts.push('<div id="' + id('error') + '" class="evx-error" style="display:none"></div>');
    fields.forEach(function (f) {
      if (f === 'title') {
        parts.push(field('Title *', '<input class="evx-input" id="' + id('title') + '" name="title" required value="' + esc(ev.title || '') + '" placeholder="e.g. Saturday long run"></input>'.replace('></input>', '>')));
      } else if (f === 'sport') {
        if (onDashboard) {
          // Chip renderer (dashboard convention) from the sports registry,
          // first sport pre-selected (running — same as the historic markup).
          parts.push('<div class="evx-field"><label class="evx-label">Sport *</label>' +
            '<div class="evx-chips" id="' + id('sports') + '">' +
            (window.ARENAS_SPORTS || []).map(function (s, i) {
              return '<button type="button" class="evx-chip ' + p + '-sport-chip' + (i === 0 ? ' selected' : '') + '" data-sport="' + esc(s.id) + '">' + s.emoji + ' ' + esc(s.label) + '</button>';
            }).join('') + '</div></div>');
        } else {
          parts.push('<div class="evx-row">' +
            field('Sport *', '<select class="evx-select" id="' + id('sport') + '" name="sport" required><option value="">Select…</option>' +
              (window.ARENAS_SPORTS || []).map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.label) + '</option>'; }).join('') + '</select>') +
            field('Type', '<input class="evx-input" id="' + id('type') + '" name="event_type" placeholder="e.g. 10K, Sportive">') +
            '</div>');
        }
      } else if (f === 'event_type') {
        // Events page renders Type inline next to Sport (free-text, above) in
        // create mode; the dashboard uses the fixed select. Events-page EDIT
        // has no sport row, so Type must render here as its own free-text
        // field — without it, collect() would send event_type: null and the
        // PATCH would silently wipe the stored value.
        if (onDashboard) {
          parts.push(field('Event type', '<select class="evx-select" id="' + id('type') + '" name="event_type">' + optHtml(TYPE_OPTIONS, ev.event_type) + '</select>'));
        } else if (mode === 'edit') {
          parts.push(field('Type', '<input class="evx-input" id="' + id('type') + '" name="event_type" value="' + esc(ev.event_type || '') + '" placeholder="e.g. 10K, Sportive">'));
        }
      } else if (f === 'datetime') {
        parts.push('<div class="evx-row">' +
          field('Date *', '<input class="evx-input" type="date" id="' + id('date') + '" name="date" required value="' + esc(dateVal) + '">') +
          field('Start time *', '<input class="evx-input" type="time" id="' + id('time') + '" name="time" required value="' + esc(timeVal) + '">') +
          '</div>');
      } else if (f === 'location') {
        parts.push(field('Location *', '<input class="evx-input" id="' + id('location') + '" name="location" required value="' + esc(ev.location || '') + '" placeholder="e.g. Victoria Park, London">'));
      } else if (f === 'distance_level_row') {
        var levelInner = onDashboard
          ? '<select class="evx-select" id="' + id('level') + '" name="level">' + optHtml(LEVEL_OPTIONS, ev.level) + '</select>'
          : '<input class="evx-input" id="' + id('level') + '" name="level" value="' + esc(ev.level || '') + '" placeholder="e.g. All levels">';
        parts.push('<div class="evx-row">' +
          field('Distance', '<input class="evx-input" id="' + id('distance') + '" name="distance" value="' + esc(ev.distance || '') + '" placeholder="e.g. 13.1 mi">') +
          field('Level', levelInner) +
          '</div>');
      } else if (f === 'fee_max_row') {
        parts.push('<div class="evx-row">' +
          field('Entry fee', '<input class="evx-input" id="' + id('fee') + '" name="entry_fee" value="' + esc(ev.entry_fee || '') + '" placeholder="e.g. £20 (blank = free)">') +
          field('Max participants', '<input class="evx-input" type="number" min="1" id="' + id('max') + '" name="max_participants" value="' + esc(ev.max_participants || '') + '" placeholder="Optional">') +
          '</div>');
      } else if (f === 'description') {
        parts.push(field('Description', '<textarea class="evx-textarea" id="' + id('desc') + '" name="description" placeholder="Tell people what to expect…">' + esc(ev.description || '') + '</textarea>'));
      } else if (f === 'image') {
        parts.push(field('Cover image (optional)',
          '<input type="file" id="' + id('image') + '" accept="image/jpeg,image/png,image/webp" style="font-size:12px;width:100%">' +
          '<div class="evx-help">JPG, PNG or WebP up to 5 MB — shown as a wide banner (3:1 crop).</div>'));
      } else if (f === 'club_visibility') {
        var clubOpts = '<option value="">— Personal event —</option>' +
          (opts.clubs || []).map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('');
        parts.push('<div class="evx-row">' +
          field('Club', '<select class="evx-select" id="' + id('club') + '" name="club_id">' + clubOpts + '</select>') +
          field('Visibility', '<select class="evx-select" name="visibility" id="' + id('visibility') + '"><option value="public">Public</option><option value="club">Club only</option><option value="private">Private (invite only)</option></select>') +
          '</div>');
      } else if (f === 'invitees') {
        var following = opts.following || [];
        var inviteeRows = following.length
          ? following.map(function (fo) {
              return '<label class="evx-invitee"><input type="checkbox" value="' + esc(fo.id) + '"> ' +
                window.avatarHtml(fo.avatar_url || null, fo.name || 'Athlete', '', 'width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;background:var(--gray-200);color:var(--gray-700);flex-shrink:0;overflow:hidden') +
                ' ' + esc(fo.name) + (fo.location ? ' <span style="color:var(--gray-400)">' + esc(fo.location) + '</span>' : '') + '</label>';
            }).join('')
          : '<div style="font-size:12px;color:var(--gray-400);padding:6px 8px">Follow people to invite them.</div>';
        parts.push('<div class="evx-field"><label class="evx-label" id="' + id('invite-label') + '">Notify people you follow</label>' +
          '<div id="' + id('invitees') + '" class="evx-invitees">' + inviteeRows + '</div>' +
          '<div id="' + id('invite-help') + '" class="evx-help"></div></div>');
      }
    });

    var form = document.createElement('form');
    form.id = id('form');
    form.innerHTML = parts.join('');
    var g = function (suffix) { return form.querySelector('#' + id(suffix)); };

    // Chip selection (dashboard sport picker) — delegated, no globals.
    if (onDashboard && mode === 'create') {
      form.addEventListener('click', function (e) {
        var chip = e.target.closest && e.target.closest('.evx-chip');
        if (!chip) return;
        form.querySelectorAll('.evx-chip').forEach(function (c) { c.classList.remove('selected'); });
        chip.classList.add('selected');
      });
    }

    // Dual-mode invite list relabel (events page only): on public/club events
    // a checked person just gets a heads-up; on a PRIVATE event the list IS
    // the access list. Selections are preserved across relabels.
    if (g('visibility') && g('invitees')) {
      var syncInviteMode = function () {
        var visSel = g('visibility'), label = g('invite-label'), help = g('invite-help');
        if (!visSel || !label || !help) return;
        var checked = form.querySelectorAll('#' + id('invitees') + ' input:checked').length;
        if (visSel.value === 'private') {
          label.textContent = 'Invite list — only these people can see this event';
          help.textContent = checked === 0
            ? 'No one invited yet — only you will see this event.'
            : 'Invited athletes get a notification and are the only ones (besides you) who can view or RSVP.';
        } else {
          label.textContent = 'Notify people you follow';
          help.textContent = 'They\u2019ll get a heads-up — anyone who can see this event can join.';
        }
      };
      g('visibility').addEventListener('change', syncInviteMode);
      g('invitees').addEventListener('change', syncInviteMode);
      syncInviteMode();
    }

    // ── Cover-image crop wiring (create mode) ──
    var cropBlob = null, cropState = 'none', cropSeq = 0, cropHandle = null;
    var imgInput = g('image');
    if (imgInput) imgInput.addEventListener('change', function () {
      var seq = ++cropSeq;               // supersedes all in-flight callbacks
      cropBlob = null;
      if (cropHandle) { cropHandle.cancel(); cropHandle = null; }
      var file = imgInput.files && imgInput.files[0];
      if (!file) { cropState = 'none'; return; }
      if (!window.arenasCrop) { cropState = 'fallback'; return; }
      cropState = 'pending';
      cropHandle = window.arenasCrop.open({
        file: file,
        onDone: function (blob) {
          if (seq !== cropSeq) return;   // stale selection — drop it
          cropBlob = blob; cropState = 'ready';
        },
        onCancel: function (reason) {
          if (seq !== cropSeq) return;
          if (reason === 'decode') {
            cropState = 'fallback';
            toast('Couldn\u2019t open the crop tool — the photo will be center-cropped');
          } else {
            // Dismissed without choosing: keep nothing selected rather than
            // silently uploading a center-crop the user never saw.
            cropState = 'none';
            imgInput.value = '';
          }
        }
      });
    });

    function showError(msg) {
      var box = g('error');
      if (box) { box.textContent = msg; box.style.display = 'block'; }
    }
    function hideError() {
      var box = g('error');
      if (box) box.style.display = 'none';
    }
    function btnEl() { return opts.submitBtn ? opts.submitBtn() : null; }
    function btnBusy(busy) {
      var b = btnEl();
      if (!b) return;
      b.disabled = busy;
      b.textContent = busy ? (opts.submitBusyLabel || 'Working…') : (opts.submitIdleLabel || b.textContent);
    }

    function collect() {
      var body = {
        title: (g('title').value || '').trim(),
        event_type: null,
        date: null,
        location: (g('location').value || '').trim(),
        distance: (g('distance').value || '').trim() || null,
        entry_fee: (g('fee').value || '').trim() || null,
        max_participants: g('max').value || null,
        level: null,
        description: (g('desc').value || '').trim() || null
      };
      var typeEl = g('type');
      body.event_type = typeEl ? ((typeEl.value || '').trim() || null) : null;
      var levelEl = g('level');
      body.level = levelEl ? ((levelEl.value || '').trim() || null) : null;
      var dateEl = g('date'), timeEl = g('time');
      if (dateEl && dateEl.value) {
        body.date = new Date(dateEl.value + 'T' + ((timeEl && timeEl.value) || '07:00')).toISOString();
      }
      if (mode === 'create') {
        if (onDashboard) {
          var chip = form.querySelector('.evx-chip.selected');
          body.sport = chip ? chip.dataset.sport : 'running';
          body.visibility = 'club';        // hardwired on the dashboard
          body.club_id = opts.clubId;
          body.invitees = [];
        } else {
          body.sport = g('sport').value;
          body.club_id = g('club').value || null;
          body.visibility = g('visibility').value;
          body.invitees = [].slice.call(form.querySelectorAll('#' + id('invitees') + ' input:checked')).map(function (i) { return i.value; });
        }
      }
      return body;
    }

    function validate(body) {
      // Decode window guard: 'pending' means the crop step is still opening —
      // creating now would have to drop or center-crop an image the user
      // never saw. Block honestly instead. (Validation-stage in every host.)
      if (cropState === 'pending') return 'Still preparing the image crop — one moment.';
      if (ctx === 'events-page') {
        // Sport only exists (and is only required) in create mode — edit mode
        // has no sport field (immutable after creation).
        if (!body.title || (mode === 'create' && !body.sport) || !body.date || !body.location) {
          return mode === 'edit'
            ? 'Please fill in title, date and location.'
            : 'Please fill in title, sport, date and location.';
        }
        // Mirror the server's visibility/club shape rules with friendlier copy.
        if (body.visibility === 'club' && !body.club_id) {
          return 'Club-only events need a club — pick one, or choose Public/Private.';
        }
        if (body.visibility === 'private' && body.club_id) {
          return 'Private events are personal — set Club to \u201cPersonal event\u201d, or use Club only.';
        }
      } else {
        if (!body.title) return mode === 'edit' ? 'Please enter a title.' : 'Please enter an event title.';
        if (!body.date) return 'Please select a date.';
        if (!body.location) return 'Please enter a location.';
      }
      return null;
    }

    function uploadImageThen(eventId, done) {
      // Upload the cropped export when a crop was accepted; the raw file goes
      // up ONLY on the explicit decode-fallback path. 'pending'/'none' upload
      // nothing — never a center-crop the user hasn't seen.
      var rawFile = imgInput && imgInput.files && imgInput.files[0];
      var file = cropState === 'ready' ? cropBlob : (cropState === 'fallback' ? rawFile : null);
      if (!file || !eventId) {
        toast(opts.toasts.created);
        return done();
      }
      var fd = new FormData();
      if (cropState === 'ready') fd.append('image', cropBlob, 'crop.png');
      else fd.append('image', file);
      fetch(B + '/api/events/' + encodeURIComponent(eventId) + '/image', {
        method: 'POST', credentials: 'same-origin', body: fd
      }).then(function (r) { return r.json(); }).then(function (up) {
        if (up && up.error) toast('Event created — image failed: ' + up.error);
        else toast(opts.toasts.created);
        done();
      }).catch(function (e) {
        toast('Event created — image failed: ' + e.message);
        done();
      });
    }

    function submit() {
      hideError();
      var body = collect();
      var err = validate(body);
      if (err) return showError(err);
      btnBusy(true);
      if (mode === 'edit') {
        fetch(B + '/api/events/' + encodeURIComponent(ev.id), {
          method: 'PATCH', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: body.title, event_type: body.event_type, date: body.date,
            location: body.location, distance: body.distance, level: body.level,
            description: body.description, entry_fee: body.entry_fee,
            max_participants: body.max_participants
          })
        }).then(function (r) { return r.json(); }).then(function (result) {
          if (result && result.error) { showError('Error: ' + result.error); btnBusy(false); return; }
          opts.onSuccess(result);
        }).catch(function () {
          showError('Something went wrong — please try again.');
          btnBusy(false);
        });
        return;
      }
      fetch(B + '/api/events/create', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json(); }).then(function (result) {
        if (result && result.error) { showError(result.error); btnBusy(false); return; }
        // Create-first-then-upload: the event exists now, so a failed image
        // upload never rolls back the create.
        uploadImageThen(result.event && result.event.id, function () {
          opts.onSuccess(result);
        });
      }).catch(function (err2) {
        showError('Something went wrong: ' + err2.message);
        btnBusy(false);
      });
    }

    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });

    // teardown(): invalidate in-flight crop callbacks and close a crop
    // overlay that may still be open (or arrive late). Hosts MUST call this
    // on every close path or the crop can outlive its parent modal.
    function teardown() {
      cropSeq++; cropBlob = null; cropState = 'none';
      // cancel() covers the mid-decode window too — a crop overlay that
      // hasn't opened yet must never appear after its parent modal is gone.
      if (cropHandle) { cropHandle.cancel(); cropHandle = null; }
      if (window.arenasOverlay) window.arenasOverlay.close('arenas-crop-overlay');
    }

    return { el: form, submit: submit, teardown: teardown };
  }

  // ── manageImage(ev, opts) ────────────────────────────────────────────────
  // Image manager overlay for events the viewer can manage: preview,
  // upload/replace, remove. ev = { id, image } (version token, never a path).
  // opts.onChanged() runs after a successful upload or removal.
  function manageImage(ev, opts) {
    opts = opts || {};
    // Crop state must exist BEFORE the overlay opens: the primitive's onClose
    // (the single cancellation path) and beforeClose both read it.
    var cropBlob = null, cropState = 'none', cropSeq = 0, cropHandle = null;
    // Runs on EVERY close route the primitive has — Escape, backdrop, explicit
    // close(id) (✕, post-upload/remove), and same-id replacement: invalidate
    // the selection token, cancel a mid-decode crop, close an open crop
    // overlay. Same contract as the create/edit forms; no path can bypass it
    // because cancellation IS the close hook.
    var closed = false; // once true, this instance may never open a crop again
    var cancelCrop = function () {
      closed = true;
      cropSeq++; cropBlob = null; cropState = 'none';
      if (cropHandle) { cropHandle.cancel(); cropHandle = null; }
      window.arenasOverlay.close('arenas-crop-overlay');
    };
    var closeManager = function () { window.arenasOverlay.close('evx-img-modal'); };
    var overlay = window.arenasOverlay.open({
      id: 'evx-img-modal', // same-id replace goes through close → onClose, so a decode from an old instance can't orphan a crop overlay
      label: 'Event image',
      onClose: cancelCrop,
      // Escape/backdrop with a selected-but-not-uploaded image would silently
      // lose the user's crop — ask first. (✕ bypasses this by the primitive's
      // deliberate semantics, same as the create/edit dirty-guards.)
      beforeClose: function () {
        if (cropState === 'pending' || cropState === 'ready' || cropState === 'fallback') {
          return window.confirm('Discard the selected image?');
        }
        return true;
      },
      html:
      '<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:22px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
          '<div style="font-size:16px;font-weight:700;color:var(--gray-900)">Event image</div>' +
          '<div style="cursor:pointer;font-size:20px;color:var(--gray-400)" id="evx-img-x">×</div>' +
        '</div>' +
        (ev.image
          ? '<img src="' + esc(eventImageUrl(ev.id, ev.image)) + '" alt="" style="display:block;width:100%;height:125px;object-fit:cover;border-radius:8px">'
          : '<div style="font-size:12px;color:var(--gray-400)">No image yet — upload a wide photo (it\u2019s cropped to a 3:1 banner).</div>') +
        '<input type="file" id="evx-img-file" accept="image/jpeg,image/png,image/webp" style="font-size:12px;width:100%;margin-top:12px">' +
        '<div id="evx-img-err" style="display:none;font-size:12px;color:#b91c1c;margin-top:6px"></div>' +
        '<div style="display:flex;gap:8px;margin-top:12px">' +
          '<button id="evx-img-up" class="evx-rbtn" disabled>' + (ev.image ? 'Replace image' : 'Upload image') + '</button>' +
          (ev.image ? '<button id="evx-img-rm" class="evx-rbtn" style="color:#b91c1c;border-color:#fecaca">Remove image</button>' : '') +
        '</div>' +
      '</div>'
    });
    document.getElementById('evx-img-x').addEventListener('click', closeManager);
    var fileInput = document.getElementById('evx-img-file');
    var upBtn = document.getElementById('evx-img-up');
    var rmBtn = document.getElementById('evx-img-rm');
    var errBox = document.getElementById('evx-img-err');
    function fail(msg) { errBox.textContent = msg; errBox.style.display = 'block'; }
    var changed = function () { if (opts.onChanged) opts.onChanged(); };
    // File choice goes through the shared 3:1 crop step. Same state machine +
    // selection token as the create form: the Upload button stays DISABLED
    // until a crop is accepted (or the explicit decode-fallback fires), so a
    // slow decode can never race a raw file up, and stale callbacks from a
    // superseded selection are dropped. (State declared above the open() call
    // — onClose/beforeClose close over it.)
    fileInput.addEventListener('change', function () {
      // A change event can be delivered AFTER this instance closed (the input
      // is detached but its listener still fires — seen with synthetic file
      // setting). Opening a crop then would orphan the overlay; the seq guard
      // can't catch it because this handler takes a fresh seq. Hard-stop.
      if (closed) return;
      var seq = ++cropSeq;
      cropBlob = null; cropState = 'none';
      if (cropHandle) { cropHandle.cancel(); cropHandle = null; }
      errBox.style.display = 'none';
      upBtn.disabled = true;
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (!window.arenasCrop) { cropState = 'fallback'; upBtn.disabled = false; return; }
      cropState = 'pending';
      cropHandle = window.arenasCrop.open({
        file: file,
        onDone: function (blob) {
          if (seq !== cropSeq) return;    // stale selection — drop it
          cropBlob = blob; cropState = 'ready'; upBtn.disabled = false;
        },
        onCancel: function (reason) {
          if (seq !== cropSeq) return;
          if (reason === 'decode') {
            cropState = 'fallback'; upBtn.disabled = false;
            toast('Couldn\u2019t open the crop tool — the photo will be center-cropped');
          } else {
            cropState = 'none';
            fileInput.value = '';
            upBtn.disabled = true;
          }
        }
      });
    });
    upBtn.addEventListener('click', function () {
      var rawFile = fileInput.files && fileInput.files[0];
      var file = cropState === 'ready' ? cropBlob : (cropState === 'fallback' ? rawFile : null);
      if (!file) return;
      upBtn.disabled = true; upBtn.textContent = 'Uploading…';
      var fd = new FormData();
      if (cropState === 'ready') fd.append('image', cropBlob, 'crop.png');
      else fd.append('image', file);
      fetch(B + '/api/events/' + encodeURIComponent(ev.id) + '/image', {
        method: 'POST', credentials: 'same-origin', body: fd
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data && data.error) {
          fail(data.error);
          upBtn.disabled = false; upBtn.textContent = ev.image ? 'Replace image' : 'Upload image';
          return;
        }
        toast('✓ Image saved');
        closeManager();
        changed();
      }).catch(function (e) {
        fail('Upload failed: ' + e.message);
        upBtn.disabled = false; upBtn.textContent = ev.image ? 'Replace image' : 'Upload image';
      });
    });
    if (rmBtn) rmBtn.addEventListener('click', function () {
      rmBtn.disabled = true;
      fetch(B + '/api/events/' + encodeURIComponent(ev.id) + '/image', {
        method: 'DELETE', credentials: 'same-origin'
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data && data.error) { fail(data.error); rmBtn.disabled = false; return; }
        toast('Image removed');
        closeManager();
        changed();
      }).catch(function (e) { fail('Remove failed: ' + e.message); rmBtn.disabled = false; });
    });
  }

  window.arenasEventForm = { build: build, manageImage: manageImage, eventImageUrl: eventImageUrl };
})();
