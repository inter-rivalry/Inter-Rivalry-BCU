import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@inter-rivalry.example';
const WEBHOOK_SECRET = Deno.env.get('IR_WEBHOOK_SECRET')!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ir-webhook-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } }); }
function categoryFor(type: string) {
  const t = (type || '').toLowerCase();
  if (t.includes('message') || t.includes('chat')) return 'direct_messages';
  if (t.includes('challenge')) return 'challenges';
  if (t.includes('result') || t.includes('winner')) return 'results';
  if (t.includes('tournament')) return 'tournaments';
  if (t.includes('rank')) return 'rankings';
  return 'account_updates';
}
function inQuietHours(pref: any) {
  if (!pref?.quiet_hours_enabled) return false;
  try {
    const zone = pref.timezone_name || 'Asia/Kolkata';
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const now = parts.find(p => p.type === 'hour')!.value + ':' + parts.find(p => p.type === 'minute')!.value;
    const start = String(pref.quiet_start || '22:00').slice(0,5), end = String(pref.quiet_end || '07:00').slice(0,5);
    return start > end ? (now >= start || now < end) : (now >= start && now < end);
  } catch { return false; }
}
async function deliver(userId: string, pref: any, title: string, body: string, url = '/') {
  if (!pref || inQuietHours(pref)) return { sent: 0, skipped: 'quiet-hours-or-no-preferences' };
  const { data: subs, error } = await admin.from('push_subscriptions').select('*').eq('user_id', userId);
  if (error || !subs?.length) return { sent: 0, skipped: 'no-subscription' };
  const payload = JSON.stringify({ title, body, url, tag: `ir-${Date.now()}`, silent: !pref.sound_enabled, vibrate: pref.vibration_enabled ? [120, 60, 120] : [] });
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', sub.id);
      else console.error('Push delivery failed:', e?.message || e);
    }
  }
  return { sent };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  if (!WEBHOOK_SECRET || req.headers.get('x-ir-webhook-secret') !== WEBHOOK_SECRET) return json({ error: 'Unauthorized webhook' }, 401);
  try {
    const payload = await req.json();
    const table = payload.table;
    const row = payload.record || payload.new || payload;

    if (table === 'notifications') {
      const userId = row.user_id;
      if (!userId) return json({ ignored: 'missing user_id' });
      const { data: pref } = await admin.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle();
      const category = categoryFor(row.notification_type);
      if (pref && pref[category] === false) return json({ sent: 0, skipped: 'category-disabled' });
      const result = await deliver(userId, pref || {}, row.title || 'INTER RIVALRY', row.message || 'You have a new update.', row.data?.link || '/');
      return json(result);
    }

    if (table === 'global_chat_messages') {
      const senderId = row.sender_id;
      if (!senderId) return json({ ignored: 'missing sender_id' });
      const [{ data: prefs }, { data: profiles }, { data: sender }] = await Promise.all([
        admin.from('notification_preferences').select('*').neq('global_chat_mode', 'off'),
        admin.from('profiles').select('id,full_name'),
        admin.from('profiles').select('full_name').eq('id', senderId).maybeSingle()
      ]);
      const names = new Map((profiles || []).map((p: any) => [p.id, p.full_name || 'Rival']));
      const senderName = sender?.full_name || 'A rival';
      const bodyText = String(row.body || '').slice(0, 180);
      const results = [];
      for (const pref of prefs || []) {
        if (pref.user_id === senderId || inQuietHours(pref)) continue;
        const mode = pref.global_chat_mode;
        if (mode === 'mentions_only') {
          const name = String(names.get(pref.user_id) || '').trim();
          if (!name || !new RegExp('@' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(bodyText)) continue;
        }
        if (mode === 'every_minute') {
          const last = pref.last_global_push_at ? new Date(pref.last_global_push_at).getTime() : 0;
          if (Date.now() - last < 60000) continue;
          await admin.from('notification_preferences').update({ last_global_push_at: new Date().toISOString() }).eq('user_id', pref.user_id);
        }
        if (mode !== 'every_message' && mode !== 'every_minute' && mode !== 'mentions_only') continue;
        results.push(await deliver(pref.user_id, pref, '🌍 Global Chat', `${senderName}: ${bodyText}`, '/'));
      }
      return json({ recipients_checked: (prefs || []).length, results });
    }
    return json({ ignored: `unsupported table: ${table}` });
  } catch (error: any) {
    console.error(error);
    return json({ error: error?.message || 'Unexpected push error' }, 500);
  }
});
