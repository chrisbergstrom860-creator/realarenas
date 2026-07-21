---
name: html-arenas profile bio limit
description: 220-word bio limit rule (client/server parity), hero clamp treatment, and legacy 600-char truncation facts
---

# Bio limit — one counting rule, server is the boundary

**Rule:** bio limit is 220 WORDS (word = whitespace-separated token: trim, split on `/\s+/`, count non-empty tokens — empty → 0) plus a 2,000-char trimmed ceiling as a no-space-abuse backstop. Server (/api/profile/update) REJECTS with 400, never silently truncates. The Settings counter uses the byte-identical counting function; any new bio-editing surface must reuse this exact rule or client and server will disagree at the boundary.
**Why:** the old cap was `slice(0, 600)` — a silent char truncation that cut a real stored bio mid-word ("…embracing an activ"). Silent truncation destroyed user content invisibly.
**How to apply:** counter amber at 200–219, red at ≥220; save blocked client-side only when OVER 220 (exactly 220 saves). Existing over-limit/truncated bios are never touched — the limit applies at next save only. One legacy user still carries the 600-char truncated bio by design.

# Hero long-bio treatment

Hero clamps `.hero-bio` to 4 lines (`-webkit-line-clamp`, word-boundary ellipsis) with a Show more/less toggle that is a SIBLING of `.hero-bio` (setText textContent rewrites wipe children — same precedent as the hero badge slot) and only appears when a post-rAF `scrollHeight > clientHeight` check says the text actually overflows. Short/no-bio paths get unclamped + hidden button. A 220-word bio is ~25 lines in the hero — full display balloons it; the clamp is deliberate.

Other bio surfaces: athletes directory cards show NO bio on their face; the athlete modal shows the full bio (grows tall, unclipped). Following/Followers payloads carry bio but the cards don't render it.

Test gotcha: the athletes directory EXCLUDES the viewer — to probe another user's card/modal you must log in as a second account (clicking "your own name" on the page hits the sidebar footer, not a card).
