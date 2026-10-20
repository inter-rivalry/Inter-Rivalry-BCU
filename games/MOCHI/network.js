import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  realtime: { params: { eventsPerSecond: 30 } }
});

/* ============================================================
   IR USER — same Supabase Auth session as your website
   ============================================================ */
export async function getIRUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { ok: false, reason: 'not_logged_in' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('inter_rivalry_id, full_name')
    .eq('id', user.id)
    .maybeSingle();

  const name =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.user_metadata?.username ||
    user.email?.split('@')[0] ||
    'Player-' + user.id.slice(0, 4);

  const irId = profile?.inter_rivalry_id || 'IR-???';

  return {
    ok: true,
    userId: user.id,
    irId,
    name: name.slice(0, 16),
    gender: null // will be filled later when we know the column
  };
}

/* ============================================================
   ROOM HELPERS
   ============================================================ */
function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export async function createRoom(userId, irId) {
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    const { error } = await supabase
      .from('mochi_rooms')
      .insert({ code, host_user_id: userId, host_ir_id: irId });
    if (!error) return { ok: true, code };
    if (error.code !== '23505') return { ok: false, error: error.message };
  }
  return { ok: false, error: 'code_collision' };
}

export async function findRoom(code) {
  const { data, error } = await supabase
    .from('mochi_rooms')
    .select('code, host_user_id, host_ir_id')
    .eq('code', String(code || '').toUpperCase().trim())
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'not_found' };
  return { ok: true, code: data.code, hostUserId: data.host_user_id, hostIrId: data.host_ir_id };
}

export async function deleteRoom(code) {
  await supabase.from('mochi_rooms').delete().eq('code', code);
}

/* ============================================================
   MATCH HISTORY
   ============================================================ */
export async function loadMatchHistory(irId, limit = 10) {
  const { data, error } = await supabase
    .from('mochi_matches')
    .select('*')
    .eq('ir_id', irId)
    .order('played_at', { ascending: false })
    .limit(limit);
  if (error) return { ok: false, matches: [] };
  return { ok: true, matches: data || [] };
}

export async function saveMatch(entry) {
  const won = Number(entry.scoreSelf) > Number(entry.scoreOpponent);
  await supabase.from('mochi_matches').insert({
    match_id: entry.matchId,
    user_id: entry.userId,
    ir_id: entry.irId,
    player_name: entry.playerName,
    character_id: entry.characterId,
    opponent_ir_id: entry.opponentIrId,
    opponent_name: entry.opponentName,
    score_self: entry.scoreSelf,
    score_opponent: entry.scoreOpponent,
    won
  });
}

/* ============================================================
   REALTIME BROADCAST CHANNEL (same pattern as your net.js)
   ============================================================ */
export class RoomChannel {
  constructor(code, selfId, name) {
    this.code = code;
    this.selfId = selfId;
    this.name = name;
    this.ch = supabase.channel(`mochi:${code}`, {
      config: { broadcast: { self: false } }
    });
    this.listeners = {};
  }
  on(event, fn) {
    (this.listeners[event] ||= []).push(fn);
    return this;
  }
  _emit(event, payload) {
    (this.listeners[event] || []).forEach(fn => {
      try { fn(payload); } catch (e) { console.error(e); }
    });
  }
  join() {
    return new Promise((resolve, reject) => {
      this.ch
        .on('broadcast', { event: 'msg' }, ({ payload }) => {
          if (!payload || payload.from === this.selfId) return;
          this._emit(payload.type, payload);
        })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') {
            this.send('hello', { name: this.name });
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            reject(new Error(status));
          }
        });
    });
  }
  send(type, data = {}) {
    this.ch.send({
      type: 'broadcast', event: 'msg',
      payload: { type, from: this.selfId, name: this.name, ...data, ts: Date.now() }
    });
  }
  async leave() {
    try { this.send('leave', {}); } catch (_) {}
    await supabase.removeChannel(this.ch);
  }
}
