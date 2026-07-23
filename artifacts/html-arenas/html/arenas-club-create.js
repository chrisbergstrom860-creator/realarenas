// Arenas club creation — shared contract layer + in-app modal.
//
// TWO surfaces create clubs for logged-in users and both MUST go through the
// contract layer below so rules can't drift:
//   1. The /for-clubs marketing wizard (its own UI, session-aware) — uses
//      validateClub / deriveHandle / filterInvites / submit from here.
//   2. The in-app club-setup modal (ArenasClubCreate.open()), opened by the
//      sidebar "+ Create club" on every app-shell page — same layer, same
//      POST /api/clubs/create, same inline error mapping.
// Server-side validation is identical by construction: both surfaces hit the
// single authenticated endpoint; everything here is UX-level pre-checking.
window.ArenasClubCreate = (function () {
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ══ CONTRACT LAYER (shared by /for-clubs wizard AND the in-app modal) ══

  // Client-side field rules — mirrors (never replaces) the server's checks.
  function validateClub(f) {
    if (!f || !f.name) return { ok: false, msg: 'Please enter your club name.' };
    if (!f.handle) return { ok: false, msg: 'Please choose a club handle.' };
    if (!f.sport) return { ok: false, msg: 'Please select your primary sport.' };
    return { ok: true };
  }

  // Canonical handle derivation from a club name (matches the server's
  // /^[a-z0-9]{2,20}$/ charset).
  function deriveHandle(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  }

  // Normalize + filter invite rows: trim, lowercase role, keep only rows with
  // a syntactically valid email. Input: array of {email,name,role}.
  function filterInvites(rows) {
    return (rows || []).map(function (r) {
      return {
        email: String((r && r.email) || '').trim(),
        name: String((r && r.name) || '').trim(),
        role: String((r && r.role) || 'Member').toLowerCase()
      };
    }).filter(function (r) { return EMAIL_RE.test(r.email); });
  }

  // Authenticated create. Returns a normalized result either surface can map
  // onto its own steps:
  //   {ok:true, redirect}                      — go to the new club dashboard
  //   {ok:false, target:'club'|'review', msg}  — inline error; 'club' means
  //     the club-details step, 'review' the final step.
  async function submit(club, invites) {
    try {
      var r = await fetch(window.BASE + '/api/clubs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: club.name,
          handle: club.handle,
          sport: club.sport,
          city: club.city || '',
          invites: invites || []
        })
      });
      var d = {};
      try { d = await r.json(); } catch (e) { d = {}; }
      if (r.ok && d.redirect) return { ok: true, redirect: d.redirect };
      if (d.error === 'handle_taken') return { ok: false, target: 'club', msg: 'That handle is already taken — try another.' };
      if (d.error === 'invalid_handle') return { ok: false, target: 'club', msg: 'Handles are 2–20 lowercase letters or numbers.' };
      if (d.error === 'invalid_name' || d.error === 'invalid_sport') return { ok: false, target: 'club', msg: 'Please check your club name and sport.' };
      if (d.error === 'club_limit') return { ok: false, target: 'review', msg: 'You\u2019ve reached the limit of ' + (d.limit || 3) + ' clubs per account.' };
      return { ok: false, target: 'review', msg: 'Could not create your club right now \u2014 please try again.' };
    } catch (err) {
      return { ok: false, target: 'review', msg: 'Could not create your club right now \u2014 please try again.' };
    }
  }

  // ══ IN-APP MODAL (app-shell pages only; /for-clubs keeps its own wizard) ══
  // App modal language: .modal-overlay pattern (fixed scrim, centered card on
  // desktop, bottom sheet ≤768px like the calendar day panel). Own ccm-
  // prefixed classes so nothing collides with each page's local modal CSS.
  // No "Creating as" indicator here — inside the app you're visibly in your
  // own account (topbar identity); that indicator stays on /for-clubs where a
  // logged-in visitor is on marketing chrome.

  var STEPS = ['club', 'invites', 'review'];
  var stepIdx = 0;
  var built = false;

  var CSS = [
    '.ccm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:500;display:none;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(3px)}',
    '.ccm-overlay.open{display:flex}',
    '.ccm-modal{background:white;border-radius:var(--radius-lg);width:100%;max-width:520px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.2);overflow:hidden}',
    '.ccm-header{padding:16px 20px;border-bottom:var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0}',
    '.ccm-title{font-size:15px;font-weight:700;color:var(--gray-900)}',
    '.ccm-step-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--gray-400);font-family:var(--mono)}',
    '.ccm-close{background:none;border:none;font-size:16px;color:var(--gray-400);cursor:pointer;padding:4px 8px;border-radius:6px;line-height:1}',
    '.ccm-close:hover{background:var(--gray-100);color:var(--gray-700)}',
    '.ccm-body{padding:18px 20px;overflow-y:auto;flex:1}',
    '.ccm-step{display:none}.ccm-step.active{display:block}',
    '.ccm-err{display:none;background:var(--red-light);border:1px solid #FECACA;border-radius:8px;padding:9px 12px;font-size:12.5px;color:#A32D2D;margin-bottom:12px}',
    '.ccm-err.show{display:block}',
    '.ccm-field{margin-bottom:12px}',
    '.ccm-label{display:block;font-size:11.5px;font-weight:600;color:var(--gray-600);margin-bottom:4px}',
    '.ccm-label span{font-weight:400;color:var(--gray-400)}',
    '.ccm-input,.ccm-select,.ccm-modal select,.ccm-modal input{font-family:var(--font)}',
    '.ccm-input,.ccm-select{width:100%;padding:9px 11px;border:var(--border);border-radius:8px;font-size:13.5px;color:var(--gray-900);background:white;outline:none;box-sizing:border-box}',
    '.ccm-input:focus,.ccm-select:focus{border-color:var(--gray-400)}',
    '.ccm-handle-wrap{position:relative}',
    '.ccm-handle-wrap .ccm-input{padding-left:26px}',
    '.ccm-at{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:13px;color:var(--gray-400);font-family:var(--mono)}',
    '.ccm-hint{font-size:11.5px;color:var(--gray-400);margin-top:4px}',
    '.ccm-inv-row{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) 92px 28px;gap:6px;margin-bottom:6px;align-items:center}',
    '.ccm-inv-row .ccm-input,.ccm-inv-row .ccm-select{padding:7px 9px;font-size:12.5px}',
    '.ccm-inv-del{background:none;border:none;color:var(--gray-400);cursor:pointer;font-size:13px;padding:4px;border-radius:6px}',
    '.ccm-inv-del:hover{background:var(--gray-100);color:var(--red)}',
    '.ccm-add-row{font-size:12.5px;font-weight:600;color:var(--gray-600);cursor:pointer;padding:7px 0;display:inline-block}',
    '.ccm-add-row:hover{color:var(--gray-900)}',
    '.ccm-review-card{background:var(--gray-50);border:var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:10px}',
    '.ccm-review-eyebrow{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--gray-400);margin-bottom:6px}',
    '.ccm-review-main{font-size:13.5px;font-weight:600;color:var(--gray-900)}',
    '.ccm-review-sub{font-size:12px;color:var(--gray-500)}',
    '.ccm-fineprint{font-size:11.5px;color:var(--gray-400);text-align:center;margin-top:10px}',
    '.ccm-fineprint a{color:inherit;text-decoration:underline}',
    '.ccm-footer{padding:12px 20px;border-top:var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0}',
    '.ccm-back{background:none;border:var(--border);border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;color:var(--gray-600);cursor:pointer;font-family:var(--font)}',
    '.ccm-back:disabled{opacity:.4;cursor:default}',
    '.ccm-counter{font-size:11.5px;color:var(--gray-400);font-family:var(--mono)}',
    '.ccm-next{background:var(--gray-900);color:white;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)}',
    '.ccm-next.launch{background:var(--yellow);color:var(--gray-900)}',
    '.ccm-next:disabled{opacity:.6;cursor:default}',
    '@media (max-width:768px){',
    '.ccm-overlay{padding:0;align-items:flex-end}',
    '.ccm-modal{max-width:none;border-radius:16px 16px 0 0;max-height:92vh}',
    '.ccm-inv-row{grid-template-columns:minmax(0,1fr) 28px;grid-auto-rows:auto}',
    '.ccm-inv-row .ccm-inv-email{grid-column:1/2}',
    '.ccm-inv-row .ccm-inv-del{grid-column:2/3;grid-row:1/2}',
    '.ccm-inv-row .ccm-inv-name,.ccm-inv-row .ccm-select{grid-column:1/3}',
    '}'
  ].join('\n');

  function sportOptions() {
    var sports = window.ARENAS_SPORTS || [];
    var out = '<option value="">Select a sport\u2026</option>';
    sports.forEach(function (s) {
      out += '<option value="' + s.id + '">' + (s.emoji ? s.emoji + ' ' : '') + s.label + '</option>';
    });
    return out;
  }

  function inviteRowHtml() {
    return '<input class="ccm-input ccm-inv-email" type="email" placeholder="name@example.com">' +
      '<input class="ccm-input ccm-inv-name" type="text" placeholder="Name (opt)">' +
      '<select class="ccm-select"><option>Member</option><option>Coach</option><option>Admin</option></select>' +
      '<button type="button" class="ccm-inv-del" title="Remove">\u2715</button>';
  }

  function build() {
    if (built) return;
    built = true;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var ov = document.createElement('div');
    ov.className = 'ccm-overlay';
    ov.id = 'ccm-overlay';
    ov.innerHTML =
      '<div class="ccm-modal" role="dialog" aria-modal="true" aria-label="Create your club">' +
        '<div class="ccm-header">' +
          '<div><div class="ccm-title">Create your club</div><div class="ccm-step-label" id="ccm-step-label">Step 1 of 3 \u00b7 Your club</div></div>' +
          '<button type="button" class="ccm-close" id="ccm-close">\u2715</button>' +
        '</div>' +
        '<div class="ccm-body">' +

          '<div class="ccm-step active" id="ccm-step-club">' +
            '<div class="ccm-err" id="ccm-err-club"></div>' +
            '<div class="ccm-field"><label class="ccm-label">Club name</label>' +
              '<input class="ccm-input" type="text" id="ccm-name" placeholder="Riverside Run Club"></div>' +
            '<div class="ccm-field"><label class="ccm-label">Club handle</label>' +
              '<div class="ccm-handle-wrap"><span class="ccm-at">@</span>' +
              '<input class="ccm-input" type="text" id="ccm-handle" placeholder="riversiderun"></div>' +
              '<div class="ccm-hint">2\u201320 lowercase letters or numbers \u2014 your club\u2019s unique address.</div></div>' +
            '<div class="ccm-field"><label class="ccm-label">Primary sport</label>' +
              '<select class="ccm-select" id="ccm-sport">' + sportOptions() + '</select></div>' +
            '<div class="ccm-field"><label class="ccm-label">City <span>(optional)</span></label>' +
              '<input class="ccm-input" type="text" id="ccm-city" placeholder="London"></div>' +
          '</div>' +

          '<div class="ccm-step" id="ccm-step-invites">' +
            '<div class="ccm-err" id="ccm-err-invites"></div>' +
            '<div style="font-size:12.5px;color:var(--gray-500);margin-bottom:10px">Invite your first members \u2014 each gets an email with a join link. You can skip this and invite later.</div>' +
            '<div id="ccm-inv-rows"></div>' +
            '<span class="ccm-add-row" id="ccm-add-row">+ Add another member</span>' +
          '</div>' +

          '<div class="ccm-step" id="ccm-step-review">' +
            '<div class="ccm-err" id="ccm-err-review"></div>' +
            '<div class="ccm-review-card"><div class="ccm-review-eyebrow">Your club</div>' +
              '<div class="ccm-review-main" id="ccm-review-name">\u2014</div>' +
              '<div class="ccm-review-sub" id="ccm-review-handle">\u2014</div>' +
              '<div class="ccm-review-sub" id="ccm-review-meta"></div></div>' +
            '<div class="ccm-review-card"><div class="ccm-review-eyebrow">Invites queued</div>' +
              '<div class="ccm-review-sub" style="font-size:12.5px;color:var(--gray-700)" id="ccm-review-invites">\u2014</div></div>' +
            '<div class="ccm-review-card" style="font-size:12px;color:var(--gray-600);line-height:1.55"><strong>Your club launches on Club Starter, which is free</strong> \u2014 no credit card required. Club Pro can be added anytime from your Billing page.</div>' +
            '<div class="ccm-fineprint">By launching you agree to our <a href="' + ((window.BASE || '') + '/terms') + '" target="_blank" rel="noopener">Terms of Service</a>.</div>' +
          '</div>' +

        '</div>' +
        '<div class="ccm-footer">' +
          '<button type="button" class="ccm-back" id="ccm-back" disabled>\u2190 Back</button>' +
          '<span class="ccm-counter" id="ccm-counter">Step 1 of 3</span>' +
          '<button type="button" class="ccm-next" id="ccm-next">Continue \u2192</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    // Two starter invite rows, matching the /for-clubs wizard.
    addInvRow(); addInvRow();

    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('ccm-close').onclick = close;
    document.getElementById('ccm-back').onclick = back;
    document.getElementById('ccm-next').onclick = next;
    document.getElementById('ccm-add-row').onclick = function () { addInvRow(true); };
    document.getElementById('ccm-name').addEventListener('input', function () {
      document.getElementById('ccm-handle').value = deriveHandle(this.value);
    });
  }

  function addInvRow(focus) {
    var rows = document.getElementById('ccm-inv-rows');
    var row = document.createElement('div');
    row.className = 'ccm-inv-row';
    row.innerHTML = inviteRowHtml();
    row.querySelector('.ccm-inv-del').onclick = function () {
      if (rows.children.length > 1) row.remove();
    };
    rows.appendChild(row);
    if (focus) row.querySelector('input').focus();
  }

  function showErr(step, msg) {
    var el = document.getElementById('ccm-err-' + step);
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 5000);
  }

  var STEP_LABELS = { club: 'Your club', invites: 'Invite members', review: 'Launch' };

  function showStep(i) {
    stepIdx = i;
    STEPS.forEach(function (s, j) {
      document.getElementById('ccm-step-' + s).classList.toggle('active', j === i);
    });
    var pos = i + 1;
    document.getElementById('ccm-step-label').textContent = 'Step ' + pos + ' of 3 \u00b7 ' + STEP_LABELS[STEPS[i]];
    document.getElementById('ccm-counter').textContent = 'Step ' + pos + ' of 3';
    document.getElementById('ccm-back').disabled = i === 0;
    var nextBtn = document.getElementById('ccm-next');
    if (i === STEPS.length - 1) {
      nextBtn.textContent = '\ud83d\ude80 Launch my club';
      nextBtn.classList.add('launch');
      populateReview();
    } else {
      nextBtn.textContent = 'Continue \u2192';
      nextBtn.classList.remove('launch');
    }
    document.querySelector('#ccm-overlay .ccm-body').scrollTop = 0;
  }

  function readClub() {
    return {
      name: document.getElementById('ccm-name').value.trim(),
      handle: document.getElementById('ccm-handle').value.trim(),
      sport: document.getElementById('ccm-sport').value,
      city: document.getElementById('ccm-city').value.trim()
    };
  }

  function readInvites() {
    return filterInvites([].map.call(document.querySelectorAll('#ccm-inv-rows .ccm-inv-row'), function (row) {
      return {
        email: (row.querySelector('input[type=email]') || {}).value,
        name: (row.querySelector('.ccm-inv-name') || {}).value,
        role: (row.querySelector('select') || {}).value
      };
    }));
  }

  function populateReview() {
    var c = readClub();
    var invites = readInvites();
    document.getElementById('ccm-review-name').textContent = c.name || '\u2014';
    document.getElementById('ccm-review-handle').textContent = c.handle ? '@' + c.handle : '\u2014';
    var sport = (window.ARENAS_SPORTS || []).filter(function (s) { return s.id === c.sport; })[0];
    document.getElementById('ccm-review-meta').textContent =
      (sport ? sport.label : '') + (c.city ? (sport ? ' \u00b7 ' : '') + c.city : '');
    document.getElementById('ccm-review-invites').textContent = invites.length
      ? invites.length + ' member invite' + (invites.length !== 1 ? 's' : '') + ' ready to send'
      : 'No invites added \u2014 you can invite members from your dashboard';
  }

  function next() {
    var step = STEPS[stepIdx];
    if (step === 'club') {
      var v = validateClub(readClub());
      if (!v.ok) { showErr('club', v.msg); return; }
    }
    if (stepIdx < STEPS.length - 1) { showStep(stepIdx + 1); return; }
    launch();
  }

  function back() { if (stepIdx > 0) showStep(stepIdx - 1); }

  async function launch() {
    var nextBtn = document.getElementById('ccm-next');
    nextBtn.disabled = true;
    nextBtn.textContent = 'Launching\u2026';
    var res = await submit(readClub(), readInvites());
    if (res.ok) { window.location.href = res.redirect; return; }
    nextBtn.disabled = false;
    nextBtn.textContent = '\ud83d\ude80 Launch my club';
    showStep(res.target === 'club' ? 0 : STEPS.length - 1);
    showErr(res.target, res.msg);
  }

  function open() {
    // Sport picker needs the injected registry; without it (shouldn't happen
    // on shell pages) fall back to the session-aware /for-clubs wizard.
    if (!window.ARENAS_SPORTS || !window.ARENAS_SPORTS.length) {
      if (typeof window.nav === 'function') window.nav('/for-clubs?create=1');
      return;
    }
    build();
    showStep(0);
    document.getElementById('ccm-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    var ov = document.getElementById('ccm-overlay');
    if (ov) ov.classList.remove('open');
    document.body.style.overflow = '';
  }

  return {
    validateClub: validateClub,
    deriveHandle: deriveHandle,
    filterInvites: filterInvites,
    submit: submit,
    open: open,
    close: close
  };
})();
