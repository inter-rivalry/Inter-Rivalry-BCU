import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  realtime: { params: { eventsPerSecond: 30 } }
});

/* ---------- room helpers ---------- */

function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export async function createRoom(displayName) {
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    const hostId = crypto.randomUUID();
    const { error } = await supabase.from('mochi_rooms').insert({ code, host_id: hostId });
    if (!error) return { ok: true, code, hostId, name: displayName };
    if (error.code !== '23505') return { ok: false, error: error.message };
  }
  return { ok: false, error: 'code_collision' };
}

export async function findRoom(code) {
  const { data, error } = await supabase
    .from('mochi_rooms')
    .select('code, host_id')
    .eq('code', String(code || '').toUpperCase().trim())
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'not_found' };
  return { ok: true, code: data.code, hostId: data.host_id };
}

export async function deleteRoom(code) {
  await supabase.from('mochi_rooms').delete().eq('code', code);
}

/* ---------- realtime broadcast wrapper ---------- */

export class RoomChannel {
  constructor(code, selfId, name) {
    this.code = code;
    this.selfId = selfId;
    this.name = name;
    this.ch = supabase.channel(`room:${code}`, {
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
      type: 'broadcast',
      event: 'msg',
      payload: { type, from: this.selfId, name: this.name, ...data, ts: Date.now() }
    });
  }

  async leave() {
    try { this.send('leave', {}); } catch (_) {}
    await supabase.removeChannel(this.ch);
  }
}
