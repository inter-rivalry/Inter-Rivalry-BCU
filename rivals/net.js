import { createClient } from
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

import {
  SUPABASE_URL,
  SUPABASE_ANON
} from './config.js';

/* =========================================
   INTER RIVALRY: RIVALS — NETWORK LAYER
   Uses the existing INTER RIVALRY Supabase
========================================= */

export class Net {
  constructor() {
    this.client = createClient(
      SUPABASE_URL,
      SUPABASE_ANON,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        },
        realtime: {
          params: {
            eventsPerSecond: 30
          }
        }
      }
    );

    this.user = null;
    this.displayName = '';
    this.irId = '';

    this.room = null;
    this.match = null;

    this.roomChannel = null;
    this.matchChannel = null;

    this.isHost = false;
    this.listeners = new Map();
  }

  /* =========================================
     EVENTS
  ========================================= */

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event) || [];

    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(
          `[RIVALS] Event callback failed: ${event}`,
          error
        );
      }
    });
  }

  /* =========================================
     ERROR HANDLING
  ========================================= */

  errorMessage(error, fallback = 'Something went wrong.') {
    if (!error) return fallback;

    console.error('[RIVALS NETWORK ERROR]', error);

    return error.message || fallback;
  }

  /* =========================================
     AUTHENTICATION
  ========================================= */

  async init() {
    try {
      const {
        data: { session },
        error
      } = await this.client.auth.getSession();

      if (error) {
        return {
          ok: false,
          reason: 'auth_error',
          message: this.errorMessage(
            error,
            'Could not check your login.'
          )
        };
      }

      if (!session?.user) {
        return {
          ok: false,
          reason: 'not_logged_in',
          message: 'Please sign in on INTER RIVALRY first.'
        };
      }

      this.user = session.user;

      const {
        data: profile,
        error: profileError
      } = await this.client
        .from('profiles')
        .select('inter_rivalry_id, full_name')
        .eq('id', this.user.id)
        .maybeSingle();

      if (profileError) {
        console.warn(
          '[RIVALS] Could not load profile:',
          profileError.message
        );
      }

      this.displayName =
        profile?.full_name ||
        this.user.user_metadata?.full_name ||
        this.user.user_metadata?.name ||
        this.user.email?.split('@')[0] ||
        `Player-${this.user.id.slice(0, 4)}`;

      this.irId =
        profile?.inter_rivalry_id || 'IR-???';

      return {
        ok: true,
        user: this.user,
        name: this.displayName,
        irId: this.irId
      };

    } catch (error) {
      return {
        ok: false,
        reason: 'connection_error',
        message: this.errorMessage(
          error,
          'Could not connect to INTER RIVALRY.'
        )
      };
    }
  }

  async logout() {
    try {
      const { error } = await this.client.auth.signOut();

      if (error) {
        return {
          ok: false,
          reason: error.message
        };
      }

      this.user = null;

      return { ok: true };

    } catch (error) {
      return {
        ok: false,
        reason: this.errorMessage(error)
      };
    }
  }

  /* =========================================
     AUTH CHECK
  ========================================= */

  requireUser() {
    if (!this.user) {
      return {
        ok: false,
        reason: 'not_logged_in',
        message: 'Please sign in first.'
      };
    }

    return null;
  }

  /* =========================================
     ROOM CODE
  ========================================= */

  genCode() {
    const characters =
      'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    let code = '';

    for (let i = 0; i < 4; i++) {
      code += characters[
        Math.floor(Math.random() * characters.length)
      ];
    }

    return code;
  }

  /* =========================================
     CREATE ROOM
  ========================================= */

  async createRoom(teamSize, mode) {
    const authError = this.requireUser();

    if (authError) return authError;

    if (![1, 2, 3, 4, 5].includes(Number(teamSize))) {
      return {
        ok: false,
        reason: 'invalid_team_size'
      };
    }

    if (!['practice', 'standard', 'hardcore'].includes(mode)) {
      return {
        ok: false,
        reason: 'invalid_mode'
      };
    }

    try {
      let code = null;

      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = this.genCode();

        const {
          data: existing,
          error
        } = await this.client
          .from('rooms')
          .select('id')
          .eq('code', candidate)
          .maybeSingle();

        if (error) {
          return {
            ok: false,
            reason: this.errorMessage(
              error,
              'Could not check room codes.'
            )
          };
        }

        if (!existing) {
          code = candidate;
          break;
        }
      }

      if (!code) {
        return {
          ok: false,
          reason: 'code_fail',
          message: 'Could not generate a unique room code.'
        };
      }

      const {
        data: room,
        error: roomError
      } = await this.client
        .from('rooms')
        .insert({
          code,
          host_id: this.user.id,
          team_size: Number(teamSize),
          mode,
          status: 'waiting'
        })
        .select()
        .single();

      if (roomError) {
        return {
          ok: false,
          reason: this.errorMessage(
            roomError,
            'Could not create room.'
          )
        };
      }

      const {
        error: playerError
      } = await this.client
        .from('room_players')
        .insert({
          room_id: room.id,
          user_id: this.user.id,
          display_name: this.displayName,
          ir_id: this.irId,
          team: 'blue',
          ready: false
        });

      if (playerError) {
        console.error(
          '[RIVALS] Could not add room host:',
          playerError
        );

        // Try to clean up the room if player insertion failed.
        await this.client
          .from('rooms')
          .delete()
          .eq('id', room.id)
          .eq('host_id', this.user.id);

        return {
          ok: false,
          reason: this.errorMessage(
            playerError,
            'Room created, but adding the host failed.'
          )
        };
      }

      this.room = room;
      this.isHost = true;

      return {
        ok: true,
        room
      };

    } catch (error) {
      return {
        ok: false,
        reason: this.errorMessage(
          error,
          'Unexpected room creation error.'
        )
      };
    }
  }

  /* =========================================
     JOIN ROOM
  ========================================= */

  async joinRoom(code) {
    const authError = this.requireUser();

    if (authError) return authError;

    const roomCode = String(code || '')
      .trim()
      .toUpperCase();

    if (!roomCode) {
      return {
        ok: false,
        reason: 'empty_code'
      };
    }

    try {
      const {
        data: room,
        error: roomError
      } = await this.client
        .from('rooms')
        .select('*')
        .eq('code', roomCode)
        .eq('status', 'waiting')
        .maybeSingle();

      if (roomError) {
        return {
          ok: false,
          reason: this.errorMessage(
            roomError,
            'Could not find room.'
          )
        };
      }

      if (!room) {
        return {
          ok: false,
          reason: 'not_found'
        };
      }

      const {
        data: existingPlayer,
        error: existingError
      } = await this.client
        .from('room_players')
        .select('*')
        .eq('room_id', room.id)
        .eq('user_id', this.user.id)
        .maybeSingle();

      if (existingError) {
        return {
          ok: false,
          reason: this.errorMessage(
            existingError,
            'Could not check room membership.'
          )
        };
      }

      if (existingPlayer) {
        this.room = room;
        this.isHost = room.host_id === this.user.id;

        return {
          ok: true,
          room
        };
      }

      const {
        data: players,
        error: playersError
      } = await this.client
        .from('room_players')
        .select('team')
        .eq('room_id', room.id);

      if (playersError) {
        return {
          ok: false,
          reason: this.errorMessage(
            playersError,
            'Could not load room players.'
          )
        };
      }

      const currentPlayers = players || [];

      const blueCount = currentPlayers.filter(
        player => player.team === 'blue'
      ).length;

      const redCount = currentPlayers.filter(
        player => player.team === 'red'
      ).length;

      const capacity = Number(room.team_size);

      if (
        blueCount >= capacity &&
        redCount >= capacity
      ) {
        return {
          ok: false,
          reason: 'full'
        };
      }

      let team;

      if (blueCount >= capacity) {
        team = 'red';
      } else if (redCount >= capacity) {
        team = 'blue';
      } else {
        team = blueCount <= redCount
          ? 'blue'
          : 'red';
      }

      const {
        error: insertError
      } = await this.client
        .from('room_players')
        .insert({
          room_id: room.id,
          user_id: this.user.id,
          display_name: this.displayName,
          ir_id: this.irId,
          team,
          ready: false
        });

      if (insertError) {
        return {
          ok: false,
          reason: this.errorMessage(
            insertError,
            'Could not join room.'
          )
        };
      }

      this.room = room;
      this.isHost = room.host_id === this.user.id;

      return {
        ok: true,
        room
      };

    } catch (error) {
      return {
        ok: false,
        reason: this.errorMessage(
          error,
          'Unexpected error while joining room.'
        )
      };
    }
  }

  /* =========================================
     FIND MATCH
  ========================================= */

  async findMatch(teamSize, mode) {
    const authError = this.requireUser();

    if (authError) return authError;

    try {
      const {
        data: rooms,
        error
      } = await this.client
        .from('rooms')
        .select('*')
        .eq('team_size', Number(teamSize))
        .eq('mode', mode)
        .eq('status', 'waiting')
        .order('created_at', { ascending: true })
        .limit(20);

      if (error) {
        return {
          ok: false,
          reason: this.errorMessage(
            error,
            'Could not search for matches.'
          )
        };
      }

      for (const room of rooms || []) {
        // Don't join your own room through matchmaking.
        if (room.host_id === this.user.id) {
          continue;
        }

        const result = await this.joinRoom(room.code);

        if (result.ok) {
          return result;
        }

        // Skip rooms that became full or closed.
        if (
          result.reason !== 'full' &&
          result.reason !== 'not_found'
        ) {
          console.warn(
            '[RIVALS] Could not join candidate room:',
            result.reason
          );
        }
      }

      return await this.createRoom(teamSize, mode);

    } catch (error) {
      return {
        ok: false,
        reason: this.errorMessage(
          error,
          'Matchmaking failed.'
        )
      };
    }
  }

  /* =========================================
     READY STATUS
  ========================================= */

  async setReady(ready) {
    const authError = this.requireUser();

    if (authError) return authError;

    if (!this.room) {
      return {
        ok: false,
        reason: 'no_room'
      };
    }

    const {
      error
    } = await this.client
      .from('room_players')
      .update({ ready: Boolean(ready) })
      .eq('room_id', this.room.id)
      .eq('user_id', this.user.id);

    if (error) {
      return {
        ok: false,
        reason: this.errorMessage(
          error,
          'Could not update ready status.'
        )
      };
    }

    return { ok: true };
  }

  /* =========================================
     LEAVE ROOM
  ========================================= */

  async leaveRoom() {
    if (!this.room || !this.user) {
      this.room = null;
      this.isHost = false;

      return { ok: true };
    }

    const room = this.room;
    const wasHost = this.isHost;

    try {
      const {
        error: playerError
      } = await this.client
        .from('room_players')
        .delete()
        .eq('room_id', room.id)
        .eq('user_id', this.user.id);

      if (playerError) {
        return {
          ok: false,
          reason: this.errorMessage(
            playerError,
            'Could not leave room.'
          )
        };
      }

      if (wasHost) {
        const {
          error: roomError
        } = await this.client
          .from('rooms')
          .delete()
          .eq('id', room.id)
          .eq('host_id', this.user.id);

        if (roomError) {
          return {
            ok: false,
            reason: this.errorMessage(
              roomError,
              'Could not close room.'
            )
          };
        }
      }

      this.room = null;
      this.isHost = false;

      return { ok: true };

    } catch (error) {
      return {
        ok: false,
        reason: this.errorMessage(
          error,
          'Unexpected error leaving room.'
        )
      };
    }
  }

  /* =========================================
     ROOM REALTIME
  ========================================= */

  async subscribeRoom(callbacks = {}) {
    if (!this.room || !this.user) return;

    if (this.roomChannel) {
      await this.client.removeChannel(this.roomChannel);
    }

    const roomId = this.room.id;

    this.roomChannel = this.client.channel(
      `room:${roomId}`,
      {
        config: {
          presence: {
            key: this.user.id
          }
        }
      }
    );

    this.roomChannel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${roomId}`
        },
        async () => {
          const {
            data,
            error
          } = await this.client
            .from('room_players')
            .select('*')
            .eq('room_id', roomId);

          if (error) {
            console.error(
              '[RIVALS] Player refresh failed:',
              error.message
            );
            return;
          }

          callbacks.onPlayers?.(data || []);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`
        },
        async () => {
          const {
            data: updatedRoom,
            error
          } = await this.client
            .from('rooms')
            .select('*')
            .eq('id', roomId)
            .maybeSingle();

          if (error) {
            console.error(
              '[RIVALS] Room refresh failed:',
              error.message
            );
            return;
          }

          if (!updatedRoom) {
            callbacks.onRoomClosed?.();
            return;
          }

          this.room = updatedRoom;
          callbacks.onRoomUpdate?.(updatedRoom);
        }
      )
      .on(
        'broadcast',
        { event: 'start' },
        payload => {
          callbacks.onStart?.(payload.payload);
        }
      )
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          const {
            data,
            error
          } = await this.client
            .from('room_players')
            .select('*')
            .eq('room_id', roomId);

          if (!error) {
            callbacks.onPlayers?.(data || []);
          }
        }

        if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT'
        ) {
          console.error(
            '[RIVALS] Room realtime status:',
            status
          );
        }
      });
  }

  /* =========================================
     START MATCH
  ========================================= */

  async startMatch() {
    if (!this.room || !this.isHost || !this.user) {
      return {
        ok: false,
        reason: 'not_host'
      };
    }

    try {
      const roomId = this.room.id;

      const {
        data: players,
        error: playersError
      } = await this.client
        .from('room_players')
        .select('*')
        .eq('room_id', roomId);

      if (playersError) {
        return {
          ok: false,
          reason: this.errorMessage(
            playersError,
            'Could not load players.'
          )
        };
      }

      const capacity = Number(this.room.team_size);

      if ((players || []).length !== capacity * 2) {
        return {
          ok: false,
          reason: 'players_missing',
          message: 'The room does not have enough players.'
        };
      }

      if (!(players || []).every(player => player.ready)) {
        return {
          ok: false,
          reason: 'players_not_ready',
          message: 'Every player must be ready.'
        };
      }

      const {
        data: match,
        error: matchError
      } = await this.client
        .from('matches')
        .insert({
          room_id: roomId,
          mode: this.room.mode,
          blue_score: 0,
          red_score: 0,
          status: 'active'
        })
        .select()
        .single();

      if (matchError) {
        return {
          ok: false,
          reason: this.errorMessage(
            matchError,
            'Could not create match.'
          )
        };
      }

      const {
        error: updateError
      } = await this.client
        .from('rooms')
        .update({ status: 'playing' })
        .eq('id', roomId)
        .eq('host_id', this.user.id);

      if (updateError) {
        return {
          ok: false,
          reason: this.errorMessage(
            updateError,
            'Could not update room status.'
          )
        };
      }

      this.match = match;

      const payload = {
        match,
        players
      };

      if (this.roomChannel) {
        await this.roomChannel.send({
          type: 'broadcast',
          event: 'start',
          payload
        });
      }

      return {
        ok: true,
        match,
        players
      };

    } catch (error) {
      return {
        ok: false,
        reason: this.errorMessage(
          error,
          'Could not start match.'
        )
      };
    }
  }

  /* =========================================
     MATCH REALTIME
  ========================================= */

  async subscribeMatch(matchId, callbacks = {}) {
    if (!this.user || !matchId) return;

    if (this.matchChannel) {
      await this.client.removeChannel(this.matchChannel);
    }

    this.matchChannel = this.client.channel(
      `match:${matchId}`,
      {
        config: {
          presence: {
            key: this.user.id
          }
        }
      }
    );

    const events = [
      'state',
      'shot',
      'hit',
      'flag',
      'score',
      'end',
      'kill'
    ];

    for (const eventName of events) {
      this.matchChannel.on(
        'broadcast',
        { event: eventName },
        message => {
          const callbackName = {
            state: 'onState',
            shot: 'onShot',
            hit: 'onHit',
            flag: 'onFlag',
            score: 'onScore',
            end: 'onEnd',
            kill: 'onKill'
          }[eventName];

          callbacks[callbackName]?.(message.payload);
        }
      );
    }

    this.matchChannel.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        const {
          error
        } = await this.matchChannel.track({
          id: this.user.id,
          name: this.displayName
        });

        if (error) {
          console.error(
            '[RIVALS] Presence tracking failed:',
            error.message
          );
        }

        callbacks.onJoined?.();
      }

      if (
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT'
      ) {
        console.error(
          '[RIVALS] Match realtime status:',
          status
        );
      }
    });
  }

  /* =========================================
     BROADCAST GAME EVENTS
  ========================================= */

  broadcastMatch(event, payload) {
    if (!this.matchChannel) return;

    this.matchChannel.send({
      type: 'broadcast',
      event,
      payload
    }).catch(error => {
      console.error(
        '[RIVALS] Broadcast failed:',
        error
      );
    });
  }

  /* =========================================
     END MATCH
  ========================================= */

  async endMatch(matchId, blueScore, redScore) {
    try {
      const {
        error
      } = await this.client
        .from('matches')
        .update({
          blue_score: blueScore,
          red_score: redScore,
          status: 'ended',
          ended_at: new Date().toISOString()
        })
        .eq('id', matchId);

      if (error) {
        return {
          ok: false,
          reason: this.errorMessage(
            error,
            'Could not save match result.'
          )
        };
      }

      this.broadcastMatch('end', {
        blueScore,
        redScore
      });

      return { ok: true };

    } catch (error) {
      return {
        ok: false,
        reason: this.errorMessage(
          error,
          'Could not end match.'
        )
      };
    }
  }

  /* =========================================
     PLAYER STATS
  ========================================= */

  async recordStats(matchId, stats) {
    if (!Array.isArray(stats) || stats.length === 0) {
      return { ok: true };
    }

    try {
      const {
        error
      } = await this.client
        .from('match_stats')
        .insert(
          stats.map(stat => ({
            match_id: matchId,
            ...stat
          }))
        );

      if (error) {
        return {
          ok: false,
          reason: this.errorMessage(
            error,
            'Could not save player stats.'
          )
        };
      }

      return { ok: true };

    } catch (error) {
      return {
        ok: false,
        reason: this.errorMessage(
          error,
          'Could not save player stats.'
        )
      };
    }
  }

  /* =========================================
     CLEANUP
  ========================================= */

  async cleanup() {
    if (this.roomChannel) {
      await this.client.removeChannel(this.roomChannel);
      this.roomChannel = null;
    }

    if (this.matchChannel) {
      await this.client.removeChannel(this.matchChannel);
      this.matchChannel = null;
    }

    this.room = null;
    this.match = null;
    this.isHost = false;
  }
}
