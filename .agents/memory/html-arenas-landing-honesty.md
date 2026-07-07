---
name: html-arenas landing honesty
description: Pre-launch trust constraints for the marketing/landing copy — no fabricated traction or testimonials; honest sport-breadth framing.
---

# html-arenas landing-page honesty

**Rule:** html-arenas is PRE-LAUNCH with no real users. The landing/marketing/auth
copy (`html/arenas-landing-login.html`) must contain NO traction numbers (athlete /
activity / event counts, "joined this week", growth deltas) and NO named
testimonials / endorsements. Illustrative sample cards are fine, but never framed as
*live* or *real* data.

**Why:** fake traction and fake endorsements are the fabrications that genuinely
damage trust for a product with zero users.

**How to apply:** when auditing/editing this page, fabrications cluster in MANY spots
beyond the obvious stats band — hero eyebrow, hero social-proof row, hero right-panel
"live" badge, the stats band, feature-card body copy, the activity preview-strip "live"
labels, the dark CTA band, the auth-screen subtitle, AND a separate auth-left-stats
panel. Reframe any "live feed" → "product preview"; keep sample cards but drop the
live/real framing (e.g. replace pulsing green dot with a neutral static one).

**Sport breadth (honest framing):** only 8 sports are first-class/scored
(`SPORT_POINTS` in server.js); any other sport still logs via a flat 20-pt fallback,
so **"Every sport"** is the honest *breadth* framing while **"8 sports supported"** is
the honest *hard number* — the two can coexist. The decorative 20-sport scroll strip
and the 12 signup sport-chips are aspirational, not a support claim.

## App-shell honesty (same rule)
Fabricated subscription-status UI was removed from all main-app pages: "· Pro" footer suffixes, "💳 Pro plan" nav items, "✦ Pro" hero tag, and the fake Plan/billing card on my-profile settings. Payments don't exist — never reintroduce Pro-status labels in the app shell. Pro mentions in /for-clubs, landing pricing marketing, and arenas-terms.html are honest future-tense copy and are intentionally kept.
Also removed from my-profile Clubs tab: fake Hackney club card + dead "Find clubs near you" search card (no club search/directory exists). Clubs tab markup starts empty (#clubs-list); JS renders real data.clubs or an invite-only empty state; subtitle links to BASE+/athletes.
