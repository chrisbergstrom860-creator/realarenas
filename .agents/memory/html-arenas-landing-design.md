---
name: html-arenas landing race-timing design direction
description: Approved visual tokens for the landing page "race timing / broadcast telemetry" pass, incl. user-calibrated lane-line contrast
---

Approved direction tokens (user-calibrated 2026-07-15):
- Headings (hero-h1, .section-title, .cta-band h2): Source Sans 3 **800 italic**, letter-spacing -0.03em (hero) / -0.02em (sections); fonts link must load `ital,wght@0,300..800;1,300..800`.
- Hero em highlight: `::before` skew(-8deg) yellow #FFD21E bar, inset 3px -2px 5px, radius 3px, z-index -1 under a z-index:0 h1.
- Stats band: carbon #111827; values #FFD21E mono tabular-nums; labels 11px mono uppercase ls .14em #94A3B8 (AA: 12.24:1 / 6.92:1).
- CTA glyphs: trailing "▸", back "◂" (sanctioned copy exception).
- One motion moment only: 900ms eased count-up, IntersectionObserver .4, reduced-motion bails, HTML keeps finals.

**Lane-line calibration (user corrected this once — don't regress):**
- Lines are a BACKGROUND layer (absolutely positioned pseudo-element, inset 0, z-index -1, zero height added) — never in-flow rules between content blocks.
- Contrast whisper-faint: **#EFEFEA on white hero**, **#1D2736 on #111827 band** ("visible on second look, invisible on a squint"; if in doubt, lighter).
- 3–4 lines evenly spaced across full height (20/40/60/80%) — NOT one per content gap, and none near the bottom edge where it reads as a section divider.
- **Why:** first attempt used rgba(17,24,39,0.05) at gap-aligned positions (22/42/62/82%) and the user read it as "prominent rules slicing the hero into stacked slices".
