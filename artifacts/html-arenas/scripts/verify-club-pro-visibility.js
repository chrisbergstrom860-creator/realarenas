// Live test-mode verification for Club Pro visibility disclosures.
//
// Creates a real Stripe TEST subscription, then delivers signed webhook payloads
// to the running app and proves:
//   1. Upgrade disclosure reaches every current member except the initiator.
//   2. Replaying the completed-checkout webhook creates no duplicates.
//   3. A renewal-style active→active update creates no disclosure.
//   4. Scheduling cancellation creates no disclosure.
//   5. Actual subscription deletion notifies every current member once.
//   6. Replaying the deletion webhook creates no duplicates.
//
// Requires scripts/sql/club-pro-visibility-notifications.sql to have been run.
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-club-pro-visibility.js

const crypto = require('crypto');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const clubProPrice = process.env.STRIPE_PRICE_CLUB_PRO;

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else {
    failures++;
    console.log('FAIL  ' + name + (detail ? ' — ' + detail : ''));
  }
}

function signedEvent(type, object, previousAttributes, eventId) {
  const event = {
    id: eventId,
    object: 'event',
    api_version: null,
    created: Math.floor(Date.now() / 1000),
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type
  };
  if (previousAttributes) event.data.previous_attributes = previousAttributes;
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = crypto
    .createHmac('sha256', webhookSecret)
    .update(timestamp + '.' + body, 'utf8')
    .digest('hex');
  return { body, signature: `t=${timestamp},v1=${digest}` };
}

async function deliver(type, object, previousAttributes, eventId) {
  const signed = signedEvent(type, object, previousAttributes, eventId);
  const response = await fetch(BASE_URL + '/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signed.signature
    },
    body: signed.body
  });
  return { status: response.status, text: await response.text() };
}

async function notificationsFor(userIds, clubId) {
  const { data, error } = await admin
    .from('notifications')
    .select('user_id, type, title, body, link, entity_id, source_key')
    .in('user_id', userIds)
    .eq('entity_id', clubId)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

async function deleteUserByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of (data && data.users) || []) {
    if (user.email !== email) continue;
    await admin.from('notifications').delete().eq('user_id', user.id);
    await admin.from('memberships').delete().eq('user_id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  }
}

(async () => {
  if (!process.env.STRIPE_SECRET_KEY || !webhookSecret || !clubProPrice) {
    throw new Error('Stripe test configuration is incomplete');
  }
  check('Stripe key is test mode', process.env.STRIPE_SECRET_KEY.startsWith('sk_test_'));

  const nonce = Date.now().toString(36);
  const clubName = 'Club Pro Visibility Verify ' + nonce;
  const emails = {
    initiator: `club-pro-initiator-${nonce}@arenas-test.dev`,
    admin: `club-pro-admin-${nonce}@arenas-test.dev`,
    coach: `club-pro-coach-${nonce}@arenas-test.dev`,
    member: `club-pro-member-${nonce}@arenas-test.dev`
  };
  const users = {};
  let clubId = null;
  let customerId = null;
  const stripeSubIds = [];

  try {
    for (const [role, email] of Object.entries(emails)) {
      await deleteUserByEmail(email);
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: 'ClubProVisibility!12345',
        email_confirm: true,
        user_metadata: { name: 'Visibility ' + role, handle: 'vis-' + role + '-' + nonce }
      });
      if (error) throw error;
      users[role] = data.user.id;
    }

    const { data: club, error: clubErr } = await admin.from('clubs').insert({
      name: clubName,
      handle: 'club-pro-vis-' + nonce,
      sport: 'running',
      owner_id: users.initiator
    }).select('id').single();
    if (clubErr) throw clubErr;
    clubId = club.id;

    const { error: memberErr } = await admin.from('memberships').insert([
      { club_id: clubId, user_id: users.initiator, role: 'admin' },
      { club_id: clubId, user_id: users.admin, role: 'admin' },
      { club_id: clubId, user_id: users.coach, role: 'coach' },
      { club_id: clubId, user_id: users.member, role: 'member' }
    ]);
    if (memberErr) throw memberErr;

    const customer = await stripe.customers.create({
      email: emails.initiator,
      metadata: { verification: 'club_pro_visibility', club_id: clubId }
    });
    customerId = customer.id;
    const paymentMethod = await stripe.paymentMethods.attach('pm_card_visa', {
      customer: customer.id
    });
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethod.id }
    });
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: clubProPrice }],
      default_payment_method: paymentMethod.id,
      payment_behavior: 'error_if_incomplete',
      metadata: { owner_type: 'club', owner_id: clubId }
    });
    stripeSubIds.push(subscription.id);
    check('real test subscription is active', subscription.status === 'active', subscription.status);

    const session = {
      id: 'cs_test_visibility_' + nonce,
      object: 'checkout.session',
      mode: 'subscription',
      status: 'complete',
      payment_status: 'paid',
      subscription: subscription.id,
      metadata: {
        owner_type: 'club',
        owner_id: clubId,
        initiated_by: users.initiator,
        plan_before: 'free'
      },
      customer_details: null,
      customer_email: null
    };
    const upgradeEventId = 'evt_test_visibility_upgrade_' + nonce;
    const upgrade = await deliver('checkout.session.completed', session, null, upgradeEventId);
    check('upgrade webhook accepted', upgrade.status === 200, upgrade.status + ' ' + upgrade.text);

    const userIds = Object.values(users);
    let rows = await notificationsFor(userIds, clubId);
    const upgradeRows = rows.filter((row) => row.source_key === 'club-pro-upgrade:' + subscription.id);
    check('initiator receives no upgrade disclosure',
      !upgradeRows.some((row) => row.user_id === users.initiator));
    for (const role of ['admin', 'coach', 'member']) {
      check(role + ' receives one upgrade disclosure',
        upgradeRows.filter((row) => row.user_id === users[role]).length === 1);
    }
    check('upgrade disclosures use club type and Privacy anchor',
      upgradeRows.length === 3 && upgradeRows.every((row) =>
        row.type === 'club' &&
        row.link === '/privacy#club-manager-visibility' &&
        row.title === clubName + ' upgraded to Club Pro' &&
        row.body.includes('Club administrators and coaches can now see the activity you log while you are a member')));

    const retry = await deliver('checkout.session.completed', session, null, upgradeEventId);
    check('upgrade retry accepted', retry.status === 200, retry.status + ' ' + retry.text);
    rows = await notificationsFor(userIds, clubId);
    check('upgrade retry creates no duplicates',
      rows.filter((row) => row.source_key === 'club-pro-upgrade:' + subscription.id).length === 3);

    const renewalObject = await stripe.subscriptions.retrieve(subscription.id);
    const renewal = await deliver(
      'customer.subscription.updated',
      renewalObject,
      { current_period_end: renewalObject.current_period_start },
      'evt_test_visibility_renewal_' + nonce
    );
    check('renewal webhook accepted', renewal.status === 200, renewal.status + ' ' + renewal.text);
    rows = await notificationsFor(userIds, clubId);
    check('renewal creates no notification', rows.length === 3, 'rows=' + rows.length);

    const scheduledObject = await stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: true
    });
    const scheduled = await deliver(
      'customer.subscription.updated',
      scheduledObject,
      { cancel_at_period_end: false },
      'evt_test_visibility_scheduled_' + nonce
    );
    check('scheduled-cancel webhook accepted',
      scheduled.status === 200, scheduled.status + ' ' + scheduled.text);
    rows = await notificationsFor(userIds, clubId);
    check('scheduled cancellation creates no notification', rows.length === 3, 'rows=' + rows.length);

    const canceledObject = await stripe.subscriptions.cancel(subscription.id);
    const downgradeEventId = 'evt_test_visibility_downgrade_' + nonce;
    const downgrade = await deliver(
      'customer.subscription.deleted',
      canceledObject,
      null,
      downgradeEventId
    );
    check('actual-loss webhook accepted',
      downgrade.status === 200, downgrade.status + ' ' + downgrade.text);
    rows = await notificationsFor(userIds, clubId);
    const downgradeRows = rows.filter((row) =>
      row.source_key === 'club-pro-downgrade:' + subscription.id);
    for (const role of Object.keys(users)) {
      check(role + ' receives one downgrade disclosure',
        downgradeRows.filter((row) => row.user_id === users[role]).length === 1);
    }
    check('downgrade disclosures use exact copy and Privacy anchor',
      downgradeRows.length === 4 && downgradeRows.every((row) =>
        row.type === 'club' &&
        row.link === '/privacy#club-manager-visibility' &&
        row.title === clubName + ' no longer has Club Pro' &&
        row.body === clubName + ' no longer has Club Pro. Club administrators and coaches no longer have access to Club Pro training summaries, trends, and inactivity views for club members.'));

    const downgradeRetry = await deliver(
      'customer.subscription.deleted',
      canceledObject,
      null,
      downgradeEventId
    );
    check('actual-loss retry accepted',
      downgradeRetry.status === 200, downgradeRetry.status + ' ' + downgradeRetry.text);
    rows = await notificationsFor(userIds, clubId);
    check('actual-loss retry creates no duplicates',
      rows.filter((row) => row.source_key === 'club-pro-downgrade:' + subscription.id).length === 4);

    const { data: localSub, error: localSubErr } = await admin.from('subscriptions')
      .select('status, ever_paid')
      .eq('owner_type', 'club')
      .eq('owner_id', clubId)
      .single();
    if (localSubErr) throw localSubErr;
    check('local entitlement ended only after deletion',
      localSub.status === 'canceled' && localSub.ever_paid === true,
      JSON.stringify(localSub));

    // Required delivery must remain resumable even if the club re-subscribes
    // before Stripe retries an older deletion. Remove one old recipient row to
    // model an interrupted delivery, then prove the retry fills only that gap
    // without touching the newer active entitlement.
    const resubscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: clubProPrice }],
      default_payment_method: paymentMethod.id,
      payment_behavior: 'error_if_incomplete',
      metadata: { owner_type: 'club', owner_id: clubId }
    });
    stripeSubIds.push(resubscription.id);
    const resubscribeSession = {
      ...session,
      id: 'cs_test_visibility_resubscribe_' + nonce,
      subscription: resubscription.id
    };
    const resubscribeUpgrade = await deliver(
      'checkout.session.completed',
      resubscribeSession,
      null,
      'evt_test_visibility_resubscribe_' + nonce
    );
    check('re-subscription upgrade accepted',
      resubscribeUpgrade.status === 200,
      resubscribeUpgrade.status + ' ' + resubscribeUpgrade.text);
    const { error: gapErr } = await admin.from('notifications')
      .delete()
      .eq('user_id', users.member)
      .eq('source_key', 'club-pro-downgrade:' + subscription.id);
    if (gapErr) throw gapErr;
    const staleRetry = await deliver(
      'customer.subscription.deleted',
      canceledObject,
      null,
      downgradeEventId
    );
    check('old loss retry accepted after re-subscription',
      staleRetry.status === 200, staleRetry.status + ' ' + staleRetry.text);
    rows = await notificationsFor(userIds, clubId);
    check('old loss retry restores only the missing disclosure',
      rows.filter((row) =>
        row.source_key === 'club-pro-downgrade:' + subscription.id).length === 4);
    const { data: activeResub, error: activeResubErr } = await admin.from('subscriptions')
      .select('stripe_subscription_id, status')
      .eq('owner_type', 'club')
      .eq('owner_id', clubId)
      .single();
    if (activeResubErr) throw activeResubErr;
    check('old loss retry leaves newer entitlement active',
      activeResub.stripe_subscription_id === resubscription.id &&
      activeResub.status === 'active',
      JSON.stringify(activeResub));
    await stripe.subscriptions.cancel(resubscription.id);

    // Stripe explicitly permits cross-type webhook reordering. Prove a second
    // paid subscription still delivers both disclosures exactly once when its
    // deletion arrives before its delayed checkout completion.
    const reversedSubscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: clubProPrice }],
      default_payment_method: paymentMethod.id,
      payment_behavior: 'error_if_incomplete',
      metadata: { owner_type: 'club', owner_id: clubId }
    });
    stripeSubIds.push(reversedSubscription.id);
    check('reversed-order test subscription is active',
      reversedSubscription.status === 'active', reversedSubscription.status);
    const reversedCanceled = await stripe.subscriptions.cancel(reversedSubscription.id);
    const reversedLoss = await deliver(
      'customer.subscription.deleted',
      reversedCanceled,
      null,
      'evt_test_visibility_reverse_loss_' + nonce
    );
    check('reversed-order loss accepted before checkout completion',
      reversedLoss.status === 200, reversedLoss.status + ' ' + reversedLoss.text);

    const reversedSession = {
      ...session,
      id: 'cs_test_visibility_reverse_' + nonce,
      subscription: reversedSubscription.id
    };
    const delayedUpgrade = await deliver(
      'checkout.session.completed',
      reversedSession,
      null,
      'evt_test_visibility_reverse_upgrade_' + nonce
    );
    check('delayed upgrade accepted after actual loss',
      delayedUpgrade.status === 200, delayedUpgrade.status + ' ' + delayedUpgrade.text);
    rows = await notificationsFor(userIds, clubId);
    check('reversed-order loss reaches all four members exactly once',
      rows.filter((row) =>
        row.source_key === 'club-pro-downgrade:' + reversedSubscription.id).length === 4);
    check('reversed-order upgrade excludes initiator and reaches other roles exactly once',
      rows.filter((row) =>
        row.source_key === 'club-pro-upgrade:' + reversedSubscription.id).length === 3);
    const { data: reversedLocal, error: reversedLocalErr } = await admin.from('subscriptions')
      .select('stripe_subscription_id, status, ever_paid, last_paid_subscription_id')
      .eq('owner_type', 'club')
      .eq('owner_id', clubId)
      .single();
    if (reversedLocalErr) throw reversedLocalErr;
    check('delayed upgrade does not resurrect ended entitlement',
      reversedLocal.stripe_subscription_id === reversedSubscription.id &&
      reversedLocal.status === 'canceled' &&
      reversedLocal.ever_paid === true &&
      reversedLocal.last_paid_subscription_id === reversedSubscription.id,
      JSON.stringify(reversedLocal));
  } catch (error) {
    failures++;
    console.log('FAIL  unexpected — ' + error.message);
  } finally {
    for (const stripeSubId of stripeSubIds) {
      try {
        const sub = await stripe.subscriptions.retrieve(stripeSubId);
        if (sub.status !== 'canceled') await stripe.subscriptions.cancel(stripeSubId);
      } catch (error) {
        if (!(error && error.code === 'resource_missing')) console.log('cleanup subscription:', error.message);
      }
    }
    if (customerId) {
      try { await stripe.customers.del(customerId); }
      catch (error) { console.log('cleanup customer:', error.message); }
    }
    if (clubId) {
      const cleanup = [
        () => admin.from('notifications').delete().eq('entity_id', clubId),
        () => admin.from('memberships').delete().eq('club_id', clubId),
        () => admin.from('subscriptions').delete().eq('owner_type', 'club').eq('owner_id', clubId),
        () => admin.from('clubs').delete().eq('id', clubId)
      ];
      for (const operation of cleanup) {
        try {
          const { error } = await operation();
          if (error) console.log('cleanup database:', error.message);
        } catch (error) {
          console.log('cleanup database:', error.message);
        }
      }
    }
    for (const email of Object.values(emails)) {
      try { await deleteUserByEmail(email); }
      catch (error) { console.log('cleanup user:', error.message); }
    }
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});