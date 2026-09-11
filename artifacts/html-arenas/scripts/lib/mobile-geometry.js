// Shared mobile-geometry audit library.
//
// Why this exists: presence checks and page-level scrollWidth checks are
// structurally blind to (1) content clipped inside an overflow:hidden
// container and (2) elements drawn on top of each other. This library
// measures real rendered geometry in headless Chromium and fails on exactly
// those defect classes. It is the engine behind
// scripts/verify-mobile-geometry.js (the permanent guard) — new pages get a
// config entry there, never a copied script.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

export const VIEWPORTS = [360, 380, 414];
// Desktop widths — same clip/overlap/button/hscroll assertions. The guard was
// desktop-blind until the shell-centering work; these make every future
// desktop layout change measurable instead of screenshot-only.
export const DESKTOP_VIEWPORTS = [1280, 1440, 1920];

export function chromiumPath() {
  return process.env.CHROMIUM_BIN
    || execSync('command -v chromium || command -v chromium-browser').toString().trim();
}

export async function launchBrowser() {
  return chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

// Bottom-navigation contract. The expression intentionally keeps the
// expected obstruction position when a FAB is missing: a missing FAB must not
// turn the clearance assertion into a pass. That makes the pre-FAB layout a
// useful baseline (its old 76px padding leaves content under the expected
// FAB), rather than an artificial green run.
export function bottomNavExpr(expected) {
  return `(() => {
  const T = 1.5;
  const EPS = 0.01;
  const E = ${JSON.stringify(expected)};
  const nav = document.querySelector('.bottom-nav');
  const fab = document.querySelector('.bn-fab');
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none'
      && s.visibility !== 'hidden' && s.opacity !== '0';
  };
  const safeInset = () => {
    const probe = document.createElement('i');
    probe.style.cssText = 'position:fixed;left:0;bottom:env(safe-area-inset-bottom,0px);width:0;height:0;pointer-events:none;';
    document.body.appendChild(probe);
    const inset = Math.max(0, window.innerHeight - probe.getBoundingClientRect().bottom);
    probe.remove();
    return inset;
  };
  const safe = safeInset();
  const desktop = window.innerWidth > 768;
  const navVisible = visible(nav);
  const fabVisible = visible(fab);
  const out = {
    ok: true,
    desktop,
    nav: null,
    fab: null,
    items: [],
    labels: [],
    active: [],
    clearance: null,
    checks: []
  };
  const add = (name, ok, detail) => {
    out.checks.push({ name, ok: !!ok, detail });
    if (!ok) out.ok = false;
  };
  if (desktop) {
    add('desktop bottom nav is not rendered', !navVisible,
      nav ? { display: getComputedStyle(nav).display, rect: nav.getBoundingClientRect().toJSON() } : { missing: true });
    add('desktop FAB is not rendered', !fabVisible,
      fab ? { display: getComputedStyle(fab).display, rect: fab.getBoundingClientRect().toJSON() } : { missing: true });
    return out;
  }

  const navRect = nav && nav.getBoundingClientRect();
  out.nav = nav ? {
    visible: navVisible,
    position: getComputedStyle(nav).position,
    rect: { left: navRect.left, top: navRect.top, right: navRect.right, bottom: navRect.bottom,
      width: navRect.width, height: navRect.height },
    safeInset: safe,
    classHasFab: nav.classList.contains('bn-has-fab')
  } : null;
  add('bottom nav exists, is fixed, and is at least 60px tall',
    !!nav && navVisible && getComputedStyle(nav).position === 'fixed'
      && navRect.height >= 60 - EPS && navRect.left <= T && navRect.right >= window.innerWidth - T
      && navRect.bottom >= window.innerHeight - T && navRect.bottom <= window.innerHeight + T,
    out.nav || { missing: true });

  const items = nav ? [...nav.querySelectorAll('.bn-item')] : [];
  out.items = items.map((el) => {
    const r = el.getBoundingClientRect();
    return { label: (el.querySelector('.bn-label')?.textContent || '').trim(),
      width: r.width, height: r.height, left: r.left, top: r.top };
  });
  add('bottom-nav item count matches expected variant',
    !!nav && items.length === E.itemCount, { expected: E.itemCount, actual: items.length, items: out.items });
  add('every bottom-nav item is at least 44x44px',
    items.length === E.itemCount && items.every((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 44 - EPS && r.height >= 44 - EPS;
    }), out.items);

  const labelDetails = items.map((item) => {
    const label = item.querySelector('.bn-label');
    const ir = item.getBoundingClientRect();
    if (!label) return { label: '', ok: false, missing: true };
    const lr = label.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(label);
    const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    return {
      label: label.textContent.trim(), lines: lines.length, scrollWidth: label.scrollWidth,
      clientWidth: label.clientWidth, itemWidth: ir.width,
      leftOverflow: Math.max(0, ir.left - lr.left),
      rightOverflow: Math.max(0, lr.right - ir.right),
      ok: lines.length === 1 && label.scrollWidth <= label.clientWidth + T
        && lr.left >= ir.left - T && lr.right <= ir.right + T
    };
  });
  out.labels = labelDetails;
  add('bottom-nav labels stay on one line inside their item boxes',
    items.length === E.itemCount && labelDetails.length === items.length && labelDetails.every((d) => d.ok),
    labelDetails);

  const active = nav ? [...nav.querySelectorAll('.bn-item.bn-active')] : [];
  out.active = active.map((el) => ({
    key: el.getAttribute('data-nav-key') || null, label: (el.querySelector('.bn-label')?.textContent || '').trim()
  }));
  add('bottom-nav active-item count matches page mapping',
    active.length === E.activeCount
      && (!E.activeLabel || (active.length === 1 && out.active[0].label === E.activeLabel)),
    { expected: E.activeCount, expectedLabel: E.activeLabel || null, actual: active.length, active: out.active });
  add('FAB class is present only for FAB variants',
    !!nav && nav.classList.contains('bn-has-fab') === !!E.fab,
    nav ? { expected: !!E.fab, actual: nav.classList.contains('bn-has-fab') } : { missing: true });

  const expectedFabTop = window.innerHeight - (60 + 12 + 52 + safe);
  const expectedBarTop = window.innerHeight - (60 + safe);
  const fabRect = fab && fab.getBoundingClientRect();
  out.fab = fab ? {
    visible: fabVisible,
    rect: fabRect ? { left: fabRect.left, top: fabRect.top, right: fabRect.right, bottom: fabRect.bottom,
      width: fabRect.width, height: fabRect.height } : null
  } : null;
  if (E.fab) {
    add('FAB exists, is at least 48x48px, and is fully inside the viewport',
      !!fab && fabVisible && fabRect.width >= 48 - EPS && fabRect.height >= 48 - EPS
        && fabRect.left >= -T && fabRect.right <= window.innerWidth + T
        && fabRect.top >= -T && fabRect.bottom <= window.innerHeight + T,
      out.fab || { missing: true });
    add('FAB does not overlap the bottom-nav box',
      !!fab && !!nav && fabRect.bottom <= navRect.top + T,
      fab && nav ? { fabBottom: fabRect.bottom, navTop: navRect.top } : { fab: !!fab, nav: !!nav });
  } else {
    add('no-FAB page has no FAB element in the DOM', !fab,
      fab ? { display: getComputedStyle(fab).display, rect: fabRect.toJSON() } : { missing: true });
  }

  // The main content may scroll in the document or in the club-member shell's
  // .main scrollport. Move every real scrollport to its maximum before finding
  // the final visible content. This avoids a top-of-page padding check.
  window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
  const scrollports = [document.scrollingElement, ...document.querySelectorAll('.main')]
    .filter((el, i, all) => el && all.indexOf(el) === i && el.scrollHeight > el.clientHeight + T);
  for (const scrollport of scrollports) {
    if (scrollport === document.scrollingElement) window.scrollTo(0, scrollport.scrollHeight - window.innerHeight);
    else scrollport.scrollTop = scrollport.scrollHeight - scrollport.clientHeight;
  }
  const main = document.querySelector('.main');
  const hasHiddenAncestor = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (a.hidden || a.getAttribute('aria-hidden') === 'true' || s.display === 'none'
        || s.visibility === 'hidden' || s.opacity === '0') return true;
    }
    return false;
  };
  const clippedRect = (el) => {
    let r = el.getBoundingClientRect();
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/(hidden|auto|scroll|clip)/.test(s.overflow + s.overflowX + s.overflowY)) {
        const ar = a.getBoundingClientRect();
        r = { left: Math.max(r.left, ar.left), right: Math.min(r.right, ar.right),
          top: Math.max(r.top, ar.top), bottom: Math.min(r.bottom, ar.bottom) };
      }
      if (a === main) break;
    }
    return r;
  };
  const content = [];
  if (main) for (const el of main.querySelectorAll('*')) {
    if (hasHiddenAncestor(el) || el.matches('script,style,template,svg defs,*[aria-hidden="true"]')
      || el.closest('.bottom-nav,.bn-fab')) continue;
    let fixed = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      if (/(fixed|sticky)/.test(getComputedStyle(a).position)) { fixed = true; break; }
    }
    if (fixed) continue;
    const directText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const visualLeaf = /^(IMG|VIDEO|CANVAS|IFRAME|INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName);
    if (!directText && !visualLeaf) continue;
    const actual = el.getBoundingClientRect();
    const visibleRect = clippedRect(el);
    if (visibleRect.right - visibleRect.left <= 0 || visibleRect.bottom - visibleRect.top <= 0
      || visibleRect.bottom <= 0 || visibleRect.top >= window.innerHeight) continue;
    content.push({ el, actual, visibleRect, label: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
      ? '.' + el.className.split(' ')[0] : '') + ':' + (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60) });
  }
  const last = content.sort((a, b) => a.visibleRect.bottom - b.visibleRect.bottom).at(-1);
  const obstructionTop = E.fab
    ? (fabVisible && fabRect ? fabRect.top : expectedFabTop)
    : (navVisible && navRect ? navRect.top : expectedBarTop);
  const clearance = {
    // Use the actual element box for the obstruction comparison. The clipped
    // rectangle above only establishes that this element is visibly present;
    // comparing its clipped bottom would hide an element-box overflow defect.
    ok: !!last && last.actual.bottom <= obstructionTop + T,
    contentBottom: last ? last.actual.bottom : null,
    visibleContentBottom: last ? last.visibleRect.bottom : null,
    obstructionTop,
    gap: last ? obstructionTop - last.actual.bottom : null,
    source: E.fab && !fabVisible ? 'expected-fab-position-baseline' : (E.fab ? 'rendered-fab' : 'rendered-bar'),
    lastContent: last ? last.label : null,
    scrollY: window.scrollY,
    scrollports: scrollports.map((el) => ({ tag: el.tagName, className: el.className,
      scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
  };
  out.clearance = clearance;
  add('last visible content clears the fixed FAB/bar at maximum scroll', clearance.ok, clearance);
  return out;
})()`;
}

// Browser-side geometry audit. rootSel scopes the audit; ignoreOverlapSels is
// an array of CSS selectors for INTENTIONAL overlays (badges over avatars
// etc.) excluded from the text-overlap rule only — clipping still applies.
export function auditExpr(rootSel, ignoreOverlapSels = []) {
  return `(() => {
  const T = 1.5; // px tolerance for rounding/antialiasing
  window.scrollTo(0, 0); // prior hit-tests scroll the page; measure from the top
  const root = document.querySelector(${JSON.stringify(rootSel)});
  if (!root) return { missing: true };
  const IGNORE = ${JSON.stringify(ignoreOverlapSels)};
  const ignored = (el) => IGNORE.some((s) => el.closest(s));
  const out = { missing: false, clipped: [], overlaps: [], offscreenButtons: [] };
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const label = (el) => (el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ':' + (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 45));
  // 1. clipping: element vs nearest overflow-clipping ancestor. Scrollable
  // (auto/scroll) ancestors clip at their scrollWidth, not their box edge —
  // deliberate .table-scroll wrappers stay legal.
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    let a = el.parentElement;
    while (a && a !== document.body) {
      const s = getComputedStyle(a);
      if (/(hidden|auto|scroll|clip)/.test(s.overflow + s.overflowX)) {
        const ar = a.getBoundingClientRect();
        const scrollableX = /(auto|scroll)/.test(s.overflowX + s.overflow);
        const scrollableY = /(auto|scroll)/.test(s.overflowY + s.overflow);
        const clipR = scrollableX ? ar.left - a.scrollLeft + a.scrollWidth : ar.right;
        const clipB = scrollableY ? ar.top - a.scrollTop + a.scrollHeight : ar.bottom;
        if (r.right > clipR + T || r.left < ar.left - T
          || r.bottom > clipB + T || r.top < ar.top - T) out.clipped.push(label(el) + ' ⊄ ' + label(a));
        break;
      }
      a = a.parentElement;
    }
  }
  // 2. text-leaf overlap (ancestor/descendant pairs excluded). Elements inside
  // position:fixed overlays (bottom nav, toasts) are excluded: page content
  // legitimately scrolls beneath them — that is not a layout defect.
  // The walk stops at the audit ROOT: when the root itself is a fixed modal
  // overlay, its contents are real subject matter and must stay measured —
  // otherwise every modal audit would be structurally blind.
  const inFixed = (el) => { for (let a = el; a && a !== document.body && a !== root; a = a.parentElement)
    if (/(fixed|sticky)/.test(getComputedStyle(a).position)) return true; return false; };
  // Overlap must be judged on the VISIBLE portion of each text box: content
  // legitimately scrolled out of an inner overflow container (a 70vh modal
  // body, a max-height invite list) still has raw client rects that overlap
  // whatever sits below the container — a phantom overlap no user can see.
  // Intersect each rect with every overflow-clipping ancestor up to the
  // audit root; fully clipped leaves drop out. Genuinely visible overlaps
  // are unaffected (their rects are not clipped where they overlap).
  const clippedRects = (el) => {
    let rects = [...el.getClientRects()];
    for (let a = el.parentElement; a && a !== document.body && rects.length; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/(hidden|auto|scroll|clip)/.test(s.overflow + s.overflowX + s.overflowY)) {
        const ar = a.getBoundingClientRect();
        rects = rects
          .map((r) => ({ left: Math.max(r.left, ar.left), right: Math.min(r.right, ar.right),
            top: Math.max(r.top, ar.top), bottom: Math.min(r.bottom, ar.bottom) }))
          .filter((r) => r.right - r.left > 3 && r.bottom - r.top > 3);
      }
      if (a === root) break;
    }
    return rects;
  };
  const leaves = [...root.querySelectorAll('*')].filter((el) => vis(el) && !ignored(el) && !inFixed(el)
    && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const leafRects = leaves.map(clippedRects);
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i], b = leaves[j];
    if (a.contains(b) || b.contains(a)) continue;
    // Wrapped inline elements span multiple line boxes; their union bbox
    // falsely covers the whole paragraph. Compare individual client rects.
    const rectsA = leafRects[i], rectsB = leafRects[j];
    const real = rectsA.some((ra) => rectsB.some((rb) => {
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      return ox > 3 && oy > 3;
    }));
    if (real) out.overlaps.push(label(a) + ' ⇄ ' + label(b));
  }
  // 3. controls fully inside the viewport width and hit-testable at center.
  // Bottom-nav items and the FAB are fixed controls, not decorative chrome:
  // include them explicitly and do not skip them in the fixed-position escape.
  for (const b of root.querySelectorAll('button, a.btn, [role="button"], .bn-item, .bn-fab')) {
    if (!vis(b)) continue;
    // Buttons inside a horizontally scrollable ancestor (tab bars, pill rows)
    // are reachable by swiping — exempt from the in-viewport rule.
    let scrollable = false;
    for (let a = b.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/(auto|scroll)/.test(s.overflowX + s.overflow) && a.scrollWidth > a.clientWidth + T) { scrollable = true; break; }
    }
    const r = b.getBoundingClientRect();
    if (!scrollable && (r.right > window.innerWidth + T || r.left < -T)) { out.offscreenButtons.push(label(b)); continue; }
    if (inFixed(b) && !b.matches('.bn-item,.bn-fab')) continue; // fixed/sticky chrome is otherwise always reachable
    if (scrollable) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // Center vertically first so fixed overlays (bottom nav) can't shadow the
    // hit test — a real user scrolls the button into view before tapping.
    b.scrollIntoView({ block: 'center' });
    const r2 = b.getBoundingClientRect();
    const cx = r2.left + r2.width / 2, cy = r2.top + r2.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    if (!(hit && (hit === b || b.contains(hit) || hit.contains(b)))) out.offscreenButtons.push('not-hit-testable ' + label(b) + (hit ? ' hit=' + label(hit) : ''));
  }
  return out;
})()`;
}

// Surface density report: each surface must actually render content or the
// page counts as UNMEASURED for that surface (empty states cannot overflow).
export function surfacesExpr(surfaces) {
  return `(${JSON.stringify(surfaces)}).map((s) => {
    const el = document.querySelector(s.sel);
    const n = el ? [...el.children].filter((c) => c.getBoundingClientRect().height > 0).length : -1;
    return { name: s.name, found: !!el, children: n, ok: !!el && n >= (s.min ?? 1) && n <= (s.max ?? Infinity) };
  })`;
}

// Runs one page config across all viewports on an authenticated context.
// cfg: { name, path, waitFor, root, ignoreOverlap?, surfaces?, checks?,
//        bottomNav?, steps? }
// steps: [{ name, js, waitFor? }] — extra states (tab clicks) audited after
// the initial one. `checks` are page-specific browser expressions returning
// either true or { ok, ...detail }; they supplement the generic geometry audit.
// Returns { results: [{tag, audit}], surfaceReport, checksReport, errors }.
export async function auditPage(context, base, cfg) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const results = [];
  const surfaceReport = []; // measured at EVERY viewport — a surface that
  const checksReport = [];
  // renders at 360px but collapses empty at 414px must not pass unnoticed.
  // GEO_WIDTHS=mobile|desktop splits the run in half (the full 6-width run
  // exceeds a 5-minute shell window; background runs have been killed
  // mid-run). Default: all six widths.
  const widths = process.env.GEO_WIDTHS === 'mobile' ? VIEWPORTS
    : process.env.GEO_WIDTHS === 'desktop' ? DESKTOP_VIEWPORTS
    : /^[\d,]+$/.test(process.env.GEO_WIDTHS || '') ? process.env.GEO_WIDTHS.split(',').map(Number)
    : [...VIEWPORTS, ...DESKTOP_VIEWPORTS];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: w > 768 ? 900 : 840 });
    await page.goto(base + cfg.path, { waitUntil: 'networkidle' });
    if (cfg.waitFor) await page.waitForSelector(cfg.waitFor, { timeout: 20000 });
    // Surfaces flagged mobileOnly encode mobile-only contracts (e.g. the
    // rails collapse to exactly 1 card on phones but hold many cards on
    // desktop) — skip them above 768px.
    const applicable = (list) => (list || []).filter((s) => !(w > 768 && s.mobileOnly));
    if (cfg.surfaces) surfaceReport.push(...(await page.evaluate(surfacesExpr(applicable(cfg.surfaces)))).map((s) => ({ ...s, name: s.name + '@' + w + 'px' })));
    for (const custom of (cfg.checks || []).filter((c) => !(w > 768 && c.mobileOnly) && !(w <= 768 && c.desktopOnly))) {
      const detail = await page.evaluate(custom.js);
      checksReport.push({
        name: custom.name + '@' + w + 'px',
        ok: detail === true || !!(detail && detail.ok),
        detail
      });
    }
    results.push({ tag: `${cfg.name}@${w}px`,
      audit: await page.evaluate(auditExpr(cfg.root || '.main', cfg.ignoreOverlap)),
      bottomNav: cfg.bottomNav ? await page.evaluate(bottomNavExpr(cfg.bottomNav)) : null,
      hscroll: await page.evaluate('document.documentElement.scrollWidth - window.innerWidth') });
    for (const step of cfg.steps || []) {
      await page.evaluate(step.js);
      if (step.waitFor) await page.waitForSelector(step.waitFor, { timeout: 15000 });
      await page.waitForTimeout(250);
      if (step.surfaces && applicable(step.surfaces).length) {
        surfaceReport.push(...(await page.evaluate(surfacesExpr(applicable(step.surfaces)))).map((s) => ({ ...s, name: s.name + '@' + w + 'px' })));
      }
      results.push({ tag: `${cfg.name}:${step.name}@${w}px`, audit: await page.evaluate(auditExpr(step.root || cfg.root || '.main', cfg.ignoreOverlap)),
        hscroll: await page.evaluate('document.documentElement.scrollWidth - window.innerWidth') });
    }
  }
  await page.close();
  return { results, surfaceReport, checksReport, errors };
}
