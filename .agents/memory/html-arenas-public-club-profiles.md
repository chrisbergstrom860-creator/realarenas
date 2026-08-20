---
name: html-arenas public club profiles
description: Privacy and product boundaries for shareable club pages, banner delivery, and public website metadata.
---

Only publicly listed clubs may resolve on a shareable club profile. Private and nonexistent clubs must remain indistinguishable to anonymous and authenticated visitors, including through banner delivery.

**Why:** The public URL is a deliberate discovery surface, not a back door into private clubs. Session state must not weaken that boundary or reveal whether a private club exists.

**How to apply:** Keep the public profile payload purpose-built and minimal. Storage object paths are server-only; clients receive only a version token and fetch banners through a visibility-checking proxy. A separate manager-only proxy may serve dashboard previews for private clubs.

The shareable profile is informational and must never include a join or request action. Joining remains an explicit directory/invite flow.

**Why:** Public profiles are meant to be safely shareable without changing membership semantics.

**How to apply:** Club-card bodies may link to the shareable profile while existing request/member controls retain their own behavior. Optional websites must stay normalized HTTPS links rendered with defensive external-link attributes.