const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'KudosTest!2026';

(async () => {
  const manifest = { users: [], activities: [], follows: [] };
  const mk = async (email, name, handle) => {
    const { data, error } = await sb.auth.admin.createUser({
      email, password: PW, email_confirm: true,
      user_metadata: { name, handle, sports: ['running'] }
    });
    if (error) throw new Error(email + ': ' + error.message);
    manifest.users.push({ id: data.user.id, email });
    return data.user.id;
  };
  const a = await mk('kudos.alex.e2e@arenas-test.dev', 'Kudos Alex', 'kudosalex');
  const b = await mk('kudos.blair.e2e@arenas-test.dev', 'Kudos Blair', 'kudosblair');

  for (const [f, g] of [[a, b], [b, a]]) {
    const { error } = await sb.from('follows').insert({ follower_id: f, following_id: g });
    if (error) throw new Error('follow: ' + error.message);
    manifest.follows.push({ follower_id: f, following_id: g });
  }

  const mkAct = async (uid, title) => {
    const { data, error } = await sb.from('activities').insert({
      user_id: uid, title, sport: 'running', distance: '8 km', duration: '42:00',
      date: new Date().toISOString()
    }).select().single();
    if (error) throw new Error('activity: ' + error.message);
    manifest.activities.push({ id: data.id, user_id: uid, title });
    return data.id;
  };
  const actA = await mkAct(a, 'Threshold intervals 6x800m');
  const actB = await mkAct(b, 'Easy recovery jog');

  manifest.password = PW;
  manifest.ids = { a, b, actA, actB };
  require('fs').writeFileSync('/tmp/kudos_manifest.json', JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest.ids));
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
