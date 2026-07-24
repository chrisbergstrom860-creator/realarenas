// scripts/verify-athlete-cards.js — regression guard for the shared athlete-card
// layer (html/arenas-athlete-cards.js + adc- CSS), in the same spirit as
// verify-km-consistency.js. Locks in the lessons from the avatar-stretch
// regression:
//   1. No positional child selectors on .adc-head — the injected avatarHtml
//      wrapper is a direct child too, so `.adc-head>div{flex:1}` overrides the
//      fixed avatar box and stretches avatars wide. Structural nodes get
//      explicit classes instead (.adc-head-main).
//   2. The gold "advanced" level pill exists and its check is case-insensitive.
//   3. The profile Athletes tab stays mobile-only, with its desktop deep-link
//      redirect to /athletes.
//   4. No dev-harness leftovers ship in server.js or public/.
const fs = require('fs');
const path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// Strip CSS comments before testing — the fix's in-place explanatory comment
// deliberately cites the old ".adc-head>div" selector; only real rules count.
const css = R('html/arenas.css').replace(/\/\*[\s\S]*?\*\//g, '');
const mod = R('html/arenas-athlete-cards.js');
const profile = R('html/arenas-my-profile.html');
const server = R('server.js');

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

ok(!/\.adc-head\s*>\s*div/.test(css),
  'arenas.css: positional selector ".adc-head>div" is back — it also catches the injected avatarHtml wrapper and stretches avatars; class the text block explicitly instead');
ok(/\.adc-head-main\s*\{/.test(css),
  'arenas.css: .adc-head-main rule missing (name/location block loses flex/ellipsis)');
ok(/\.adc-pill-adv\s*\{/.test(css),
  'arenas.css: .adc-pill-adv (gold advanced pill) rule missing');
ok(mod.includes('adc-head-main'),
  'arenas-athlete-cards.js: cardHTML no longer wraps the text block in .adc-head-main');
ok(/toLowerCase\(\)\s*===\s*'advanced'/.test(mod),
  "arenas-athlete-cards.js: advanced-pill check must be case-insensitive (String(a.level||'').toLowerCase())");
ok(/min-width:\s*769px/.test(profile),
  'arenas-my-profile.html: min-width:769px media rule missing (Athletes tab no longer hidden on desktop)');
ok(/#htab-athletes\s*\{\s*display:\s*none/.test(profile),
  'arenas-my-profile.html: #htab-athletes display:none rule missing');
ok(profile.includes('location.replace'),
  'arenas-my-profile.html: desktop #athletes deep-link redirect (location.replace) missing');
ok(!server.includes('dev-avatar-harness'),
  'server.js: dev-avatar-harness leftovers present');
ok(!fs.existsSync(path.join(__dirname, '..', 'public', 'dev-avatar-harness.html')),
  'public/dev-avatar-harness.html: temp harness file still exists');

if (fails.length) {
  console.error('verify-athlete-cards FAILED:');
  for (const f of fails) console.error(' - ' + f);
  process.exit(1);
}
console.log('verify-athlete-cards OK (10 checks)');
