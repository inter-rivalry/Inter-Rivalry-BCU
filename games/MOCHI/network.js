import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  realtime: {
    params: {
      eventsPerSecond: 30
    }
  }
});

// ============================================
// GET LOGGED-IN INTER RIVALRY USER
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
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';

  for (let i = 0; i < 5; i++) {
    code += characters[
      Math.floor(Math.random() * characters.length)
    ];
  }

  return code;
}

// ============================================
// CREATE ROOM
// ============================================

export async function createRoom(userId, irId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();

    console.log('[MOCHI] Creating room:', code);

    const { error } = await supabase
      .from('mochi_rooms')
      .insert({
        code,
        host_user_id: userId,
        host_ir_id: irId
      });

    if (!error) {
      console.log('[MOCHI] Room created successfully:', code);

      return {
        ok: true,
        code
      };
    }

    console.error('[MOCHI] Room creation error:', error);

    // Retry only if the room code already exists.
    if (error.code !== '23505') {
      return {
        ok: false,
        error: error.message
      };
    }
  }

  return {
    ok: false,
    error: 'code_collision'
  };
}

// ============================================
// FIND EXISTING ROOM
// ============================================

export async function findRoom(code) {
  const cleanCode = String(code || '')
    .trim()
    .toUpperCase();

  console.log('[MOCHI] Looking for room:', cleanCode);

  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(cleanCode)) {
    return {
      ok: false,
      error: 'invalid_code'
    };
  }

  const { data, error } = await supabase
    .from('mochi_rooms')
    .select('code, host_user_id, host_ir_id')
    .eq('code', cleanCode)
    .maybeSingle();

  if (error) {
    console.error('[MOCHI] Room lookup failed:', error);

    return {
      ok: false,
      error: `Database lookup failed: ${error.message}`
    };
  }

  if (!data) {
    console.error(
      '[MOCHI] No existing room found for code:',
      cleanCode
    );

    return {
      ok: false,
      error: 'not_found'
    };
  }

  console.log('[MOCHI] Existing room found:', data.code);
  console.log('[MOCHI] Room host:', data.host_user_id);

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
  const cleanCode = String(code || '')
    .trim()
    .toUpperCase();

  if (!cleanCode) return;

  const { error } = await supabase
    .from('mochi_rooms')
    .delete()
    .eq('code', cleanCode);

  if (error) {
    console.error('[MOCHI] Room deletion failed:', error);
  } else {
    console.log('[MOCHI] Room deleted:', cleanCode);
  }
}

// ============================================
// LOAD MATCH HISTORY
// ============================================

export async function loadMatchHistory(irId, limit = 10) {
  const { data, error } = await supabase
    .from('mochi_matches')
    .select('*')
    .eq('ir_id', irId)
    .order('played_at', {
      ascending: false
    })
    .limit(limit);

  if (error) {
    console.error('[MOCHI] Match history error:', error);

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
  const won =
    Number(entry.scoreSelf) >
    Number(entry.scoreOpponent);

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
    console.error('[MOCHI] Saving match failed:', error);

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
// MULTIPLAYER ROOM CHANNEL
// ============================================

export class RoomChannel {
  constructor(code, selfId, name) {
    this.code = String(code || '')
      .trim()
      .toUpperCase();

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
    this.joined = false;
  }

  // ------------------------------------------
  // REGISTER EVENT LISTENER
  // ------------------------------------------

  on(event, fn) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }

    this.listeners[event].push(fn);

    return this;
  }

  // ------------------------------------------
  // SEND EVENT TO LOCAL LISTENERS
  // ------------------------------------------

  _emit(event, payload) {
    const callbacks = this.listeners[event] || [];

    callbacks.forEach(fn => {
      try {
        fn(payload);
      } catch (error) {
        console.error(
          `[MOCHI] Error handling "${event}" event:`,
          error
        );
      }
    });
  }

  // ------------------------------------------
  // JOIN EXISTING REALTIME CHANNEL
  // ------------------------------------------

  join() {
    return new Promise((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;

        settled = true;

        reject(
          new Error('Room connection timed out. Please try again.')
        );
      }, 15000);

      this.ch
        .on(
          'broadcast',
          {
            event: 'msg'
          },
          ({ payload }) => {
            if (!payload) return;

            if (payload.from === this.selfId) return;

            this._emit(payload.type, payload);
          }
        )
        .subscribe(status => {
          console.log(
            `[MOCHI] Channel ${this.code}:`,
            status
          );

          if (status === 'SUBSCRIBED' && !settled) {
            settled = true;
            this.joined = true;

            clearTimeout(timeout);

            // Announce this player to the other player.
            this.send('hello', {});

            // Repeat announcements to help players discover each other
            // if one player connects slightly later.
            setTimeout(() => {
              if (this.joined) this.send('hello', {});
            }, 800);

            setTimeout(() => {
              if (this.joined) this.send('hello', {});
            }, 2500);

            resolve();
          }

          if (
            (status === 'CHANNEL_ERROR' ||
              status === 'TIMED_OUT') &&
            !settled
          ) {
            settled = true;

            clearTimeout(timeout);

            reject(
              new Error(
                `Could not connect to room ${this.code}: ${status}`
              )
            );
          }
        });
    });
  }

  // ------------------------------------------
  // BROADCAST EVENT
  // ------------------------------------------

  send(type, data = {}) {
    if (!this.ch || !this.joined) {
      console.warn(
        '[MOCHI] Cannot send; channel is not connected:',
        type
      );

      return;
    }

    this.ch.send({
      type: 'broadcast',
      event: 'msg',
      payload: {
        type,
        from: this.selfId,
        name: this.name,
        ...data,
        ts: Date.now()
      }
    }).then(status => {
      if (status !== 'ok') {
        console.warn(
          '[MOCHI] Broadcast status:',
          status,
          'Event:',
          type
        );
      }
    }).catch(error => {
      console.error(
        '[MOCHI] Broadcast failed:',
        error
      );
    });
  }

  // ------------------------------------------
  // LEAVE CHANNEL
  // ------------------------------------------

  async leave() {
    this.joined = false;

    try {
      await supabase.removeChannel(this.ch);
    } catch (error) {
      console.error(
        '[MOCHI] Error leaving channel:',
        error
      );
    }
  }
}
