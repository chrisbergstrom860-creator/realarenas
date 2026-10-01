// Browser-only, read-only geometry probe. Serialized for the permanent guard
// and tested without a server, browser, credentials, or database fixtures.
export function logGeometry({ populated = false, expanded = false, longText = false } = {}) {
  const failures = [];
  const T = 1.5;
  const rect = el => el.getBoundingClientRect();
  const visible = el => {
    if (!el || !el.getClientRects().length) return false;
    for (let a = el; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    }
    return rect(el).width > 0 && rect(el).height > 0;
  };
  const inside = (a, b) => a.left >= b.left - T && a.right <= b.right + T
    && a.top >= b.top - T && a.bottom <= b.bottom + T;
  const clipAxis = value => /^(hidden|clip|auto|scroll)$/.test(value);
  const form = document.querySelector('#log-form');
  const side = document.querySelector('#log-side');
  const preview = document.querySelector('#log-preview');
  const toggle = document.querySelector('#log-preview-toggle');
  const main = document.querySelector('.main');
  const desktop = innerWidth > 1024;
  const expectedPreview = desktop || expanded;
  const tracks = main ? getComputedStyle(main).gridTemplateColumns.split(/\s+/).map(Number.parseFloat).filter(Number.isFinite) : [];
  if (tracks.length !== (desktop ? 2 : 1) || tracks.some(track => track <= 0))
    failures.push('main does not render the expected responsive grid columns');
  if (document.documentElement.scrollWidth > innerWidth + T) failures.push('page-level horizontal overflow');
  for (const [name, el] of [['form', form], ['side', side]]) {
    if (!visible(el)) failures.push(`${name} missing or hidden`);
    else if (rect(el).left < -T || rect(el).right > innerWidth + T) failures.push(`${name} escapes viewport`);
  }
  if (!preview || !toggle) failures.push('preview hooks missing');
  else {
    if (visible(preview) !== expectedPreview) failures.push('preview visibility does not match breakpoint/state');
    if (visible(toggle) === desktop) failures.push('preview toggle visibility does not match breakpoint');
    if (!desktop && toggle.getAttribute('aria-expanded') !== String(expanded)) failures.push('preview aria-expanded disagrees with state');
  }
  if (visible(form) && visible(side)) {
    const f = rect(form), s = rect(side);
    if (desktop) {
      if (f.right > s.left - T) failures.push('desktop columns overlap or lack a gap');
      // Sticky sidebars can move vertically during generic control hit-tests.
      // Column separation, not their scroll-dependent top edge, is invariant.
      if (f.width <= 0 || s.width <= 0) failures.push('desktop columns have no width');
    } else if (f.bottom > s.top + T) failures.push('mobile preview is not below the form');
  }
  if (populated) {
    if (!document.querySelector('#act-sport-chips [data-sport="running"].selected')) failures.push('running is not selected');
    if (!visible(document.querySelector('#act-sport-fields-body'))) failures.push('running fields are not rendered');
    const title = document.querySelector('#act-title');
    const notes = document.querySelector('#act-notes');
    const cardTitle = preview && preview.querySelector('.ac-title');
    const cardNotes = preview && preview.querySelector('.fa-notes');
    if (!cardTitle || cardTitle.textContent !== title?.value) failures.push('preview title missing or stale');
    if (longText && (!notes || notes.value.length !== 500 || !cardNotes || cardNotes.textContent !== notes.value))
      failures.push('500-character notes missing or stale');
  }
  let controls = 0, textRuns = 0, paintedRuns = 0, intentionalClamps = 0;
  const painted = [];
  for (const surface of [form, side].filter(visible)) {
    const boundary = rect(surface);
    for (const control of surface.querySelectorAll('input,select,textarea,button,[role="button"]')) {
      if (!visible(control)) continue;
      controls++;
      const r = rect(control), p = rect(control.parentElement);
      if (!inside(r, boundary) || !inside(r, p)) failures.push(`visible control escapes its container: ${control.id || control.tagName}`);
    }
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, owner = node.parentElement;
      if (!node.textContent.trim() || !visible(owner) || owner.closest('script,style,textarea,select,option')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const raw of range.getClientRects()) {
        if (raw.width <= 0 || raw.height <= 0) continue;
        textRuns++;
        let r = { left: raw.left, right: raw.right, top: raw.top, bottom: raw.bottom };
        let intentional = false;
        for (let a = owner; a; a = a.parentElement) {
          const style = getComputedStyle(a), b = rect(a);
          const clamp = a.matches('.fa-notes.clamped') && Number(style.webkitLineClamp) > 0 && clipAxis(style.overflowY);
          const ellipsis = style.textOverflow === 'ellipsis' && clipAxis(style.overflowX);
          if (clamp) { intentional = true; intentionalClamps++; }
          if (clipAxis(style.overflowX)) {
            if (!ellipsis && (r.left < b.left - T || r.right > b.right + T))
              failures.push(`unexpected horizontal text clipping: ${node.textContent.slice(0, 50)}`);
            r.left = Math.max(r.left, b.left); r.right = Math.min(r.right, b.right);
          }
          if (clipAxis(style.overflowY)) {
            if (!intentional && !/^(auto|scroll)$/.test(style.overflowY) && (r.top < b.top - T || r.bottom > b.bottom + T))
              failures.push(`unexpected vertical text clipping: ${node.textContent.slice(0, 50)}`);
            r.top = Math.max(r.top, b.top); r.bottom = Math.min(r.bottom, b.bottom);
          }
          if (a === surface) break;
        }
        if (r.right <= r.left || r.bottom <= r.top) continue;
        paintedRuns++;
        if (!inside(r, boundary)) failures.push(`painted text escapes surface: ${node.textContent.slice(0, 50)}`);
        // A contained element box can still paint text into its neighbour.
        // Check its nearest non-inline box, independently of overflow styles.
        let block = owner;
        while (block !== surface && /^inline$/.test(getComputedStyle(block).display)) block = block.parentElement;
        if (!inside(r, rect(block))) failures.push(`painted text escapes text container: ${node.textContent.slice(0, 50)}`);
        painted.push({ r, node });
      }
    }
  }
  for (let i = 0; i < painted.length; i++) for (let j = i + 1; j < painted.length; j++) {
    const a = painted[i], b = painted[j];
    if (a.node === b.node) continue;
    if (Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) > 3
      && Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 3)
      failures.push(`painted text overlaps: ${a.node.textContent.slice(0, 35)} / ${b.node.textContent.slice(0, 35)}`);
  }
  if (!controls || !paintedRuns) failures.push('no visible controls or painted text measured');
  return { ok: !failures.length, failures: [...new Set(failures)], desktop, tracks, controls, textRuns, paintedRuns, intentionalClamps };
}

export const logGeometryExpr = options => `(${logGeometry.toString()})(${JSON.stringify(options)})`;