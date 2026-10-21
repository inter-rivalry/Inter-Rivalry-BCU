import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qfkxvflyzucvkeyucbzn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFma3h2Zmx5enVjdmtleXVjYnpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxODY2NTYsImV4cCI6MjEwMzc2MjY1Nn0.1bhOccN9aVzQKOm8VPctaBHZZznXpdTLh7Xzac9JOwU';

export class Net {
  constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    this.user = null;
    this.displayName = '';
    this.irId = '';
    this.room = null;
    this.match = null;
    this.roomChannel = null;
    this.matchChannel = null;
    this.isHost = false;
  }

  async init() {
    try {
      // ✅ FIX: Use getSession() instead of getUser(). It's instant and doesn't hang.
      const { data: { session } } = await this.client.auth.getSession();
      
      if (!session) {
        return { ok: false, reason: 'not_logged_in' };
      }
      
      this.user = session.user;

      const { data: profile } = await this.client
        .from('profiles')
        .select('inter_rivalry_id, full_name')
        .eq('id', this.user.id)
        .maybeSingle();

      this.displayName = profile?.full_name || this.user.email?.split('@')[0] || 'Player';
      this.irId = profile?.inter_rivalry_id || 'IR-???';

      return { ok: true, user: this.user, name: this.displayName, irId: this.irId };
    } catch (err) {
      console.error('[NET] Error:', err);
      return { ok: false, reason: err.message };
    }
  }

  async logout() { await this.client.auth.signOut(); }

  genCode() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }

  async createRoom(teamSize, mode) {
    let code;
    for (let tries = 0; tries < 6; tries++) {
      code = this.genCode();
      const { data: existing } = await this.client.from('rooms').select('id').eq('code', code).maybeSingle();
      if (!existing) break;
      code = null;
    }
    if (!code) return { ok: false, reason: 'code_fail' };
    const { data: room, error } = await this.client.from('rooms').insert({
      code, host_id: this.user.id, team_size: teamSize, mode, status: 'waiting',
    }).select().single();
    if (error) return { ok: false, reason: error.message };
    this.room = room; this.isHost = true;
    await this.client.from('room_players').insert({
      room_id: room.id, user_id: this.user.id, display_name: this.displayName, ir_id: this.irId, team: Math.random() < .5 ? 'blue' : 'red', ready: false,
    });
    return { ok: true, room };
  }

  async joinRoom(code) {
    const { data: room } = await this.client.from('rooms').select('*').eq('code', code.toUpperCase()).eq('status', 'waiting').maybeSingle();
    if (!room) return { ok: false, reason: 'not_found' };
    const { data: existing } = await this.client.from('room_players').select('*').eq('room_id', room.id).eq('user_id', this.user.id).maybeSingle();
    if (existing) { this.room = room; this.isHost = room.host_id === this.user.id; return { ok: true, room }; }
    const { data: players } = await this.client.from('room_players').select('team').eq('room_id', room.id);
    const blue = players.filter(p => p.team === 'blue').length; const red = players.filter(p => p.team === 'red').length;
    if (blue >= room.team_size && red >= room.team_size) return { ok: false, reason: 'full' };
    let team = 'blue';
    if (blue >= room.team_size) team = 'red'; else if (red >= room.team_size) team = 'blue'; else team = blue <= red ? 'blue' : 'red';
    await this.client.from('room_players').insert({ room_id: room.id, user_id: this.user.id, display_name: this.displayName, ir_id: this.irId, team, ready: false });
    this.room = room; this.isHost = room.host_id === this.user.id;
    return { ok: true, room };
  }

  async findMatch(teamSize, mode) {
    const { data: rooms } = await this.client.from('rooms').select('*').eq('team_size', teamSize).eq('mode', mode).eq('status', 'waiting').order('created_at', { ascending: true }).limit(10);
    for (const r of rooms || []) {
      const { data: players } = await this.client.from('room_players').select('team').eq('room_id', r.id);
      const blue = players.filter(p => p.team === 'blue').length; const red = players.filter(p => p.team === 'red').length;
      if (blue < teamSize || red < teamSize) return this.joinRoom(r.code);
    }
    return this.createRoom(teamSize, mode);
  }

  async setReady(ready) { if (this.room) await this.client.from('room_players').update({ ready }).eq('room_id', this.room.id).eq('user_id', this.user.id); }
  async leaveRoom() { if (!this.room) return; await this.client.from('room_players').delete().eq('room_id', this.room.id).eq('user_id', this.user.id); if (this.isHost) await this.client.from('rooms').delete().eq('id', this.room.id); this.room = null; this.isHost = false; }

  subscribeRoom(callbacks = {}) {
    if (!this.room) return;
    if (this.roomChannel) this.client.removeChannel(this.roomChannel);
    this.roomChannel = this.client.channel('room:' + this.room.id, { config: { presence: { key: this.user.id } } });
    this.roomChannel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${this.room.id}` }, async () => {
        const { data: ps } = await this.client.from('room_players').select('*').eq('room_id', this.room.id).order('joined_at'); callbacks.onPlayers?.(ps || []);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${this.room.id}` }, async () => {
        const { data: room } = await this.client.from('rooms').select('*').eq('id', this.room.id).maybeSingle();
        if (!room) { callbacks.onRoomClosed?.(); return; } this.room = room; callbacks.onRoomUpdate?.(room);
      })
      .on('broadcast', { event: 'start' }, p => callbacks.onStart?.(p.payload))
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') { const { data: ps } = await this.client.from('room_players').select('*').eq('room_id', this.room.id).order('joined_at'); callbacks.onPlayers?.(ps || []); }
      });
  }

  async startMatch() {
    if (!this.room || !this.isHost) return { ok: false };
    const { data: match, error } = await this.client.from('matches').insert({ room_id: this.room.id, mode: this.room.mode, blue_score: 0, red_score: 0, status: 'active' }).select().single();
    if (error) return { ok: false, reason: error.message };
    await this.client.from('rooms').update({ status: 'playing' }).eq('id', this.room.id);
    const { data: players } = await this.client.from('room_players').select('*').eq('room_id', this.room.id);
    this.roomChannel.send({ type: 'broadcast', event: 'start', payload: { match, players } });
    return { ok: true, match, players };
  }

  subscribeMatch(matchId, callbacks = {}) {
    if (this.matchChannel) this.client.removeChannel(this.matchChannel);
    this.matchChannel = this.client.channel('match:' + matchId, { config: { presence: { key: this.user.id } } });
    this.matchChannel
      .on('broadcast', { event: 'state' }, p => callbacks.onState?.(p.payload))
      .on('broadcast', { event: 'shot' }, p => callbacks.onShot?.(p.payload))
      .on('broadcast', { event: 'hit' }, p => callbacks.onHit?.(p.payload))
      .on('broadcast', { event: 'flag' }, p => callbacks.onFlag?.(p.payload))
      .on('broadcast', { event: 'score' }, p => callbacks.onScore?.(p.payload))
      .on('broadcast', { event: 'end' }, p => callbacks.onEnd?.(p.payload))
      .on('broadcast', { event: 'kill' }, p => callbacks.onKill?.(p.payload))
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') { await this.matchChannel.track({ id: this.user.id, name: this.displayName }); callbacks.onJoined?.(); }
      });
  }

  broadcastMatch(event, payload) { if (this.matchChannel) this.matchChannel.send({ type: 'broadcast', event, payload }); }

  async recordStats(matchId, stats) { if (stats.length) await this.client.from('match_stats').insert(stats.map(s => ({ match_id: matchId, ...s }))); }

  async cleanup() {
    if (this.roomChannel) { await this.client.removeChannel(this.roomChannel); this.roomChannel = null; }
    if (this.matchChannel) { await this.client.removeChannel(this.matchChannel); this.matchChannel = null; }
    this.room = null; this.isHost = false;
  }
}
