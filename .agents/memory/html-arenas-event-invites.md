---
name: html-arenas event invites (invite-only events)
description: The single event access rule (canUserSeeEvent), event_invites table semantics, zero-leak standard, and dual-mode invite form.
---

# Invite-only events

- `event_invites` is a USER-RUN table (like challenge_invites/achievements): PK (event_id, invitee_id), inviter_id, FK cascade to events, invitee_id index, RLS on / no policies (service-role only). Degrade closed if missing.
- **THE access rule** lives in server.js `canUserSeeEvent` / `visibleEventsFilter` (batched) / `getVisibleEvent` (single, returns null for BOTH missing and denied): public → anyone; club_id set → club members (club scope WINS over visibility — user-approved semantics; private implies no club_id at creation, enum-validated, legacy combos normalized via SQL); private → creator ∨ invite row. **Deliberately no RSVP-as-access clause** — a gate-bypassing RSVP row must not grant visibility.
- **Why:** pre-2026-07, "visibility" was only a listing filter expressed as per-route query shapes; the RSVP route had no check at all and the calendar/list RSVP-join branches resurfaced any RSVP'd event.
- **How to apply:** any new route reading events must call the helper (or be a provable subset: membership-gated club surfaces already equal the club rule — don't "fix" them as leaks). Zero-leak standard: denied and nonexistent answer byte-identical `{error:'Event not found'}` (RSVP included — no invite_required variant, unlike challenge join).
- Pending = shared `pendingInvites(rows, acceptedPairs, idField)` — generalized with idField default 'challenge_id' (challenge call sites untouched, suites proven before/after); events pass 'event_id' + non-cancelled RSVP pairs. Rows RETAINED on accept; cancelling an RSVP returns invitee to pending; revoke refuses on non-cancelled RSVP (`already_joined`).
- Private going-RSVP follower fan-out is restricted to invitees (title must not reach non-invitee followers). Feed collector, calendar extras, dashboard upcoming-RSVPs, list RSVP-join branch all run visibleEventsFilter.
- Create form invite list is DUAL-MODE: public/club = heads-up notification only (no rows); private = the access list (rows first, notify only inserted). Labels swap on visibility change, selections preserved.
- Verification: `scripts/verify-event-invites.js` (seeded byte-diff leak sweep; self-cleaning). Account delete sweeps invitee-side rows; creator-side dies via FK cascade.
