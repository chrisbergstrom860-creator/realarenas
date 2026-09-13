#!/usr/bin/env node
/*
 * GET /api/challenges equivalence and query-profile gate.
 *
 * This script intentionally does not start or import server.js.  It extracts
 * the production GET callback with TypeScript's AST and evaluates it in a VM.
 * The OLD callback comes from git show REF:artifacts/html-arenas/server.js;
 * the NEW callback is the worktree server.js.
 *
 * Examples:
 *   node scripts/verify-challenges-equivalence.js
 *   node scripts/verify-challenges-equivalence.js --user-id UUID --runs=3
 *   node scripts/verify-challenges-equivalence.js --fixture --runs=3
 *   node scripts/verify-challenges-equivalence.js --fixture --mode=primary-vs-rail
 */

'use strict';

const {
  ROUTES,
  sourceAtRef,
  makeReadOnlyClient,
  makeHandler,
  invoke,
  compareResponses,
  metricLines,
  canonicalize,
  startMobileFixture,
  runOfflineSelfTest
} = require('./lib/challenges-equivalence.js');

const FOUNDER_ID = '4e3cd18f-2c09-4ce9-ada1-67fbe725fcd4';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REMOVED_RAIL_KEYS = ['friendsInChallenges', 'followsAnyone'];

function usage(message) {
  if (message) console.error(message);
  console.error([
    'Usage: node scripts/verify-challenges-equivalence.js [options]',
    '',
    '  --user-id UUID       account to verify; repeatable (default: founder)',
    '  --old-ref REF        git ref containing the old server (default: HEAD)',
    '  --runs=N             same-process timing samples after one gate (default: 1)',
    '  --fixture             seed the populated mobile-geometry fixture',
    '  --self-test           offline old-ref/worktree helper resolver test',
    '  --mode=primary        compare GET /api/challenges (default)',
    '  --mode=primary-vs-rail',
    '                       also compare removed main keys with the new rail',
    '  --frozen-at ISO       request timestamp (default: one frozen timestamp)',
    '  --keep                leave geometry fixtures in place for debugging',
  ].join('\n'));
}

function parseArgs(argv) {
  const args = {
    oldRef: 'HEAD',
    runs: 1,
    userIds: [],
    fixture: false,
    mode: 'primary',
    frozenAt: null,
    keep: false,
    selfTest: false,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--fixture') {
      args.fixture = true;
      continue;
    }
    if (arg === '--keep') {
      args.keep = true;
      continue;
    }
    if (arg === '--self-test') {
      args.selfTest = true;
      continue;
    }
    if (arg === '--user-id' || arg === '--old-ref' || arg === '--runs' ||
        arg === '--mode' || arg === '--frozen-at') {
      const key = arg.slice(2).replaceAll('-', '');
      if (i + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      arg = `${arg}=${argv[++i]}`;
      if (key === 'userid') args.userIds.push(argv[i]);
      else if (key === 'oldref') args.oldRef = argv[i];
      else if (key === 'runs') args.runs = Number(argv[i]);
      else if (key === 'mode') args.mode = argv[i];
      else if (key === 'frozenat') args.frozenAt = argv[i];
      continue;
    }
    if (arg.startsWith('--user-id=')) args.userIds.push(arg.slice('--user-id='.length));
    else if (arg.startsWith('--old-ref=')) args.oldRef = arg.slice('--old-ref='.length);
    else if (arg.startsWith('--runs=')) args.runs = Number(arg.slice('--runs='.length));
    else if (arg.startsWith('--mode=')) args.mode = arg.slice('--mode='.length);
    else if (arg.startsWith('--frozen-at=')) args.frozenAt = arg.slice('--frozen-at='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.help) return args;
  if (!Number.isInteger(args.runs) || args.runs < 1 || args.runs > 100) {
    throw new Error('--runs must be an integer from 1 to 100');
  }
  if (!['primary', 'primary-vs-rail', 'rail'].includes(args.mode)) {
    throw new Error('--mode must be primary, primary-vs-rail, or rail');
  }
  for (const userId of args.userIds) {
    if (!UUID_RE.test(userId)) throw new Error('--user-id must be a UUID');
  }
  if (args.frozenAt && !Number.isFinite(new Date(args.frozenAt).getTime())) {
    throw new Error('--frozen-at must be an ISO timestamp');
  }
  return args;
}

function accountLabel(index, isFixture) {
  if (isFixture) return index === 0 ? 'founder' : 'fixture-creator';
  return index === 0 ? 'founder' : `account-${index + 1}`;
}

function removeKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = { ...value };
  REMOVED_RAIL_KEYS.forEach((key) => delete result[key]);
  return result;
}

function removedRailObject(value) {
  const result = {};
  for (const key of REMOVED_RAIL_KEYS) {
    if (value && Object.prototype.hasOwnProperty.call(value, key)) result[key] = value[key];
  }
  return result;
}

function missingRemovedKeys(value) {
  return REMOVED_RAIL_KEYS.filter((key) =>
    value && Object.prototype.hasOwnProperty.call(value, key));
}

function resultCounts(mainBody, railBody = mainBody) {
  const mine = Array.isArray(mainBody && mainBody.myChallenges)
    ? mainBody.myChallenges
    : [];
  const discover = Array.isArray(mainBody && mainBody.publicChallenges)
    ? mainBody.publicChallenges.length
    : 0;
  const friends = Array.isArray(mainBody && mainBody.friendsChallenges)
    ? mainBody.friendsChallenges.length
    : 0;
  const completed = mine.filter((challenge) =>
    challenge && (challenge.isExpired || challenge.isComplete)).length;
  const rail = Array.isArray(railBody && railBody.friendsInChallenges)
    ? railBody.friendsInChallenges.length
    : 0;
  const follows = railBody && railBody.followsAnyone ? 1 : 0;
  return {
    my: mine.length,
    discover,
    friends,
    completed,
    rail,
    follows
  };
}

function printResultCounts(label, response, railResponse) {
  const counts = resultCounts(
    response.body,
    railResponse ? railResponse.body : response.body
  );
  console.log([
    `result ${label}`,
    `my=${counts.my}`,
    `discover=${counts.discover}`,
    `friends=${counts.friends}`,
    `completed=${counts.completed}`,
    `rail=${counts.rail}`,
    `follows=${counts.follows}`
  ].join(' '));
}

async function fetchUser(client, userId) {
  const { data, error } = await client.auth.admin.getUserById(userId);
  if (error) throw new Error(`could not read account: ${error.message || String(error)}`);
  if (!data || !data.user) throw new Error('account was not found');
  return data.user;
}

async function verifyPrimary({
  oldHandler,
  newHandler,
  railHandler,
  user,
  metrics,
  label,
  run,
  mode,
  printProfile,
  emitIdentical = true,
  oldSourceMap,
  newSourceMap,
  railSourceMap
}) {
  const oldResponse = await invoke(oldHandler, user, metrics, ROUTES.primary, oldSourceMap);
  const newResponse = await invoke(newHandler, user, metrics, ROUTES.primary, newSourceMap);
  let railResponse = null;
  const primaryOld = mode !== 'primary'
    ? removeKeys(oldResponse.body)
    : oldResponse.body;
  const primaryComparison = compareResponses(
    { ...oldResponse, body: primaryOld },
    newResponse
  );
  if (!primaryComparison.ok) {
    throw new Error(`${label} primary mismatch: ${primaryComparison.reason}`);
  }
  if (mode !== 'primary') {
    if (missingRemovedKeys(newResponse.body).length) {
      throw new Error(`${label} new primary still contains removed rail keys`);
    }
    if (!railHandler) throw new Error('GET /api/challenges/friends-rail was not found');
    railResponse = await invoke(railHandler, user, metrics, ROUTES.rail, railSourceMap);
    const railComparison = compareResponses(
      { ...oldResponse, body: removedRailObject(oldResponse.body) },
      railResponse
    );
    if (!railComparison.ok) {
      throw new Error(`${label} rail mismatch: ${railComparison.reason}`);
    }
    // One canonical comparison is deliberately repeated here rather than
    // logging either JSON response.  It catches an endpoint returning the
    // right values under the wrong top-level shape.
    if (JSON.stringify(canonicalize(removedRailObject(oldResponse.body))) !==
        JSON.stringify(canonicalize(railResponse.body))) {
      throw new Error(`${label} rail shape mismatch`);
    }
  }
  if (emitIdentical) {
    console.log('identical');
    printResultCounts(label, newResponse, railResponse);
  }
  if (printProfile) {
    metricLines('old', label, run, oldResponse.metrics).forEach((line) => console.log(line));
    metricLines('new', label, run, newResponse.metrics).forEach((line) => console.log(line));
    if (mode !== 'primary') {
      // The rail has its own timing line.  It is intentionally labelled
      // separately from the primary critical-path count.
      metricLines('rail', label, run, railResponse.metrics)
        .forEach((line) => console.log(line));
    }
  }
  return { oldResponse, newResponse, railResponse };
}

async function runAccount({
  account,
  index,
  oldSource,
  newSource,
  user,
  frozenAt,
  args,
  readOnly
}) {
  const label = accountLabel(index, account.fixture);
  // The route handlers share this exact client object, not merely equivalent
  // client configuration.  The instrumentation therefore sees one database
  // timeline for old, new, and (when requested) rail.
  const oldHandlerResult = makeHandler({
    source: oldSource.source,
    sourceName: oldSource.name,
    route: ROUTES.primary,
    client: readOnly.client,
    frozenAt
  });
  const newHandlerResult = makeHandler({
    source: newSource.source,
    sourceName: newSource.name,
    route: ROUTES.primary,
    client: readOnly.client,
    frozenAt
  });
  let railHandler = null;
  if (args.mode === 'primary-vs-rail' || args.mode === 'rail') {
    railHandler = makeHandler({
      source: newSource.source,
      sourceName: newSource.name,
      route: ROUTES.rail,
      client: readOnly.client,
      frozenAt
    });
  }
  await verifyPrimary({
    oldHandler: oldHandlerResult.handler,
    newHandler: newHandlerResult.handler,
    railHandler: railHandler && railHandler.handler,
    user,
    metrics: readOnly.metrics,
    label,
    run: 0,
    mode: args.mode,
    printProfile: false,
    emitIdentical: true,
    oldSourceMap: oldHandlerResult.sourceMap,
    newSourceMap: newHandlerResult.sourceMap,
    railSourceMap: railHandler && railHandler.sourceMap
  });
  // Keep the equivalence gate to one call per account.  --runs controls the
  // same-process timing sample below; repeating the gate would make the
  // reported seed/founder request counts look like extra verification runs.
  for (let run = 1; run <= args.runs; run++) {
    await verifyPrimary({
      oldHandler: oldHandlerResult.handler,
      newHandler: newHandlerResult.handler,
      railHandler: railHandler && railHandler.handler,
      user,
      metrics: readOnly.metrics,
      label,
      run,
      mode: args.mode,
      printProfile: true,
      emitIdentical: false,
      oldSourceMap: oldHandlerResult.sourceMap,
      newSourceMap: newHandlerResult.sourceMap,
      railSourceMap: railHandler && railHandler.sourceMap
    });
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) {
      usage();
      return;
    }
    if (args.selfTest) {
      const result = runOfflineSelfTest(args.oldRef);
      console.log(
        `offline self-test: old-helper=${result.oldHelper} ` +
        `new-helper=${result.newHelper} recursive-old-helper=${result.recursiveOldHelper}`
      );
      return;
    }
  } catch (error) {
    usage(error.message);
    process.exitCode = 2;
    return;
  }
  let fixture = null;
  try {
    if (args.fixture) {
      fixture = await startMobileFixture();
      if (!args.userIds.length) args.userIds.push(FOUNDER_ID);
      args.userIds.push(fixture.creatorId);
    } else if (!args.userIds.length) {
      args.userIds.push(FOUNDER_ID);
    }
    const oldSource = sourceAtRef(args.oldRef);
    const newSource = sourceAtRef('WORKTREE');
    const frozenAt = args.frozenAt || new Date().toISOString();
    const readOnly = makeReadOnlyClient({
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
      sourceName: newSource.name
    });
    for (let index = 0; index < args.userIds.length; index++) {
      const user = await fetchUser(readOnly.client, args.userIds[index]);
      await runAccount({
        account: { fixture: args.fixture && index === args.userIds.length - 1 },
        index,
        oldSource,
        newSource,
        user,
        frozenAt,
        args,
        readOnly
      });
    }
  } catch (error) {
    // Error messages contain no response bodies, query URLs, auth tokens, or
    // user IDs.  They remain actionable without becoming a data dump.
    console.error(`equivalence failed: ${error.message || String(error)}`);
    process.exitCode = 1;
  } finally {
    if (fixture && !args.keep) {
      try {
        await fixture.cleanup();
        console.log('fixture cleanup: complete');
      } catch (error) {
        console.error(`fixture cleanup failed: ${error.message || String(error)}`);
        process.exitCode = 1;
      }
    } else if (fixture) {
      console.log('fixture cleanup: skipped (--keep)');
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`equivalence failed: ${error.message || String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  FOUNDER_ID,
  REMOVED_RAIL_KEYS,
  parseArgs,
  removeKeys,
  removedRailObject,
  missingRemovedKeys,
  resultCounts
};