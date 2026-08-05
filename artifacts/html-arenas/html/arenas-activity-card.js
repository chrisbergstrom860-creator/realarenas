// Shared activity-card BODY builder (main feed, club dashboard Feed tab,
// my-profile Activities tab). One renderer, no drift: this is the module the
// title/notes club-feed bug motivated — divergent hand-built copies of the
// same card body are how that bug happened.
//
// Scope: the BODY only, in the app-wide order title → stat tiles → notes →
// coach's note (→ feeling). Headers and footers stay per-surface — they
// legitimately differ (avatar vs sport tile, kudos give-button vs count chip
// vs none, delete button). Stat tiles come from arenas-stat-tiles.js (must be
// loaded first); classes live in arenas.css (.ac-title, .ac-notes-box,
// .fa-notes, .ac-coach-note, .ac-feeling + the .ac-ins inset modifier).
//
// Expects the activity in the feed payload shape: raw activities columns
// (title, notes, ai_insight, feeling + the stat fields the tile builder
// reads). Options:
//   inset:   true → each block carries .ac-ins (margin:0 14px 10px) for
//            flush cards (club dashboard). Default false = padded card.
//   title:   false → no title block (profile puts the title in its header).
//   feeling: true → render the "Feeling:" line (profile only).
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Athlete-written notes. Escaped; white-space:pre-line keeps line breaks
  // (safe — text already escaped). Long notes (>220 chars or >3 line breaks;
  // 500-char server cap upstream) clamp to 3 lines with a Show more toggle.
  // Returns '' when there are no notes so note-less cards render no block.
  function notesHtml(notes, ins) {
    var text = String(notes == null ? '' : notes);
    if (!text.trim()) return '';
    var isLong = text.length > 220 || (text.match(/\n/g) || []).length > 3;
    return '<div class="ac-notes-box' + ins + '">' +
      '<div class="fa-notes' + (isLong ? ' clamped' : '') + '">' + esc(text) + '</div>' +
      (isLong ? '<button type="button" class="fa-notes-toggle" onclick="toggleActivityNotes(this)">Show more</button>' : '') +
    '</div>';
  }

  window.toggleActivityNotes = function (btn) {
    var n = btn.previousElementSibling;
    if (!n) return;
    n.classList.toggle('clamped');
    btn.textContent = n.classList.contains('clamped') ? 'Show more' : 'Show less';
  };

  window.activityCardBody = function (a, opts) {
    opts = opts || {};
    var ins = opts.inset ? ' ac-ins' : '';
    var html = '';
    if (opts.title !== false && a.title) {
      html += '<div class="ac-title' + ins + '">' + esc(a.title) + '</div>';
    }
    var tiles = window.buildActivityStatTiles ? window.buildActivityStatTiles(a) : '';
    if (tiles) html += '<div class="ac-stats-row' + ins + '">' + tiles + '</div>';
    html += notesHtml(a.notes, ins);
    if (a.ai_insight) {
      html += '<div class="ac-coach-note' + ins + '"><span class="ic">📝</span><span><strong>Coach&#39;s note:</strong> ' + esc(a.ai_insight) + '</span></div>';
    }
    if (opts.feeling && a.feeling) {
      html += '<div class="ac-feeling' + ins + '">Feeling: ' + esc(a.feeling) + '</div>';
    }
    return html;
  };
})();
