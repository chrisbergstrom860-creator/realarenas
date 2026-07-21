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

## AI-coaching claims (same rule)
AI coaching does not exist yet. Hero sub, how-it-works step 2, and the club-join perk list now describe real features (leaderboards, events/challenges, training load/streaks/PRs) with AI labeled "coming soon" where mentioned. STILL PRESENT-TENSE (flagged, not yet fixed): the "AI-powered coaching" feature card + "✦ AI Coach" badge, the stats-band "AI / Coaching on every activity" tile, and the auth-modal subtitle + "AI Coaching" stat on the same landing file. The hero/product-preview mockup cards with "AI analysed" badges are labeled product previews and are acceptable.

## /for-clubs honesty pass (same rule)
The clubs marketing page (`arenas-for-clubs.html`) got the full pass: no testimonials, no traction numbers, mock dashboard labeled "Product preview" with a generic club name, AI claims future-tense "coming soon", pricing is 2 real tiers (Starter free / Pro $29) — Elite deleted. The signup wizard is 4 steps (plan-selection AND Integrations steps deleted; DOM ids are 1,2,3,5 with WIZARD_STEPS = SESSION?[2,3,5]:[1,2,3,5]; chrome derives from stepPos(), but static eyebrows/dots/counter must be renumbered by hand). Review step shows "Free · founding period" note instead of an order summary, no trial language. Wizard invite rows are REAL (see html-arenas-invites.md). Don't reintroduce a plan step or fake tiers before payments exist.

## Strava / device-sync promise copy (same rule)
All promise-shaped sync copy ("Strava sync coming soon", "device sync", Connected-accounts coming-soon cards) was removed app-wide: my-profile Activities header + Settings card, landing feature card, signup step-3 panel (flow is now 2 steps — submit button lives in step-2 and needs explicit type="submit" because an inline script coerces untyped buttons to type=button), for-clubs wizard Integrations step, club-dashboard note, privacy parenthetical. **Rule:** competitor-COMPARISON mentions of Strava are fine (landing jabs, for-clubs comparison table, blog "apps like Strava", privacy's hedged "if we later integrate" example); anything reading as a product PROMISE is not — don't reintroduce sync promises until an integration actually ships. The deprecated React prototype (artifacts/arenas) still contains mock Strava features, deliberately untouched.

## App-shell honesty (same rule)
Fabricated subscription-status UI was removed from all main-app pages: "· Pro" footer suffixes, "💳 Pro plan" nav items, "✦ Pro" hero tag, and the fake Plan/billing card on my-profile settings. Payments don't exist — never reintroduce Pro-status labels in the app shell. Pro mentions in /for-clubs, landing pricing marketing, and arenas-terms.html are honest future-tense copy and are intentionally kept.
Also removed from my-profile Clubs tab: fake Hackney club card + dead "Find clubs near you" search card (no club search/directory exists). Clubs tab markup starts empty (#clubs-list); JS renders real data.clubs or an invite-only empty state; subtitle links to BASE+/athletes.
