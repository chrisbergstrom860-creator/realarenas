#!/usr/bin/env node
'use strict';
// Read-only founder proof: no server, fixtures, provider calls or data writes.
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { load } = require('./lib/goal-data-proof.cjs');
const oldRef = process.argv[2] || '75e3b55';
const frozenAt = '2026-10-03T19:00:00.000Z';
async function main() {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.admin.getUserById('4e3cd18f-2c09-4ce9-ada1-67fbe725fcd4');
  if (error || !data.user) throw error || Error('Founder not found');
  const before = load(db, frozenAt, oldRef), after = load(db, frozenAt);
  const [a, b] = await Promise.all([before.invoke('/api/goals', data.user), after.invoke('/api/goals', data.user)]);
  const strip = goal => {
    const { expectedProgress, targetKm, progressKm, expectedKm, ...original } = goal;
    return original;
  };
  assert.deepEqual({ active: b.active.map(strip), archived: b.archived.map(strip) }, a);
  const [s1, s2] = await Promise.all([before.invoke('/api/profile/stats', data.user), after.invoke('/api/profile/stats', data.user)]);
  const { weekStrip, ...oldShape } = s2;
  assert.deepEqual(oldShape, s1);
  console.log(`PASS founder frozen=${frozenAt}: all existing Goals fields identical (${a.active.length} active/${a.archived.length} archived); Stats fields and streaks identical; strip=${weekStrip.length}`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });