'use strict';

const { dayKey, zoneMidnightUtc } = require('./tzdate');

// The auth lookup is deliberately a promise memo, rather than a memo of
// resolved users. Two independent enrichment stages can ask for the same id
// before either lookup has completed; caching the promise keeps that request
// to Auth to one call. A request's own user is seeded by the caller so the
// viewer is never looked up again.
function createRequestAuthMemo({ seedUser, lookup }) {
  const promises = new Map();
  if (seedUser && seedUser.id) promises.set(seedUser.id, Promise.resolve(seedUser));
  return {
    get(id) {
      if (!id) return Promise.resolve(null);
      if (!promises.has(id)) {
        promises.set(id, Promise.resolve()
          .then(() => lookup(id))
          .then((result) => {
            if (result && result.data && result.data.user) return result.data.user;
            return result && result.user ? result.user : null;
          }));
      }
      return promises.get(id);
    }
  };
}

// Challenge dates are persisted as UTC-midnight instants. The challenge window
// is inclusive, but for a participant it is that calendar date's midnight in
// the participant's zone. Keep this pure so the exact edge predicate can be
// tested without starting the server.
function challengeWindowFor(challenge, tz) {
  const startKey = dayKey(challenge.start_date, 'UTC');
  const endKey = dayKey(challenge.end_date, 'UTC');
  return {
    startMs: zoneMidnightUtc(startKey, tz).getTime(),
    endMs: zoneMidnightUtc(endKey, tz).getTime()
  };
}

function actsInChallengeWindow(activities, challenge, tz) {
  const window = challengeWindowFor(challenge, tz);
  return (activities || []).filter((activity) => {
    const at = new Date(activity.date).getTime();
    return at >= window.startMs && at <= window.endMs;
  });
}

// Widen the database read by one day on each side. The in-memory predicate
// above restores the exact participant-zone inclusive window.
function challengeFetchRange(challenge) {
  return {
    gteIso: new Date(new Date(challenge.start_date).getTime() - 86400000).toISOString(),
    lteIso: new Date(new Date(challenge.end_date).getTime() + 86400000).toISOString()
  };
}

// Apply both halves of the legacy per-challenge activity selection. The old
// route first used challengeFetchRange's inclusive database bounds and then
// applied the participant-zone inclusive window. The consolidated viewer read
// has no database date bound, so both predicates must be reproduced in memory.
function selectChallengeProgressActivities(activities, challenge, tz) {
  const range = challengeFetchRange(challenge);
  const gteMs = new Date(range.gteIso).getTime();
  const lteMs = new Date(range.lteIso).getTime();
  const padded = (activities || []).filter((activity) => {
    const at = new Date(activity.date).getTime();
    return at >= gteMs && at <= lteMs;
  });
  return actsInChallengeWindow(padded, challenge, tz);
}

// A transport failure in the consolidated viewer read must preserve the old
// per-challenge failure boundary. The old loop only queried activities after
// finding a joined challenge row; if no such row survived enrichment, the
// stats read was the only best-effort consumer.
function activityReadErrorForProgress(activityRead, joinedChallengeIds, challenges) {
  if (!activityRead || !activityRead.errorThrown) return null;
  const existingIds = new Set((challenges || []).map((challenge) => challenge.id));
  return (joinedChallengeIds || []).some((id) => existingIds.has(id))
    ? activityRead.errorThrown
    : null;
}

// Friends-in-challenges is kept as one reusable chain for the main challenges
// response and the lazy rail endpoint in the follow-up commit. The caller may
// supply the Stage-1 follows rows; when it does not, this helper performs that
// first read itself. All failures remain best-effort, matching the original
// route's empty rail fallback.
async function buildFriendsInChallengesRail({
  supabaseAdmin,
  userId,
  viewerTz,
  followingRows,
  readFollowing,
  buildUserProfileMap,
  identityMemo,
  memberZone,
  challengeHasEnded,
  challengeFetchRange: fetchRange,
  actsInChallengeWindow: selectWindow,
  computeChallengeProgress,
  fetchAllRows,
  logger = console
}) {
  let friendsInChallenges = [];
  let followsAnyone = false;
  try {
    const follows = followingRows !== undefined
      ? (followingRows || [])
      : await readFollowing();
    const followingIds = [...new Set((follows || [])
      .map((row) => row.following_id)
      .filter(Boolean))];
    followsAnyone = followingIds.length > 0;
    if (followingIds.length) {
      const { data: fParts } = await supabaseAdmin
        .from('challenge_participants').select('challenge_id, user_id')
        .in('user_id', followingIds);
      const fChallengeIds = [...new Set((fParts || [])
        .map((part) => part.challenge_id)
        .filter(Boolean))];
      if (fChallengeIds.length) {
        const { data: pubCh } = await supabaseAdmin
          // Completion is derived per participant below, so fetch the same
          // goal/window fields used by the challenges enrichment rather than
          // trusting a status column (there is no challenge status column).
          .from('challenges')
          .select('id, title, sport, goal_type, goal_target, goal_unit, start_date, end_date')
          .in('id', fChallengeIds).eq('visibility', 'public')
          .order('end_date', { ascending: false });
        // A friend's rail card is viewer-facing, so end-day semantics follow
        // the viewer's zone just like `isExpired` in the main enrichment.
        // Pre-start challenges remain active here too: that is the existing
        // challenges-page meaning of active (`!isExpired && !isComplete`).
        const activePublic = (pubCh || []).filter(
          (challenge) => !challengeHasEnded(challenge, viewerTz)
        );

        // Group participants by the already end-date-ordered challenge list,
        // not by fParts' database order. This preserves the displayed title
        // and moreCount ordering of the original rail.
        const partsByChallenge = {};
        const seenFriendPairs = new Set();
        (fParts || []).forEach((part) => {
          if (!part.challenge_id || !part.user_id) return;
          const pair = part.challenge_id + ':' + part.user_id;
          if (seenFriendPairs.has(pair)) return;
          seenFriendPairs.add(pair);
          (partsByChallenge[part.challenge_id] =
            partsByChallenge[part.challenge_id] || []).push(part.user_id);
        });

        const friendIdsByChallenge = {};
        const activeFriendIds = new Set();
        activePublic.forEach((challenge) => {
          const participantIds = [...new Set(partsByChallenge[challenge.id] || [])];
          if (!participantIds.length) return;
          friendIdsByChallenge[challenge.id] = participantIds;
          participantIds.forEach((id) => activeFriendIds.add(id));
        });

        // Pull the widest necessary activity interval once, then use the
        // canonical participant-zone window helper for each challenge.
        const activeFriendIdList = [...activeFriendIds];
        const fProfileMap = await buildUserProfileMap(activeFriendIdList, identityMemo);
        const actsByUser = {};
        if (activeFriendIdList.length) {
          const ranges = activePublic
            .filter((challenge) => friendIdsByChallenge[challenge.id])
            .map((challenge) => fetchRange(challenge));
          const gteIso = ranges.reduce(
            (earliest, range) => range.gteIso < earliest ? range.gteIso : earliest,
            ranges[0].gteIso
          );
          const lteIso = ranges.reduce(
            (latest, range) => range.lteIso > latest ? range.lteIso : latest,
            ranges[0].lteIso
          );
          // Use the shared paged reader: an active challenge can have more
          // than PostgREST's 1000-row default, and truncating here could
          // misclassify a participant who completed a goal in a later row.
          const fActs = await fetchAllRows(
            'activities',
            (q) => q
              .in('user_id', activeFriendIdList)
              .gte('date', gteIso)
              .lte('date', lteIso)
              .order('date', { ascending: true })
              .order('id', { ascending: true }),
            'user_id, distance, duration, sport, date'
          );
          // A failed activity lookup cannot prove that a participant has
          // not completed a goal. Fail closed for this best-effort card.
          (fActs || []).forEach((activity) => {
            (actsByUser[activity.user_id] = actsByUser[activity.user_id] || []).push(activity);
          });
        }

        const byUser = {};
        activePublic.forEach((challenge) => {
          const participantIds = friendIdsByChallenge[challenge.id] || [];
          const target = parseFloat(challenge.goal_target) || 0;
          participantIds.forEach((participantId) => {
            const participantTz = memberZone(fProfileMap[participantId]);
            const progress = computeChallengeProgress(
              challenge,
              selectWindow(actsByUser[participantId], challenge, participantTz),
              participantTz
            );
            // Completion is participant-specific: one friend can finish a
            // shared challenge while another remains active.
            if (target > 0 && progress >= target) return;
            (byUser[participantId] = byUser[participantId] || []).push(challenge);
          });
        });
        friendsInChallenges = Object.keys(byUser).map((uid) => ({
          id: uid,
          name: (fProfileMap[uid] || {}).name || 'Athlete',
          avatar_url: (fProfileMap[uid] || {}).avatar_url || null,
          profilePublic: fProfileMap[uid] ? fProfileMap[uid].profilePublic !== false : true,
          sport: byUser[uid][0].sport,
          challengeTitle: byUser[uid][0].title,
          moreCount: byUser[uid].length - 1
        })).slice(0, 6);
      }
    }
  } catch (err) {
    logger.log('Challenge friends error:', err.message);
  }
  return { friendsInChallenges, followsAnyone };
}

module.exports = {
  createRequestAuthMemo,
  challengeWindowFor,
  actsInChallengeWindow,
  challengeFetchRange,
  selectChallengeProgressActivities,
  activityReadErrorForProgress,
  buildFriendsInChallengesRail
};