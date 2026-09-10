---
name: session cleanup — manifest-based test-data hygiene
description: Mandatory practice for any session that seeds data into the shared Supabase project; born from a seeded user surviving a "verified clean" report.
---

# Session cleanup practice (MANDATORY when seeding data)

## The incident (2026-07-22 audit)

The danger-zone session (2026-07-18) reported "all seeded data deleted, counts matched baseline" but left behind: a full auth user ("Sweep Photo", dz-sweep-…@arenas-test.dev) with profiles/achievements/notifications rows + a storage avatar, an orphaned avatar object for an already-deleted test user, and 3 subscription rows with fake `cus_dz_*` Stripe ids pointing at deleted clubs.

**Why it failed:** cleanup deleted from memory (the ids the session happened to be tracking) and verified counts only on the tables the seeder wrote. The Sweep Photo user was created mid-session outside the tracked seed list; its residue rows (profiles auto-insert, fire-and-forget achievement + notification) were server-side side effects the seeder never wrote, so "counts matched baseline" was true for the audited tables while auth users, subscriptions, and storage were never in the baseline at all.

## The rules

1. **Manifest at creation time, not memory at cleanup time.** Any script/session that creates data must append `{type, id}` to a manifest file (e.g. `/tmp/seed-manifest.json`) IMMEDIATELY after each create returns — including ad-hoc users created mid-session for one-off checks. Cleanup iterates the manifest (children first, auth user last) in a `finally`. If a run dies, the next run reads the leftover manifest first.
2. **Side effects are residue too.** Signup auto-creates a `profiles` row; server routes fire-and-forget `achievements` + `notifications`; account flows write `subscriptions`. Deleting "what I seeded" is not enough — delete by user id across ALL user-ref columns.
3. **Belt and suspenders: run the committed sweep.** `artifacts/html-arenas/scripts/test-data-sweep.js` (dry-run default, `--delete` to execute) scans auth users for test patterns, orphan rows in every table, fake-Stripe subscriptions, and orphaned avatars-bucket objects. Run it at session END after any seeding session; exit code 1 = residue found.
4. **Test identities must be sweepable by pattern.** All seeded users use `@arenas-test.dev` emails ONLY (never gmail/example.com); fake Stripe ids contain `_dz_` or `_test`. This makes the domain sweep safe — real accounts live on ordinary consumer/work domains (gmail/hotmail/yahoo/sortlyapp).
5. **The real-user count is live data, not a constant.** Real signups happen (first organic signup arrived 2026-08-11); never hardcode a baseline user count in scripts or treat a count delta alone as residue. "Clean" = zero test-pattern users + zero orphans per the sweep, whatever the total is.
6. **"Verified clean" means verified against the world, not the manifest:** final check must compare the full auth user list, subscriptions table, and storage listing — not just the tables the session touched.

**How to apply:** before ending any session that seeded users/clubs/subs/storage, run the sweep script dry-run and paste its CLEAN line into the report. Keep its USER_REFS list in sync when adding tables.

## Full-suite scheduling

Run the full `node --test` suite only after all fixture-using guards have finished and cleaned up.

**Why:** Node's test discovery also executes the standalone test-data sweep. A concurrent geometry or AI verifier run makes that sweep correctly flag active fixtures as residue, falsely suggesting a code regression.

**How to apply:** parallelize pure unit checks with seeded guards if useful, but reserve the full-suite run for after cleanup. Do not delete another running guard's fixtures to make the suite pass. Serialize separate seeded harnesses too: distinct test-user IDs do not isolate public listings. The Events geometry guard failed during concurrent AI fixture seeding and passed unchanged after those fixtures were removed.

## Isolation does not establish that a failure is harmless

A passing isolated rerun establishes fixture interaction, not that the original failure was a false alarm.

**Why:** public-event sentinel text reproduced real overflow that ordinary users could also enter. Element-box geometry checks additionally missed painted text extending outside its own box on desktop.

**How to apply:** investigate the triggering field/value before dismissing cross-fixture failures. For unbroken-text regressions, measure rendered text-line bounds as well as element boxes.
