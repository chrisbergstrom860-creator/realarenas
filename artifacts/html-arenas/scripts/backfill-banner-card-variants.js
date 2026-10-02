#!/usr/bin/env node
'use strict';
const { createClient } = require('@supabase/supabase-js');
const { backfillBanner } = require('../profile-banner');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  console.log(apply ? 'APPLY banner card variants' : 'DRY RUN banner card variants (use --apply to write)');
  let processed = 0;
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    for (const user of data.users) {
      const result = await backfillBanner(db, user, apply);
      if (result) { console.log(JSON.stringify(result)); processed++; }
    }
    if (data.users.length < 100) break;
  }
  console.log(`Processed ${processed} banners`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };