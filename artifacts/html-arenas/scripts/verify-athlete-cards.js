// scripts/verify-athlete-cards.js — regression guard for the shared athlete-card
// layer (html/arenas-athlete-cards.js + adc- CSS), in the same spirit as
// verify-km-consistency.js. Locks in the lessons from the avatar-stretch
// regression:
//   1. No positional child selectors on .adc-head — the injected avatarHtml
//      wrapper is a direct child too, so `.adc-head>div{flex:1}` overrides the
//      fixed avatar box and stretches avatars wide. Structural nodes get
//      explicit classes instead (.adc-head-main).
//   2. Dormant profile-level controls, payloads, and display code stay removed.
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
const directory = R('html/arenas-athletes.html');
const publicProfile = R('html/arenas-athlete-profile.html');
const server = R('server.js');

const fails = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) fails.push(msg); };

ok(!/\.adc-head\s*>\s*div/.test(css),
  'arenas.css: positional selector ".adc-head>div" is back — it also catches the injected avatarHtml wrapper and stretches avatars; class the text block explicitly instead');
ok(/\.adc-head-main\s*\{/.test(css),
  'arenas.css: .adc-head-main rule missing (name/location block loses flex/ellipsis)');
ok(mod.includes('adc-head-main'),
  'arenas-athlete-cards.js: cardHTML no longer wraps the text block in .adc-head-main');
ok(!/Sports\s*&\s*level|Experience level|set-level/i.test(profile),
  'arenas-my-profile.html: dormant profile Experience level control or heading returned');
ok(/<div class="ss-title">Sports<\/div>[\s\S]*?<label class="form-label">Your sports<\/label>/.test(profile),
  'arenas-my-profile.html: single-field Sports settings section is missing');
ok(!/\ba\.level\b|levelLabel|adc-pill-(?:adv|muted)/.test(mod),
  'arenas-athlete-cards.js: dormant profile-level search or badge code returned');
ok(!/adc-pill-(?:adv|muted)/.test(css),
  'arenas.css: obsolete profile-level pill styling returned');
ok(!/\ba\.level\b|<div class="ml">Level<\/div>/.test(directory) && /\.modal-stats\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\)/.test(directory),
  'arenas-athletes.html: profile Level stat returned or modal is not a three-column layout');
ok(!/\ba\.level\b/.test(publicProfile),
  'arenas-athlete-profile.html: dormant profile-level hero tag returned');
ok(!/\b(?:meta|m)\.level\b/.test(server),
  'server.js: dormant profile-level metadata reader returned');
ok(/min-width:\s*769px/.test(profile),
  'arenas-my-profile.html: min-width:769px media rule missing (mobile-only tab items no longer hidden on desktop)');
ok(/#htab-athletes\s*,\s*#htab-challenges\s*\{\s*display:\s*none/.test(profile),
  'arenas-my-profile.html: mobile-only rule must hide BOTH #htab-athletes and #htab-challenges');
ok(profile.includes('id="htab-challenges"') && /htab-challenges"[^>]*onclick="nav\('\/challenges'\)"/.test(profile),
  "arenas-my-profile.html: Challenges nav-style tab item missing or no longer navigates via nav('/challenges')");
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
console.log(`verify-athlete-cards OK (${checks} checks)`);
