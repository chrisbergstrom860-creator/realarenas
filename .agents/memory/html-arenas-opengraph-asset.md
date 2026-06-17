---
name: html-arenas opengraph.jpg recurring re-encode
description: Why public/opengraph.jpg shows up modified every session and why to ignore it.
---

# html-arenas public/opengraph.jpg churn

`artifacts/html-arenas/public/opengraph.jpg` shows up as a binary modification in
essentially every commit (40+ commits across totally unrelated tasks). It is NOT
the app doing it:

- **Zero references anywhere in tracked code** — grep for `opengraph` / `og:image`
  across the whole repo finds nothing; no HTML file links it.
- No `.gitattributes` / Git LFS / smudge filter; it is **not** gitignored.
- Always a valid **1280x720 baseline JPEG**; only the byte size changes,
  oscillating among a small recurring set of values (e.g. 82153, 82318, 82660,
  83374, 84364…) — i.e. visually identical, just re-encoded.
- html-arenas has no build/image step (`dev`/`start` = `node server.js`,
  `build` = echo); `server.js` writes no images.

**Conclusion:** an automated/external process re-encodes the file each session
(most consistent with a platform OpenGraph/preview-image generator or a
per-environment JPEG re-encode), producing a byte-different but visually
identical file. It is **harmless** — nothing in the app depends on it.

**How to handle:**
- Don't waste time diffing it (it's binary; there is no meaningful textual diff)
  and don't try to "fix" it in app code — there is nothing to fix there.
- It rides along in commits only because it isn't gitignored. When you push
  HEAD, it goes too.
- It cannot be cleanly excluded from a push once the checkpoint auto-commit has
  baked it into HEAD, because the main agent can't rewrite commits (no
  reset/restore/commit/amend). To exclude it you'd have to handle it BEFORE the
  auto-commit, or gitignore/remove the orphan asset — confirm with the user
  first, since it may be intended as the social-share card.
