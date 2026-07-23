#!/usr/bin/env node
// Test-data residue sweep for the html-arenas Supabase project.
// Dry-run by default; pass --delete to actually remove confirmed residue.
//
// Detects:
//  1. Auth users with test-pattern emails (@arenas-test.dev etc.) — DELETED with --delete.
//     Test-pattern display NAMES are report-only (never deleted by name alone).
//  2. Rows in any table referencing user ids that no longer exist in auth
//  3. Subscriptions with fake Stripe ids (cus_dz_*, *_test, fake) or owners that no longer exist
//  4. Storage objects in the avatars bucket not owned by any live user or club
//
// Safety rails:
//  - Hard-aborts (exit 2, zero deletes) if the auth list looks truncated or implausibly small,
//    so a partial user list can never turn real users into "orphans".
//  - Every delete checks its error; any failure => reported + non-zero exit.
//  - A test user's club is only deleted if NO other user is a member; otherwise it is
//    reported and skipped (ownership must be transferred manually first).
//
// Usage (from artifacts/html-arenas):
//   node scripts/test-data-sweep.js            # report only
//   node scripts/test-data-sweep.js --delete   # delete confirmed residue

const { createClient } = require('@supabase/supabase-js');

const DELETE = process.argv.includes('--delete');
const TEST_EMAIL = /@arenas-test\.dev$|@example\.com$|@test\.arenas/i;
const TEST_NAME = /\b(sweep|seeded|tester|e2e)\b|^(qa|verify|tz|g2)-/i;
const FAKE_STRIPE = /_dz_|_test|^fake|^cus_fake|^sub_fake/i;
const MIN_PLAUSIBLE_USERS = 5; // refuse orphan/storage deletion below this

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// [table, column] pairs referencing auth user ids. Keep in sync with schema.
const USER_REFS = [
  ['activities', 'user_id'], ['posts', 'user_id'], ['post_likes', 'user_id'],
  ['activity_likes', 'user_id'],
  ['post_comments', 'user_id'], ['follows', 'follower_id'], ['follows', 'following_id'],
  ['memberships', 'user_id'], ['event_rsvps', 'user_id'],
  ['challenge_participants', 'user_id'], ['notifications', 'user_id'], ['notifications', 'actor_id'],
  ['goals', 'user_id'], ['achievements', 'user_id'], ['planned_sessions', 'user_id'],
  ['profiles', 'id'], ['events', 'created_by'], ['challenges', 'created_by'],
  ['club_invites', 'invited_by'],
];
// Tables without an `id` PK — deletions match on their composite ref columns only
// (never on full rows: null-valued columns would become eq.null and match nothing).
const COMPOSITE_KEYS = { follows: ['follower_id', 'following_id'], post_likes: ['post_id', 'user_id'], activity_likes: ['activity_id', 'user_id'] };

let failures = 0;
function checkErr(label, error) {
  if (error) {
    failures++;
    console.log(`  DELETE FAILED ${label}: ${error.message}`);
    return false;
  }
  return true;
}

async function fetchAll(table, cols) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function deleteUserRows(uid) {
  for (const [t, c] of USER_REFS) {
    const { count, error } = await admin.from(t).delete({ count: 'exact' }).eq(c, uid);
    if (checkErr(`${t}.${c}=${uid}`, error) && count) console.log(`  DELETED ${count} from ${t}.${c}`);
  }
}

async function deleteUserStorage(uid) {
  const { data: files } = await admin.storage.from('avatars').list('users/' + uid, { limit: 100 });
  if (files && files.length) {
    const { error } = await admin.storage.from('avatars').remove(files.map((f) => `users/${uid}/${f.name}`));
    if (checkErr(`storage users/${uid}`, error)) console.log(`  DELETED ${files.length} storage object(s)`);
  }
}

(async () => {
  let issues = 0;
  const act = DELETE ? 'DELETED' : 'WOULD DELETE';

  // --- live auth users (hard-abort on any sign of truncation) ---
  let users = [];
  let expectedTotal = null;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { console.error('ABORT: listUsers failed:', error.message); process.exit(2); }
    users.push(...data.users);
    if (typeof data.total === 'number') expectedTotal = data.total;
    if (data.users.length < 200) break;
    if (page > 100) { console.error('ABORT: listUsers pagination runaway'); process.exit(2); }
  }
  if (expectedTotal !== null && users.length !== expectedTotal) {
    console.error(`ABORT: auth list truncated (got ${users.length}, API reports total ${expectedTotal}). No deletions performed.`);
    process.exit(2);
  }
  if (users.length < MIN_PLAUSIBLE_USERS) {
    console.error(`ABORT: only ${users.length} auth users returned (< ${MIN_PLAUSIBLE_USERS}); refusing to treat anything as orphaned. No deletions performed.`);
    process.exit(2);
  }
  const valid = new Set(users.map((u) => u.id));
  console.log(`auth users: ${users.length}${expectedTotal !== null ? ` (matches API total ${expectedTotal})` : ''}`);

  // --- 1. test-pattern auth users ---
  for (const u of users) {
    const name = (u.user_metadata && u.user_metadata.name) || '';
    const emailMatch = TEST_EMAIL.test(u.email || '');
    const nameMatch = TEST_NAME.test(name);
    if (!emailMatch && !nameMatch) continue;
    issues++;
    if (!emailMatch) {
      // Name-only match: report, never auto-delete (display names are free text).
      console.log(`SUSPICIOUS NAME (report-only, not deleted): ${u.id} ${u.email} "${name}"`);
      continue;
    }
    console.log(`TEST USER: ${u.id} ${u.email} "${name}"`);
    if (!DELETE) continue;
    // Clubs owned by the test user: delete only if no other member, else skip + report.
    const { data: ownedClubs, error: ocErr } = await admin.from('clubs').select('id, name').eq('owner_id', u.id);
    if (!checkErr('clubs lookup', ocErr)) continue;
    for (const club of ownedClubs || []) {
      const { data: others, error: mErr } = await admin.from('memberships').select('user_id').eq('club_id', club.id).neq('user_id', u.id).limit(1);
      if (!checkErr('membership lookup', mErr)) continue;
      if (others && others.length) {
        failures++;
        console.log(`  SKIPPED club "${club.name}" (${club.id}): has other members — transfer ownership manually, auth user NOT deleted`);
        continue;
      }
      for (const [t, c] of [['memberships', 'club_id'], ['club_invites', 'club_id'], ['events', 'club_id'], ['challenges', 'club_id'], ['subscriptions', 'owner_id']]) {
        const { error } = await admin.from(t).delete().eq(c, club.id);
        checkErr(`${t} for club ${club.id}`, error);
      }
      const { data: logo } = await admin.storage.from('avatars').list('clubs/' + club.id, { limit: 100 });
      if (logo && logo.length) await admin.storage.from('avatars').remove(logo.map((f) => `clubs/${club.id}/${f.name}`));
      const { error: cErr } = await admin.from('clubs').delete().eq('id', club.id);
      if (checkErr(`club ${club.id}`, cErr)) console.log(`  DELETED empty test club "${club.name}"`);
    }
    // If a club was skipped, do not delete the user (it still owns a live club).
    const { data: stillOwns } = await admin.from('clubs').select('id').eq('owner_id', u.id).limit(1);
    if (stillOwns && stillOwns.length) continue;
    await deleteUserRows(u.id);
    await deleteUserStorage(u.id);
    const { error: auErr } = await admin.auth.admin.deleteUser(u.id);
    if (checkErr('auth user', auErr)) {
      valid.delete(u.id);
      console.log('  DELETED auth user');
    }
  }

  // --- 2. orphaned rows referencing dead users ---
  for (const [t, c] of USER_REFS) {
    const keyCols = COMPOSITE_KEYS[t] || ['id'];
    const selectCols = [...new Set([...keyCols, c])].join(',');
    const rows = await fetchAll(t, selectCols);
    const orph = rows.filter((r) => r[c] && !valid.has(r[c]));
    if (!orph.length) continue;
    issues += orph.length;
    console.log(`ORPHAN ROWS ${t}.${c}: ${orph.length}`);
    if (DELETE) {
      let ok = 0;
      for (const r of orph) {
        const match = {};
        for (const k of keyCols) match[k] = r[k];
        const { error } = await admin.from(t).delete().match(match);
        if (checkErr(`${t} ${JSON.stringify(match)}`, error)) ok++;
      }
      console.log(`  DELETED ${ok}/${orph.length}`);
    }
  }

  // --- 3. bad subscriptions (fake stripe ids or dead owners) ---
  const clubs = await fetchAll('clubs', 'id');
  const clubIds = new Set(clubs.map((c) => c.id));
  const subs = await fetchAll('subscriptions', 'id, owner_type, owner_id, stripe_customer_id, status');
  for (const s of subs) {
    const ownerOk = s.owner_type === 'club' ? clubIds.has(s.owner_id) : valid.has(s.owner_id);
    const fake = FAKE_STRIPE.test(s.stripe_customer_id || '');
    if (!fake && ownerOk) continue;
    issues++;
    console.log(`BAD SUBSCRIPTION ${s.id}: fakeStripe=${fake} ownerValid=${ownerOk} status=${s.status}`);
    if (DELETE) {
      const { error } = await admin.from('subscriptions').delete().eq('id', s.id);
      if (checkErr(`subscription ${s.id}`, error)) console.log('  DELETED');
    }
  }

  // --- 4. orphaned storage objects ---
  for (const folder of ['users', 'clubs']) {
    const { data: subdirs, error: lErr } = await admin.storage.from('avatars').list(folder, { limit: 1000 });
    if (lErr) { failures++; console.log(`LIST FAILED ${folder}: ${lErr.message}`); continue; }
    for (const d of subdirs || []) {
      const ok = folder === 'users' ? valid.has(d.name) : clubIds.has(d.name);
      if (ok) continue;
      const { data: files } = await admin.storage.from('avatars').list(`${folder}/${d.name}`, { limit: 100 });
      if (files && files.length) {
        issues += files.length;
        console.log(`ORPHAN STORAGE ${folder}/${d.name}: ${files.length} file(s)`);
        if (DELETE) {
          const { error } = await admin.storage.from('avatars').remove(files.map((f) => `${folder}/${d.name}/${f.name}`));
          if (checkErr(`storage ${folder}/${d.name}`, error)) console.log('  DELETED');
        }
      }
    }
  }

  if (failures) {
    console.log(`${failures} operation(s) FAILED or were SKIPPED — residue may remain. Re-run after fixing.`);
    process.exit(2);
  }
  console.log(issues === 0 ? 'CLEAN — no residue found' : `${issues} residue item(s) ${DELETE ? 'deleted' : `found (run with --delete to remove)`}`);
  process.exit(issues && !DELETE ? 1 : 0);
})().catch((e) => {
  console.error('sweep failed:', e.message);
  process.exit(2);
});
