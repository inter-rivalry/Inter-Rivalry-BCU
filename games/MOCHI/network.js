import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  realtime: { params: { eventsPerSecond: 30 } }
});

// ============================================
// GET INTER RIVALRY USER
// ============================================

export async function getIRUser() {
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      ok: false,
      reason: 'not_logged_in'
    };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('inter_rivalry_id, full_name')
    .eq('id', user.id)
    .maybeSingle();

  const name =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.email?.split('@')[0] ||
    'Player';

  const irId = profile?.inter_rivalry_id || 'IR-???';

  return {
    ok: true,
    userId: user.id,
    irId,
    name: String(name).slice(0, 16),
    gender: null
  };
}

// ============================================
// GENERATE ROOM CODE
// ============================================

function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';

  for (let i = 0; i < 5; i++) {
    s += A[Math.floor(Math.random() * A.length)];
  }

  return s;
}

// ============================================
// CREATE ROOM — DUPLICATE CODE FIX
// ============================================

export async function createRoom(userId, irId) {
  if (!userId || !irId) {
    return {
      ok: false,
      error: 'invalid_user'
    };
  }

  // Retry if the generated code already exists.
  for (let i = 0; i < 10; i++) {
    const code = genCode();

    const { data, error } = await supabase
      .from('mochi_rooms')
      .insert({
        code,
        host_user_id: userId,
        host_ir_id: irId
      })
      .select('code, host_user_id, host_ir_id')
      .single();

    // PostgreSQL duplicate-key error.
    if (error?.code === '23505') {
      continue;
    }

    if (error) {
      console.error('MOCHI room creation failed:', error);

      return {
        ok: false,
        error: error.message
      };
    }

    // The database confirms this room was created.
    return {
      ok: true,
      code: data.code,
      hostUserId: data.host_user_id,
      hostIrId: data.host_ir_id
    };
  }

  return {
    ok: false,
    error: 'code_collision'
  };
}

// ============================================
// FIND ROOM
// ============================================

export async function findRoom(code) {
  const normalizedCode = String(code || '')
    .toUpperCase()
    .trim();

  if (!normalizedCode) {
    return {
      ok: false,
      error: 'invalid_code'
    };
  }

  const { data, error } = await supabase
    .from('mochi_rooms')
    .select('code, host_user_id, host_ir_id')
    .eq('code', normalizedCode)
    .maybeSingle();

  if (error) {
    console.error('MOCHI room lookup failed:', error);

    return {
      ok: false,
      error: error.message
    };
  }

  if (!data) {
    return {
      ok: false,
      error: 'not_found'
    };
  }

  return {
    ok: true,
    code: data.code,
    hostUserId: data.host_user_id,
    hostIrId: data.host_ir_id
  };
}

// ============================================
// DELETE ROOM
// ============================================

export async function deleteRoom(code) {
  if (!code) return;

  const { error } = await supabase
    .from('mochi_rooms')
    .delete()
    .eq('code', String(code).toUpperCase().trim());

  if (error) {
    console.error('MOCHI room deletion failed:', error);

    return {
      ok: false,
      error: error.message
    };
  }

  return {
    ok: true
  };
}

// ============================================
// LOAD MATCH HISTORY
// ============================================

export async function loadMatchHistory(irId, limit = 10) {
  const { data, error } = await supabase
    .from('mochi_matches')
    .select('*')
    .eq('ir_id', irId)
    .order('played_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('MOCHI match history failed:', error);

    return {
      ok: false,
      matches: []
    };
  }

  return {
    ok: true,
    matches: data || []
  };
}

// ============================================
// SAVE MATCH RESULT
// ============================================

export async function saveMatch(entry) {
  if (!entry) {
    return {
      ok: false,
      error: 'invalid_entry'
    };
  }

  const won =
    Number(entry.scoreSelf) > Number(entry.scoreOpponent);

  const { error } = await supabase
    .from('mochi_matches')
    .insert({
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

  if (error) {
    console.error('MOCHI match saving failed:', error);

    return {
      ok: false,
      error: error.message
    };
  }

  return {
    ok: true
  };
}

// ============================================
// REALTIME ROOM CHANNEL
// ============================================

export class RoomChannel {
  constructor(code, selfId, name) {
    this.code = String(code || '').toUpperCase().trim();
    this.selfId = selfId;
    this.name = name;

    this.ch = supabase.channel(`mochi:${this.code}`, {
      config: {
        broadcast: {
          self: false
        }
      }
    });

    this.listeners = {};
  }

  // ------------------------------------------
  // REGISTER EVENT LISTENER
  // ------------------------------------------

  on(event, fn) {
    (this.listeners[event] ||= []).push(fn);

    return this;
  }

  // ------------------------------------------
  // EMIT EVENT TO LOCAL LISTENERS
  // ------------------------------------------

  _emit(event, payload) {
    (this.listeners[event] || []).forEach(fn => {
      try {
        fn(payload);
      } catch (e) {
        console.error('MOCHI listener error:', e);
      }
    });
  }

  // ------------------------------------------
  // JOIN REALTIME CHANNEL
  // ------------------------------------------

  join() {
    return new Promise((resolve, reject) => {
      this.ch
        .on('broadcast', { event: 'msg' }, ({ payload }) => {
          if (!payload || payload.from === this.selfId) {
            return;
          }

          this._emit(payload.type, payload);
        })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') {
            this.send('hello', {});

            setTimeout(() => {
              this.send('hello', {});
            }, 800);

            setTimeout(() => {
              this.send('hello', {});
            }, 2500);

            resolve();
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT'
          ) {
            reject(new Error(status));
          }
        });
    });
  }

  // ------------------------------------------
  // SEND REALTIME MESSAGE
  // ------------------------------------------

  send(type, data = {}) {
    return this.ch.send({
      type: 'broadcast',
      event: 'msg',
      payload: {
        type,
        from: this.selfId,
        name: this.name,
        ...data,
        ts: Date.now()
      }
    });
  }

  // ------------------------------------------
  // LEAVE REALTIME CHANNEL
  // ------------------------------------------

  async leave() {
    try {
      this.send('leave', {});
    } catch (e) {
      console.error('MOCHI leave notification failed:', e);
    }

    await supabase.removeChannel(this.ch);
  }
}
