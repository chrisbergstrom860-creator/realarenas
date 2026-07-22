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
4. **Test identities must be sweepable by pattern.** All seeded users use `@arenas-test.dev` emails ONLY (never gmail/example.com); fake Stripe ids contain `_dz_` or `_test`. This makes the domain sweep safe — the 13 real accounts are gmail/hotmail/sortlyapp.
5. **"Verified clean" means verified against the world, not the manifest:** final check must compare the full auth user list, subscriptions table, and storage listing — not just the tables the session touched.

**How to apply:** before ending any session that seeded users/clubs/subs/storage, run the sweep script dry-run and paste its CLEAN line into the report. Keep its USER_REFS list in sync when adding tables.
