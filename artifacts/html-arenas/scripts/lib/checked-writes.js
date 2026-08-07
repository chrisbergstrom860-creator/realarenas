// Shared checked-write helpers for verify/shot scripts — same reasoning as
// checkErr in test-data-sweep.js: supabase-js returns errors instead of
// throwing, so an unawaited-check write silently succeeds-or-not.
//
// mustWrite(label, query)  — for SEEDS and pre-cleanup. Throws on a returned
//   error: a test that proceeds on missing fixtures asserts against a state
//   it didn't create. Also accepts auth-admin calls (same { data, error }
//   shape). Returns .data for convenience.
//
// makeCleanup()            — for TEARDOWN. Returns { cw, failed }:
//   cw(label, query) logs `CLEANUP FAILED <label>: <msg>` and counts the
//   failure instead of throwing (later teardown steps must still run);
//   failed() reports whether any step failed so the script can exit non-zero
//   — residue from a silent teardown failure breaks subsequent runs.
export async function mustWrite(label, query) {
  const { data, error } = await query;
  if (error) throw new Error(label + ': ' + (error.message || String(error)));
  return data;
}

export function makeCleanup() {
  let failures = 0;
  return {
    async cw(label, query) {
      try {
        const { error } = await query;
        if (error) { failures++; console.error('CLEANUP FAILED ' + label + ':', error.message || String(error)); }
      } catch (e) {
        failures++;
        console.error('CLEANUP FAILED ' + label + ':', e.message);
      }
    },
    failed: () => failures > 0,
    count: () => failures
  };
}
