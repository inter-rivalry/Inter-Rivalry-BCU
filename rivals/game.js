import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { Net } from './net.js';

const $ = id => document.getElementById(id);
const touch = matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const rand = (a, b) => a + Math.random() * (b - a);

/* ===== LANDSCAPE LOCK ===== */
async function lockLandscape() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  } catch (_) {}
  try {
    if (screen.orientation?.lock) await screen.orientation.lock('landscape');
  } catch (_) {}
}

/* ===== CONSTANTS ===== */
const H = 1.7, SPEED = 7.5, DASH_SPEED = 22, DASH_DUR = .15, DASH_CD = 1.5;
const INVULN = .6, RESPAWN = 3;
const LOCK_CONE = .20, LOCK_RANGE = 25, LOCK_PULL = 12, DRIFT_BREAK = .35;
const HEAD_CD = .8, HEAD_ACCUM = touch ? 60 : 100;
const CAPTURES_TO_WIN = 3, BROADCAST_HZ = 15;
const STEAL_RANGE = 4, TREASURE_RANGE = 6;

const MODES = {
  practice: { desc: "Play a practice match vs bots. 2 teammates + 3 enemies.", enemyFire: true, matchTime: 999 },
  standard: { desc: '5 minutes. Enemies fire back. Balanced run.', enemyFire: true, matchTime: 300 },
  hardcore: { desc: '3 minutes. Faster fire. Deadlier projectiles.', enemyFire: true, matchTime: 180 },
};

const DIFFICULTY = {
  easy:   { fireDelay: [3, 6], accuracy: 0.55, speed: 4, projectileSpeed: 7,  dmg: 8 },
  medium: { fireDelay: [2.5, 5], accuracy: 0.72, speed: 5, projectileSpeed: 9,  dmg: 10 },
  hard:   { fireDelay: [2, 4], accuracy: 0.88, speed: 6, projectileSpeed: 12, dmg: 14 },
};

const COLORS = {
  azure: { hex: 0x44d7ff, name: 'AZURE' },
  crimson: { hex: 0xff4c73, name: 'CRIMSON' },
  gold: { hex: 0xffe38b, name: 'GOLD' },
  venom: { hex: 0x52ffb1, name: 'VENOM' },
};

/* ===== STATE ===== */
const net = new Net();
let scene, camera, renderer, clock, raycaster;
let localId = null, localName = '', localIrId = '', localTeam = 'blue', isHost = false;
let matchId = null;
let running = false, paused = false, practiceMode = false;
let health = 100, alive = true, respawnTimer = 0;
let ammo = 12, reloadT = 0;
let yaw = 0, pitch = 0, vy = 0, onGround = true;
let mx = 0, my = 0, joyId = null, aimId = null;
let lastX = 0, lastY = 0, fire = false, lastShot = 0, jump = false;
let dashT = 0, dashCd = 0, dashDirX = 0, dashDirZ = 1;
let recoil = 0, cameraShake = 0, shakeX = 0, shakeY = 0;
let invulnT = 0;
let scoreBlue = 0, scoreRed = 0, roundTime = 300;
let kills = 0, deaths = 0, captures = 0, headshots = 0;
let stateBroadcastTimer = 0, gameOver = false, matchMode = 'standard';
let currentMatchTime = 300;
let practiceDifficulty = 'medium';

const aim = {
  sensitivity: +(localStorage.getItem('rivals-sens') || (touch ? 1.4 : 1.0)),
  assistStrength: +(localStorage.getItem('rivals-assist') || (touch ? 1.0 : 0.85)),
  locked: null, lockPoint: 'chest', headCd: 0, upAccum: 0, upWin: 0,
};

let gameMode = 'practice';
let playerColorKey = (localStorage.getItem('rivals-color') || 'azure');
let lobbyPreview = null;

// Remote real players
const players = new Map();
// Bot players (practice mode only)
const bots = [];
// Projectiles (bots firing)
const practiceProjectiles = [];
// Flags
const flags = { blue: null, red: null };
const covers = [], wallMeshes = [];
const keys = {};

/* ===== UTILS ===== */
function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  return m;
}
function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) Array.isArray(o.material) ? o.material.forEach(m => m.dispose()) : o.material.dispose();
  });
}

/* ===== HUMANOID ===== */
function buildHumanoid(color) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: .05, emissive: color, emissiveIntensity: .15 });
  const hitParts = [];
  const part = (geo, m, x, y, z, isHead = false) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    if (isHead) mesh.userData.isHead = true;
    g.add(mesh); hitParts.push(mesh);
    return mesh;
  };
  part(new THREE.SphereGeometry(.18, 14, 12), skin, 0, 1.76, 0, true);
  part(new THREE.BoxGeometry(.48, .60, .24), skin, 0, 1.20, 0);
  part(new THREE.BoxGeometry(.42, .15, .22), skin, 0, .825, 0);
  for (const s of [-1, 1]) {
    part(new THREE.BoxGeometry(.12, .36, .12), skin, s * .30, 1.32, 0);
    part(new THREE.BoxGeometry(.10, .34, .10), skin, s * .30, .97, 0);
    part(new THREE.BoxGeometry(.15, .40, .15), skin, s * .11, .55, 0);
    part(new THREE.BoxGeometry(.13, .35, .13), skin, s * .11, .175, 0);
  }
  return { group: g, hitParts };
}

function buildFlag(color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x888888 }));
  pole.position.y = 1.1; g.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.8, .5),
    new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, emissive: color, emissiveIntensity: .3 }));
  cloth.position.set(.42, 1.85, 0); g.add(cloth);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.6, .7, .1, 20),
    new THREE.MeshStandardMaterial({ color: 0x1a2540, roughness: .8 }));
  base.position.y = .05; g.add(base);
  return g;
}

/* ===== LOBBY 3D PREVIEW ===== */
class LobbyPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, .1, 50);
    this.camera.position.set(0, 1.15, 3.4);
    this.camera.lookAt(0, 1.05, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445577, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.8); key.position.set(2, 4, 3); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x44d7ff, 2); rim.position.set(-3, 2, -3); this.scene.add(rim);
    this.model = null; this.running = true;
    this._loop = this._loop.bind(this);
    this._loop();
  }
  setColor(hex) {
    if (this.model) { this.scene.remove(this.model); disposeGroup(this.model); }
    const { group } = buildHumanoid(hex);
    this.model = group;
    this.scene.add(group);
  }
  _loop() {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const t = performance.now() / 1000;
    if (this.model) this.model.rotation.y = t * .7;
    this.renderer.render(this.scene, this.camera);
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }
  dispose() {
    this.running = false;
    if (this.model) disposeGroup(this.model);
    this.renderer.dispose();
  }
}

/* ===== WORLD ===== */
function initWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ed9f5);
  scene.fog = new THREE.Fog(0x8ed9f5, 40, 90);

  camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, .1, 120);
  camera.rotation.order = 'YXZ';

  renderer = new THREE.WebGLRenderer({ antialias: !touch, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.2 : 1.6));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  $('game-root').appendChild(renderer.domElement);

  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();

  scene.add(new THREE.HemisphereLight(0xd9f4ff, 0x43506d, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-12, 25, 15);
  scene.add(sun);
  if (!touch) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 80 });
  }

  box(50, .5, 50, new THREE.MeshStandardMaterial({ color: 0x263653, roughness: .8 }), 0, -.25, 0);
  const grid = new THREE.GridHelper(50, 50, 0x48c9e8, 0x435b7a);
  grid.position.y = .01; scene.add(grid);

  const blue = new THREE.MeshStandardMaterial({ color: 0x168bd3, roughness: .8 });
  const wallM = new THREE.MeshStandardMaterial({ color: 0x19243d, roughness: .9 });

  box(50, 2, .8, wallM, 0, 1, -25);
  box(50, 2, .8, wallM, 0, 1, 25);
  box(.8, 2, 50, wallM, -25, 1, 0);
  box(.8, 2, 50, wallM, 25, 1, 0);

  box(6, .2, 12, blue, -21, .1, 0);
  box(6, .2, 12, new THREE.MeshStandardMaterial({ color: 0xd93258, roughness: .8 }), 21, .1, 0);

  const coverDefs = [
    [-8, -6, 3, 2, 2], [-8, 6, 3, 2, 2], [8, -6, 3, 2, 2], [8, 6, 3, 2, 2],
    [0, -10, 2, 2.5, 2], [0, 10, 2, 2.5, 2],
    [-14, 0, 2, 1.8, 4], [14, 0, 2, 1.8, 4],
    [-4, 0, 2.5, 1.6, 2.5], [4, 0, 2.5, 1.6, 2.5],
  ];
  for (const [x, z, w, h, d] of coverDefs) {
    const m = box(w, h, d, blue, x, h / 2, z);
    wallMeshes.push(m);
    covers.push({ x, z, w, d });
  }

  flags.blue = { mesh: buildFlag(0x44d7ff), basePos: new THREE.Vector3(-21, 0, 0), carrier: null, team: 'blue' };
  flags.red = { mesh: buildFlag(0xff4c73), basePos: new THREE.Vector3(21, 0, 0), carrier: null, team: 'red' };
  flags.blue.mesh.position.copy(flags.blue.basePos);
  flags.red.mesh.position.copy(flags.red.basePos);
  scene.add(flags.blue.mesh, flags.red.mesh);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    if (lobbyPreview) lobbyPreview.resize();
  });
}

/* ===== REMOTE REAL PLAYERS ===== */
function addPlayer(id, name, irId, team) {
  if (players.has(id) || id === localId) return;
  const color = team === 'blue' ? 0x44d7ff : 0xff4c73;
  const { group, hitParts } = buildHumanoid(color);
  scene.add(group);
  const label = document.createElement('div');
  label.className = 'name-tag ' + team;
  label.innerHTML = `<div class="tag-name">${escapeHtml(name)}</div><div class="tag-ir">${escapeHtml(irId)}</div>`;
  $('name-tags').appendChild(label);
  players.set(id, {
    id, name, irId, team, group, hitParts, label,
    pos: new THREE.Vector3(team === 'blue' ? -20 : 20, 0, 0),
    targetPos: new THREE.Vector3(team === 'blue' ? -20 : 20, 0, 0),
    yaw: 0, pitch: 0, hp: 100, alive: true, hasFlag: null,
  });
}
function removePlayer(id) {
  const p = players.get(id);
  if (!p) return;
  disposeGroup(p.group); scene.remove(p.group);
  p.label.remove();
  players.delete(id);
}

/* ===== BOTS ===== */
function addBot(name, team) {
  const color = team === 'blue' ? 0x44d7ff : 0xff4c73;
  const { group, hitParts } = buildHumanoid(color);
  const baseX = team === 'blue' ? -20 : 20;
  const baseZ = rand(-4, 4);
  group.position.set(baseX, 0, baseZ);
  scene.add(group);
  const label = document.createElement('div');
  label.className = 'name-tag ' + team;
  label.innerHTML = `<div class="tag-name">${escapeHtml(name)}</div><div class="tag-ir">BOT</div>`;
  $('name-tags').appendChild(label);
  const bot = {
    isBot: true,
    id: 'bot_' + Math.random().toString(36).slice(2, 8),
    name, team, group, hitParts, label,
    hp: 100, alive: true,
    yaw: 0,
    targetPos: new THREE.Vector3(baseX, 0, baseZ),
    baseX, baseZ,
    state: 'idle',
    stateTimer: 0,
    fireTimer: rand(1, 3),
    respawnTimer: 0,
    carrying: null,
  };
  bots.push(bot);
  return bot;
}

function removeAllBots() {
  for (const b of bots) {
    disposeGroup(b.group); scene.remove(b.group);
    b.label.remove();
  }
  bots.length = 0;
}

function getBotTargetPos(bot) {
  const diff = DIFFICULTY[practiceDifficulty];
  // Priority: if carrying enemy flag → run home
  if (bot.carrying) {
    return new THREE.Vector3(bot.team === 'blue' ? -21 : 21, 0, 0);
  }
  // If own team flag stolen → chase carrier
  const ownFlag = flags[bot.team];
  if (ownFlag.carrier) {
    const carrier = findEntityById(ownFlag.carrier);
    if (carrier) return new THREE.Vector3(carrier.group.position.x, 0, carrier.group.position.z);
  }
  // If enemy flag at base and we don't have it → chase it
  const enemyTeam = bot.team === 'blue' ? 'red' : 'blue';
  const enemyFlag = flags[enemyTeam];
  if (enemyFlag && !enemyFlag.carrier) {
    // Only half the bots chase the flag, others hunt
    if (Math.random() < 0.6) {
      return new THREE.Vector3(enemyFlag.mesh.position.x, 0, enemyFlag.mesh.position.z);
    }
  }
  // Hunt nearest enemy
  let nearest = null, bestDist = Infinity;
  for (const p of players.values()) {
    if (p.team === bot.team || !p.alive) continue;
    const d = p.group.position.distanceTo(bot.group.position);
    if (d < bestDist) { bestDist = d; nearest = p; }
  }
  if (id === localId) return bot.group.position.clone();
  // Check local player too
  if (alive && localTeam !== bot.team) {
    const d = Math.hypot(camera.position.x - bot.group.position.x, camera.position.z - bot.group.position.z);
    if (d < bestDist) { bestDist = d; nearest = { group: { position: camera.position }, isLocal: true }; }
  }
  if (nearest) return new THREE.Vector3(nearest.group.position.x, 0, nearest.group.position.z);
  // Idle wander
  return new THREE.Vector3(bot.baseX + rand(-5, 5), 0, bot.baseZ + rand(-5, 5));
}

function findEntityById(id) {
  if (id === localId) return { group: { position: camera.position }, isLocal: true, team: localTeam, alive };
  const p = players.get(id);
  if (p) return p;
  const b = bots.find(b => b.id === id);
  if (b) return b;
  return null;
}

function botFire(bot) {
  const diff = DIFFICULTY[practiceDifficulty];
  // Pick target: nearest enemy
  let target = null, bestDist = 30;
  const candidates = [];
  for (const p of players.values()) if (p.team !== bot.team && p.alive) candidates.push({ pos: p.group.position, isLocal: false });
  if (alive && localTeam !== bot.team) candidates.push({ pos: camera.position, isLocal: true });
  for (const c of candidates) {
    const d = Math.hypot(c.pos.x - bot.group.position.x, c.pos.z - bot.group.position.z);
    if (d < bestDist) { bestDist = d; target = c; }
  }
  if (!target) return;

  const tx = bot.group.position.x, tz = bot.group.position.z;
  const px = target.pos.x, pz = target.pos.z;
  // Add aim error based on accuracy
  const err = (1 - diff.accuracy) * 2;
  const ax = px + rand(-err, err), az = pz + rand(-err, err);
  const dx = ax - tx, dz = az - tz;
  const dist = Math.hypot(dx, dz) || 1;
  const vx = dx / dist * diff.projectileSpeed;
  const vz = dz / dist * diff.projectileSpeed;

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(.15, 8, 6),
    new THREE.MeshBasicMaterial({ color: bot.team === 'blue' ? 0x44d7ff : 0xff3060 })
  );
  mesh.position.set(tx, 1.2, tz);
  scene.add(mesh);
  practiceProjectiles.push({ mesh, vx, vz, life: 4, owner: bot.id, dmg: diff.dmg, team: bot.team });
}

function updateBots(dt, t) {
  const diff = DIFFICULTY[practiceDifficulty];

  for (const bot of bots) {
    if (!bot.alive) {
      bot.respawnTimer -= dt;
      if (bot.respawnTimer <= 0) {
        bot.alive = true;
        bot.hp = 100;
        bot.group.visible = true;
        bot.group.position.set(bot.baseX, 0, bot.baseZ);
        bot.carrying = null;
      }
      continue;
    }

    // Move toward target
    const target = getBotTargetPos(bot);
    const dx = target.x - bot.group.position.x;
    const dz = target.z - bot.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1.5) {
      const step = Math.min(diff.speed * dt, dist);
      const nx = bot.group.position.x + (dx / dist) * step;
      const nz = bot.group.position.z + (dz / dist) * step;
      const blocked = covers.some(c =>
        Math.abs(nx - c.x) < c.w / 2 + .38 && Math.abs(nz - c.z) < c.d / 2 + .38);
      if (!blocked) {
        bot.group.position.x = nx;
        bot.group.position.z = nz;
      }
    }
    bot.yaw = Math.atan2(-dx, -dz);
    bot.group.rotation.y = bot.yaw;

    // Fire timer
    bot.fireTimer -= dt;
    if (bot.fireTimer <= 0) {
      botFire(bot);
      bot.fireTimer = rand(diff.fireDelay[0], diff.fireDelay[1]);
    }

    // Flag pickup
    for (const team of ['blue', 'red']) {
      const f = flags[team];
      if (f.carrier || bot.team === team) continue;
      const fdx = bot.group.position.x - f.mesh.position.x;
      const fdz = bot.group.position.z - f.mesh.position.z;
      if (fdx * fdx + fdz * fdz < STEAL_RANGE * STEAL_RANGE) {
        f.carrier = bot.id;
        bot.carrying = team;
      }
    }

    // Treasure (carrying + at own base)
    if (bot.carrying) {
      const ownBaseX = bot.team === 'blue' ? -21 : 21;
      const bx = bot.group.position.x - ownBaseX;
      const bz = bot.group.position.z;
      if (bx * bx + bz * bz < TREASURE_RANGE * TREASURE_RANGE) {
        if (bot.team === 'blue') scoreBlue++; else scoreRed++;
        flags[bot.carrying].carrier = null;
        flags[bot.carrying].mesh.position.copy(flags[bot.carrying].basePos);
        bot.carrying = null;
        updateHud();
        if (scoreBlue >= CAPTURES_TO_WIN || scoreRed >= CAPTURES_TO_WIN) {
          endMatch(scoreBlue >= CAPTURES_TO_WIN ? 'blue' : 'red');
          return;
        }
      }
    }

    // Update name tag position
    const wp = new THREE.Vector3(bot.group.position.x, 2.3, bot.group.position.z);
    const sp = wp.clone().project(camera);
    if (sp.z < 1) {
      bot.label.style.left = (sp.x * .5 + .5) * innerWidth + 'px';
      bot.label.style.top = (-sp.y * .5 + .5) * innerHeight + 'px';
      bot.label.style.display = '';
    } else {
      bot.label.style.display = 'none';
    }

    // Flag follows carrier
    for (const team of ['blue', 'red']) {
      if (flags[team].carrier === bot.id) {
        flags[team].mesh.position.set(bot.group.position.x, 0, bot.group.position.z);
      }
    }
  }

  // Projectiles
  for (let i = practiceProjectiles.length - 1; i >= 0; i--) {
    const p = practiceProjectiles[i];
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.z += p.vz * dt;
    p.life -= dt;

    // Hit check against local player (if enemy team)
    if (p.team !== localTeam && alive && invulnT <= 0) {
      const dx = p.mesh.position.x - camera.position.x;
      const dz = p.mesh.position.z - camera.position.z;
      if (dx * dx + dz * dz < 1.2) {
        health = Math.max(0, health - p.dmg);
        invulnT = INVULN;
        cameraShake = Math.min(cameraShake + .4, .7);
        $('damage-vignette').classList.add('on');
        setTimeout(() => $('damage-vignette').classList.remove('on'), 200);
        updateHud();
        if (health <= 0) {
          alive = false;
          respawnTimer = RESPAWN;
          toast('KILLED');
        }
        scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
        practiceProjectiles.splice(i, 1); continue;
      }
    }

    // Hit check against bots (if from local player we don't track these; bots only fire at enemies)
    let hitBot = false;
    for (const b of bots) {
      if (!b.alive || b.team === p.team) continue;
      const dx = p.mesh.position.x - b.group.position.x;
      const dz = p.mesh.position.z - b.group.position.z;
      if (dx * dx + dz * dz < 1.2) {
        b.hp -= p.dmg;
        hitBot = true;
        if (b.hp <= 0) {
          b.alive = false;
          b.group.visible = false;
          b.respawnTimer = RESPAWN;
          b.carrying = null;
        }
        break;
      }
    }
    if (hitBot) {
      scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
      practiceProjectiles.splice(i, 1); continue;
    }

    if (p.life <= 0) {
      scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
      practiceProjectiles.splice(i, 1);
    }
  }
}

function clearBotsAndProjectiles() {
  removeAllBots();
  for (const p of practiceProjectiles) {
    scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
  }
  practiceProjectiles.length = 0;
}

/* ===== NET HANDLERS (real multiplayer) ===== */
function onMatchState(d) {
  const p = players.get(d.id);
  if (!p) return;
  p.targetPos.set(d.pos[0], d.pos[1], d.pos[2]);
  p.yaw = d.yaw; p.pitch = d.pitch;
  p.hp = d.hp; p.alive = d.alive; p.hasFlag = d.hasFlag;
  p.group.visible = d.alive;
}
function onShotFired(d) {
  const from = new THREE.Vector3(...d.from);
  const to = new THREE.Vector3(...d.to);
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8 }));
  scene.add(line);
  setTimeout(() => { scene.remove(line); geo.dispose(); line.material.dispose(); }, 80);
}
function onHitReceived(d) {
  if (d.target === localId) {
    if (!alive || invulnT > 0) return;
    health = Math.max(0, health - d.damage);
    invulnT = INVULN;
    cameraShake = Math.min(cameraShake + .4, .7);
    $('damage-vignette').classList.add('on');
    setTimeout(() => $('damage-vignette').classList.remove('on'), 200);
    updateHud();
    if (health <= 0) die(d.shooter, d.headshot);
  }
}
function onFlagUpdate(d) {
  if (d.type === 'capture' && isHost) {
    const f = flags[d.team];
    if (!f || f.carrier !== d.carrier) return;
    const carrier = players.get(d.carrier);
    if (!carrier || !carrier.alive) return;
    const ownBaseX = carrier.team === 'blue' ? -21 : 21;
    const dx = carrier.group.position.x - ownBaseX;
    const dz = carrier.group.position.z;
    if (dx * dx + dz * dz > TREASURE_RANGE * TREASURE_RANGE) return;
    if (carrier.team === 'blue') scoreBlue++; else scoreRed++;
    captures++;
    f.carrier = null;
    net.broadcastMatch('score', { scoreBlue, scoreRed });
    net.broadcastMatch('flag', { team: d.team, carrier: null, baseX: f.basePos.x, baseZ: f.basePos.z, scoreBlue, scoreRed });
    if (scoreBlue >= CAPTURES_TO_WIN || scoreRed >= CAPTURES_TO_WIN) endMatch(scoreBlue >= CAPTURES_TO_WIN ? 'blue' : 'red');
    return;
  }
  if (d.type === 'steal' && isHost) {
    const f = flags[d.team];
    if (!f || f.carrier) return;
    const stealer = players.get(d.stealer);
    if (!stealer || !stealer.alive || stealer.team === d.team) return;
    const dx = stealer.group.position.x - f.mesh.position.x;
    const dz = stealer.group.position.z - f.mesh.position.z;
    if (dx * dx + dz * dz > STEAL_RANGE * STEAL_RANGE) return;
    f.carrier = stealer.id;
    net.broadcastMatch('flag', { team: d.team, carrier: stealer.id, baseX: f.basePos.x, baseZ: f.basePos.z, scoreBlue, scoreRed });
    return;
  }
  const f = flags[d.team];
  if (!f) return;
  f.carrier = d.carrier;
  if (!d.carrier) f.mesh.position.set(d.baseX, 0, d.baseZ);
  scoreBlue = d.scoreBlue ?? scoreBlue;
  scoreRed = d.scoreRed ?? scoreRed;
  updateHud();
}
function onScoreUpdate(d) {
  scoreBlue = d.scoreBlue; scoreRed = d.scoreRed;
  updateHud();
  if (scoreBlue >= CAPTURES_TO_WIN || scoreRed >= CAPTURES_TO_WIN) endMatch(scoreBlue >= CAPTURES_TO_WIN ? 'blue' : 'red');
}
function onKillFeed(d) {
  killFeed(`${escapeHtml(d.killerName)} (${escapeHtml(d.killerIr || '')}) → ${escapeHtml(d.victimName)}${d.headshot ? ' 🎯' : ''}`);
}
function onMatchEnd(d) {
  endMatch(d.winner || (d.blueScore > d.redScore ? 'blue' : 'red'));
}

/* ===== GAME ACTIONS ===== */
function die(killerId, headshot) {
  alive = false; respawnTimer = RESPAWN; deaths++;
  for (const team of ['blue', 'red']) {
    if (flags[team]?.carrier === localId) {
      net.broadcastMatch('flag', { type: 'drop', team, carrier: localId });
    }
  }
  const killer = players.get(killerId);
  net.broadcastMatch('kill', {
    killer: killerId, killerName: killer?.name || '?', killerIr: killer?.irId || '',
    victim: localId, victimName: localName, headshot,
  });
  toast('YOU DIED — respawning…');
}
function respawn() {
  alive = true; health = 100; invulnT = INVULN * 2;
  const baseX = localTeam === 'blue' ? -20 : 20;
  camera.position.set(baseX, H, 0);
  yaw = localTeam === 'blue' ? -Math.PI / 2 : Math.PI / 2;
  pitch = 0;
  updateHud();
}

function shoot() {
  if (!running || paused || gameOver || !alive) return;
  const now = performance.now();
  if (now - lastShot < 180 || reloadT > 0) return;
  lastShot = now;
  if (ammo <= 0) { startReload(); return; }
  ammo--;
  recoil = Math.min(recoil + .06, .2);
  cameraShake = Math.min(cameraShake + .12, .35);
  const ch = $('crosshair');
  ch.classList.add('fired');
  setTimeout(() => ch.classList.remove('fired'), 60);
  updateHud();

  const from = camera.position.clone();
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));

  const candidates = [];
  if (practiceMode) {
    for (const b of bots) {
      if (b.alive && b.team !== localTeam) {
        b.hitParts.forEach(m => { m.userData.__bot = b; candidates.push(m); });
      }
    }
  } else {
    players.forEach(p => {
      if (p.team !== localTeam && p.alive) {
        p.hitParts.forEach(m => { m.userData.__pid = p.id; candidates.push(m); });
      }
    });
  }
  candidates.push(...wallMeshes);

  raycaster.set(from, dir);
  raycaster.far = 100;
  const hits = raycaster.intersectObjects(candidates, false);

  let end = from.clone().add(dir.clone().multiplyScalar(100));
  let hitInfo = null;

  if (hits.length) {
    const h = hits[0];
    end = h.point.clone();
    const isHead = h.object.userData.isHead === true;

    if (practiceMode) {
      const b = h.object.userData.__bot;
      if (b && b.alive) {
        const dmg = isHead ? 100 : 35;
        b.hp -= dmg;
        showHitMarker(isHead);
        if (isHead) headshots++;
        if (b.hp <= 0) {
          b.alive = false;
          b.group.visible = false;
          b.respawnTimer = RESPAWN;
          b.carrying = null;
          kills++;
          killFeed(isHead ? '🎯 HEADSHOT' : '💥 KILL');
        }
      }
    } else {
      const pid = h.object.userData.__pid;
      if (pid) {
        hitInfo = { id: pid, headshot: isHead };
        const dmg = isHead ? 100 : 35;
        net.broadcastMatch('hit', { target: pid, damage: dmg, headshot: isHead, shooter: localId });
        showHitMarker(isHead);
        if (isHead) headshots++;
      }
    }
  }

  if (!practiceMode) {
    net.broadcastMatch('shot', { shooter: localId, from: from.toArray(), to: end.toArray(), hit: hitInfo });
  }

  if (ammo === 0) startReload();
}

function showHitMarker(isHead) {
  $('hit').textContent = isHead ? '🎯' : '✕';
  $('hit').classList.toggle('headshot', isHead);
  $('hit').classList.add('show');
  setTimeout(() => $('hit').classList.remove('show'), 180);
}

function startReload() {
  if (reloadT > 0 || ammo === 12) return;
  reloadT = 1.15;
  toast('RELOADING…');
}
function tryDash() {
  if (!alive || dashCd > 0 || dashT > 0) return;
  let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - my;
  let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + mx;
  if (Math.abs(f) < .1 && Math.abs(s) < .1) { f = 1; s = 0; }
  const len = Math.hypot(f, s); f /= len; s /= len;
  dashDirX = -Math.sin(yaw) * f + Math.cos(yaw) * s;
  dashDirZ = -Math.cos(yaw) * f - Math.sin(yaw) * s;
  dashT = DASH_DUR; dashCd = DASH_CD;
}

/* ===== AIM LOCK (with LOS) ===== */
const losRay = new THREE.Raycaster();
function updateAimLock(dt) {
  if (!running || paused || gameOver) { aim.locked = null; return; }
  aim.locked = null;

  const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  let bestAngle = LOCK_CONE, bestRef = null;

  const checkTarget = (refId, x, z) => {
    const y = aim.lockPoint === 'head' ? 1.76 : 1.2;
    const dx = x - camera.position.x;
    const dz = z - camera.position.z;
    const dy = y - camera.position.y;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > LOCK_RANGE || dist < 0.5) return;
    const nx = dx / dist, ny = dy / dist, nz = dz / dist;
    const dot = forward.x * nx + forward.y * ny + forward.z * nz;
    const ang = Math.acos(clamp(dot, -1, 1));
    if (ang >= bestAngle) return;
    losRay.set(camera.position, new THREE.Vector3(nx, ny, nz));
    losRay.far = dist;
    if (losRay.intersectObjects(wallMeshes, false).length > 0) return;
    bestAngle = ang;
    bestRef = refId;
  };

  if (practiceMode) {
    for (const b of bots) {
      if (b.alive && b.team !== localTeam) checkTarget(b.id, b.group.position.x, b.group.position.z);
    }
  } else {
    players.forEach(p => {
      if (p.team !== localTeam && p.alive) checkTarget(p.id, p.group.position.x, p.group.position.z);
    });
  }

  if (bestRef) aim.locked = bestRef;

  if (aim.locked) {
    let tx = 0, tz = 0, tRef = null;
    if (practiceMode) {
      const b = bots.find(b => b.id === aim.locked);
      if (!b || !b.alive) { aim.locked = null; return; }
      tRef = b;
      tx = b.group.position.x; tz = b.group.position.z;
    } else {
      const p = players.get(aim.locked);
      if (!p || !p.alive) { aim.locked = null; return; }
      tRef = p;
      tx = p.group.position.x; tz = p.group.position.z;
    }

    const y = aim.lockPoint === 'head' ? 1.76 : 1.2;
    const dx = tx - camera.position.x;
    const dz = tz - camera.position.z;
    const dy = y - camera.position.y;
    const dist = Math.hypot(dx, dy, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.asin(clamp(dy / dist, -1, 1));
    const ddy = wrapAngle(wantYaw - yaw), ddp = wantPitch - pitch;
    const drift = Math.hypot(ddy, ddp);
    const flickingUp = aim.upAccum > 30;

    losRay.set(camera.position, new THREE.Vector3(dx / dist, dy / dist, dz / dist));
    losRay.far = dist;
    const blocked = losRay.intersectObjects(wallMeshes, false).length > 0;

    if ((drift > DRIFT_BREAK && !flickingUp) || blocked) {
      aim.locked = null;
      aim.lockPoint = 'chest';
    } else {
      const pull = 1 - Math.exp(-dt * LOCK_PULL);
      yaw += ddy * pull * aim.assistStrength;
      pitch = clamp(pitch + ddp * pull * aim.assistStrength, -1.3, 1.3);
    }
  } else {
    aim.lockPoint = 'chest';
  }

  if (aim.headCd > 0) aim.headCd -= dt;
  if (aim.upWin > 0) {
    aim.upWin -= dt;
    if (aim.upWin <= 0) aim.upAccum = 0;
  }
  if (aim.locked && aim.lockPoint === 'chest' && aim.headCd <= 0 && aim.upAccum > HEAD_ACCUM) {
    aim.lockPoint = 'head';
    aim.headCd = HEAD_CD;
    aim.upAccum = 0;
  }

  const ch = $('crosshair');
  if (ch) {
    ch.classList.toggle('locked', !!aim.locked);
    ch.classList.toggle('headlock', aim.lockPoint === 'head' && !!aim.locked);
    ch.classList.toggle('snap-ready', !!aim.locked && aim.lockPoint === 'chest' && aim.headCd <= 0);
  }
}

/* ===== FLAG LOGIC (HOST for real matches) ===== */
let flagTick = 0;
function hostFlagLogic(dt) {
  if (!isHost || practiceMode || !running) return;
  flagTick += dt;
  if (flagTick < 0.1) return;
  flagTick = 0;
  for (const team of ['blue', 'red']) {
    const f = flags[team];
    if (!f.carrier) continue;
    const carrier = players.get(f.carrier);
    if (!carrier || !carrier.alive) {
      f.carrier = null;
      net.broadcastMatch('flag', { team, carrier: null, baseX: f.basePos.x, baseZ: f.basePos.z, scoreBlue, scoreRed });
      continue;
    }
    f.mesh.position.set(carrier.group.position.x, 0, carrier.group.position.z);
  }
}

/* ===== MATCH FLOW ===== */
function endMatch(winner) {
  if (gameOver) return;
  gameOver = true;
  running = false;
  document.exitPointerLock?.();
  $('go-title').textContent = winner === 'blue' ? 'BLUE WINS' : 'RED WINS';
  $('go-title').className = winner === localTeam ? 'win' : 'lose';
  $('go-blue').textContent = scoreBlue;
  $('go-red').textContent = scoreRed;
  $('gameover').classList.remove('hidden');
  $('hud').classList.add('hidden');
  if (net.user && !practiceMode) {
    net.recordStats(matchId, [{
      user_id: net.user.id, display_name: localName, ir_id: localIrId,
      team: localTeam, kills, deaths, captures, headshots,
    }]).catch(() => {});
  }
}

function leaveMatch() {
  running = false; gameOver = true; paused = false;
  if (practiceMode) {
    clearBotsAndProjectiles();
  } else {
    net.cleanup().catch(() => {});
    for (const id of Array.from(players.keys())) removePlayer(id);
  }
  $('hud').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('gameover').classList.add('hidden');
  $('mobile').classList.add('hidden');
  $('steal-btn').classList.add('hidden');
  $('treasure-btn').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  document.exitPointerLock?.();
  practiceMode = false;
  if (!lobbyPreview) {
    lobbyPreview = new LobbyPreview($('lobby-canvas'));
    lobbyPreview.setColor(COLORS[playerColorKey].hex);
    requestAnimationFrame(() => lobbyPreview.resize());
  }
}

/* ===== STEAL / TREASURE ===== */
function doSteal() {
  const enemyTeam = localTeam === 'blue' ? 'red' : 'blue';
  const f = flags[enemyTeam];
  if (!f || f.carrier) return;
  const dx = camera.position.x - f.mesh.position.x;
  const dz = camera.position.z - f.mesh.position.z;
  if (dx * dx + dz * dz > STEAL_RANGE * STEAL_RANGE) return;
  if (practiceMode) {
    f.carrier = localId;
    toast('FLAG STOLEN');
  } else {
    net.broadcastMatch('flag', { type: 'steal', team: enemyTeam, stealer: localId });
    toast('STEALING…');
  }
}
function doTreasure() {
  const enemyTeam = localTeam === 'blue' ? 'red' : 'blue';
  const f = flags[enemyTeam];
  if (!f || f.carrier !== localId) return;
  const baseX = localTeam === 'blue' ? -21 : 21;
  const dx = camera.position.x - baseX;
  const dz = camera.position.z;
  if (dx * dx + dz * dz > TREASURE_RANGE * TREASURE_RANGE) return;
  if (practiceMode) {
    if (localTeam === 'blue') scoreBlue++; else scoreRed++;
    f.carrier = null;
    f.mesh.position.copy(f.basePos);
    captures++;
    toast('TREASURED!');
    updateHud();
    if (scoreBlue >= CAPTURES_TO_WIN || scoreRed >= CAPTURES_TO_WIN) {
      endMatch(scoreBlue >= CAPTURES_TO_WIN ? 'blue' : 'red');
    }
  } else {
    net.broadcastMatch('flag', { type: 'capture', team: enemyTeam, carrier: localId });
    toast('TREASURING…');
  }
}

function updateFlagButtons() {
  if (!running || paused || gameOver) {
    $('steal-btn').classList.add('hidden');
    $('treasure-btn').classList.add('hidden');
    return;
  }
  const enemyTeam = localTeam === 'blue' ? 'red' : 'blue';
  const ef = flags[enemyTeam];
  let showSteal = false, showTreasure = false;

  if (ef && !ef.carrier && alive) {
    const dx = camera.position.x - ef.mesh.position.x;
    const dz = camera.position.z - ef.mesh.position.z;
    if (dx * dx + dz * dz <= STEAL_RANGE * STEAL_RANGE) showSteal = true;
  }
  if (ef && ef.carrier === localId && alive) {
    const baseX = localTeam === 'blue' ? -21 : 21;
    const dx = camera.position.x - baseX;
    const dz = camera.position.z;
    if (dx * dx + dz * dz <= TREASURE_RANGE * TREASURE_RANGE) showTreasure = true;
  }
  $('steal-btn').classList.toggle('hidden', !showSteal);
  $('treasure-btn').classList.toggle('hidden', !showTreasure);
}

/* ===== HUD ===== */
function updateHud() {
  $('health').textContent = Math.ceil(health);
  $('healthbar').style.width = health + '%';
  $('ammo').innerHTML = ammo + ' <em>/ 12</em>';
  $('score-blue').textContent = scoreBlue;
  $('score-red').textContent = scoreRed;
  const m = Math.floor(Math.max(0, roundTime) / 60);
  const s = Math.floor(Math.max(0, roundTime) % 60).toString().padStart(2, '0');
  const timerEl = $('timer');
  timerEl.textContent = practiceMode ? '∞' : `${m}:${s}`;
  timerEl.classList.toggle('low', !practiceMode && roundTime < 30);
  $('damage-vignette').classList.toggle('low-health', health > 0 && health < 25);
}
function toast(s) {
  $('toast').textContent = s;
  setTimeout(() => { if ($('toast').textContent === s) $('toast').textContent = ''; }, 1400);
}
function killFeed(text) {
  const feed = $('killfeed');
  const el = document.createElement('div');
  el.className = 'feed-item'; el.textContent = text;
  feed.appendChild(el);
  while (feed.children.length > 5) feed.firstChild.remove();
  setTimeout(() => el.classList.add('out'), 1800);
  setTimeout(() => el.remove(), 2400);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ===== INPUT ===== */
function bindInput() {
  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyR') startReload();
    if (e.code === 'KeyE') doSteal();
    if (e.code === 'KeyQ') doTreasure();
    if (e.code === 'Space' && !e.repeat) jump = true;
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) tryDash();
    if (e.code === 'Escape' && running) { paused = !paused; $('pause').classList.toggle('hidden', !paused); }
  });
  document.addEventListener('keyup', e => keys[e.code] = false);

  renderer.domElement.addEventListener('pointerdown', e => {
    if (!running || paused) return;
    if (!document.fullscreenElement) lockLandscape();
    if (!touch) {
      fire = true;
      if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock?.();
    } else if (e.clientX > innerWidth * .42) {
      aimId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    }
  });
  document.addEventListener('pointerup', () => { if (!touch) fire = false; });
  document.addEventListener('pointercancel', () => { if (!touch) fire = false; });
  addEventListener('blur', () => {
    fire = false; jump = false;
    Object.keys(keys).forEach(k => delete keys[k]);
  });

  document.addEventListener('mousemove', e => {
    if (running && !paused && !touch && document.pointerLockElement === renderer.domElement) {
      const sens = .0022 * aim.sensitivity;
      yaw -= e.movementX * sens;
      pitch = clamp(pitch - e.movementY * sens, -1.3, 1.3);
      if (aim.locked && aim.lockPoint === 'chest' && e.movementY < 0) {
        aim.upAccum += -e.movementY;
        aim.upWin = .15;
      }
    }
  });

  renderer.domElement.addEventListener('pointermove', e => {
    if (touch && e.pointerId === aimId) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      const sens = .006 * aim.sensitivity;
      yaw -= dx * sens;
      pitch = clamp(pitch - dy * sens, -1.2, 1.2);
      lastX = e.clientX; lastY = e.clientY;
      if (aim.locked && aim.lockPoint === 'chest' && dy < 0) {
        aim.upAccum += -dy;
        aim.upWin = .15;
      }
    }
  });
  const stopAim = e => { if (e.pointerId === aimId) aimId = null; };
  renderer.domElement.addEventListener('pointerup', stopAim);
  renderer.domElement.addEventListener('pointercancel', stopAim);

  const zone = $('joy-zone'), base = $('joy-base'), knob = $('joy-knob');
  zone.addEventListener('pointerdown', e => {
    if (!running || paused) return;
    joyId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    joystickMove(e, base, knob);
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId === joyId) joystickMove(e, base, knob); });
  const stopJoy = e => { if (e.pointerId === joyId) { joyId = null; mx = my = 0; knob.style.transform = 'translate(0,0)'; } };
  zone.addEventListener('pointerup', stopJoy);
  zone.addEventListener('pointercancel', stopJoy);

  const fireBtn = $('fire-btn');
  fireBtn.addEventListener('pointerdown', e => { e.preventDefault(); fire = true; try { fireBtn.setPointerCapture(e.pointerId); } catch (_) {} });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => fireBtn.addEventListener(t, () => fire = false));

  $('jump-btn').addEventListener('pointerdown', e => { e.preventDefault(); jump = true; });
  $('reload-btn').addEventListener('pointerdown', e => { e.preventDefault(); startReload(); });
  $('dash-btn').addEventListener('pointerdown', e => { e.preventDefault(); tryDash(); });
  $('steal-btn').addEventListener('click', doSteal);
  $('treasure-btn').addEventListener('click', doTreasure);
  $('pause-btn').addEventListener('click', () => { paused = true; $('pause').classList.remove('hidden'); document.exitPointerLock?.(); });
  $('resume-btn').addEventListener('click', () => { paused = false; $('pause').classList.add('hidden'); if (!touch) renderer.domElement.requestPointerLock?.(); });
  $('leave-match-btn').addEventListener('click', () => leaveMatch());
  $('go-lobby').addEventListener('click', () => leaveMatch());
}

function joystickMove(e, b, k) {
  const r = b.getBoundingClientRect();
  let x = e.clientX - (r.left + r.width / 2);
  let y = e.clientY - (r.top + r.height / 2);
  const l = Math.hypot(x, y) || 1;
  if (l > 42) { x = x / l * 42; y = y / l * 42; }
  mx = x / 42; my = y / 42;
  k.style.transform = `translate(${x}px,${y}px)`;
}

/* ===== UPDATE ===== */
function update(dt, t) {
  if (!running || paused || gameOver) return;

  if (!practiceMode) {
    roundTime -= dt;
    if (roundTime <= 0) { roundTime = 0; endMatch(scoreBlue > scoreRed ? 'blue' : 'red'); return; }
  }

  if (!alive) {
    respawnTimer -= dt;
    if (respawnTimer <= 0) respawn();
  }

  if (alive) {
    let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - my;
    let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + mx;
    const len = Math.hypot(f, s) || 1;
    f /= Math.max(1, len); s /= Math.max(1, len);
    const hitWall = (x, z) => covers.some(c =>
      Math.abs(x - c.x) < c.w / 2 + .38 && Math.abs(z - c.z) < c.d / 2 + .38);

    if (dashT > 0) {
      dashT -= dt;
      const nx = clamp(camera.position.x + dashDirX * DASH_SPEED * dt, -24, 24);
      const nz = clamp(camera.position.z + dashDirZ * DASH_SPEED * dt, -24, 24);
      if (!hitWall(nx, camera.position.z)) camera.position.x = nx;
      if (!hitWall(camera.position.x, nz)) camera.position.z = nz;
    } else {
      const nx = clamp(camera.position.x + (-Math.sin(yaw) * f + Math.cos(yaw) * s) * SPEED * dt, -24, 24);
      const nz = clamp(camera.position.z + (-Math.cos(yaw) * f - Math.sin(yaw) * s) * SPEED * dt, -24, 24);
      if (!hitWall(nx, camera.position.z)) camera.position.x = nx;
      if (!hitWall(camera.position.x, nz)) camera.position.z = nz;
    }
    if (dashCd > 0) dashCd -= dt;

    if (jump && onGround) { vy = 6.5; onGround = false; }
    jump = false;
    vy -= 18 * dt;
    camera.position.y += vy * dt;
    if (camera.position.y <= H) { camera.position.y = H; vy = 0; onGround = true; }
  }

  if (recoil > 0) recoil = Math.max(0, recoil - dt * .4);
  if (invulnT > 0) invulnT -= dt;

  updateAimLock(dt);

  if (cameraShake > 0) {
    cameraShake = Math.max(0, cameraShake - dt * 1.8);
    shakeX = (Math.random() - .5) * cameraShake * .04;
    shakeY = (Math.random() - .5) * cameraShake * .04;
  } else { shakeX = shakeY = 0; }
  camera.rotation.set(pitch + recoil + shakeY, yaw + shakeX, 0, 'YXZ');

  if (fire && alive) shoot();

  if (reloadT > 0) {
    reloadT -= dt;
    if (reloadT <= 0) { ammo = 12; updateHud(); toast('RELOADED'); }
  }

  // Update real remote players
  for (const p of players.values()) {
    p.group.position.lerp(p.targetPos, Math.min(1, dt * 10));
    p.group.rotation.y = p.yaw;
    const wp = new THREE.Vector3(p.group.position.x, 2.3, p.group.position.z);
    const sp = wp.clone().project(camera);
    if (sp.z < 1) {
      p.label.style.left = (sp.x * .5 + .5) * innerWidth + 'px';
      p.label.style.top = (-sp.y * .5 + .5) * innerHeight + 'px';
      p.label.style.display = '';
    } else {
      p.label.style.display = 'none';
    }
    if (flags.blue?.carrier === p.id) flags.blue.mesh.position.set(p.group.position.x, 0, p.group.position.z);
    if (flags.red?.carrier === p.id) flags.red.mesh.position.set(p.group.position.x, 0, p.group.position.z);
  }

  if (practiceMode) {
    updateBots(dt, t);
    // Local flag follow
    for (const team of ['blue', 'red']) {
      if (flags[team].carrier === localId) {
        flags[team].mesh.position.set(camera.position.x, 0, camera.position.z);
      }
    }
  } else {
    hostFlagLogic(dt);
    if (flags.blue?.carrier === localId) flags.blue.mesh.position.set(camera.position.x, 0, camera.position.z);
    if (flags.red?.carrier === localId) flags.red.mesh.position.set(camera.position.x, 0, camera.position.z);
  }

  if (!practiceMode) {
    stateBroadcastTimer += dt;
    if (stateBroadcastTimer > 1 / BROADCAST_HZ) {
      stateBroadcastTimer = 0;
      net.broadcastMatch('state', {
        id: localId,
        pos: [camera.position.x, camera.position.y, camera.position.z],
        yaw, pitch, hp: health, alive,
        hasFlag: flags.blue?.carrier === localId ? 'blue' : (flags.red?.carrier === localId ? 'red' : null),
      });
    }
  }

  const moving = Math.hypot(mx, my) > .15 || keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD;
  const gap = 3 + (moving ? 3 : 1) + recoil * 40;
  document.documentElement.style.setProperty('--cross-gap', gap.toFixed(1) + 'px');

  updateFlagButtons();
  updateHud();
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), .04);
  if (scene && renderer && camera) {
    update(dt, clock.elapsedTime);
    renderer.render(scene, camera);
  }
}

/* ===== MATCH START ===== */
function enterMatch(match, allPlayers) {
  lockLandscape();
  matchId = match.id;
  matchMode = match.mode || 'standard';
  currentMatchTime = MODES[matchMode].matchTime;
  roundTime = currentMatchTime;
  scoreBlue = match.blue_score || 0;
  scoreRed = match.red_score || 0;
  gameOver = false; practiceMode = false;
  kills = deaths = captures = headshots = 0;

  $('lobby').classList.add('hidden');
  $('room').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (touch) $('mobile').classList.remove('hidden');

  for (const id of Array.from(players.keys())) removePlayer(id);

  let myTeam = 'blue';
  for (const p of allPlayers) {
    if (p.user_id === localId) { myTeam = p.team; continue; }
    addPlayer(p.user_id, p.display_name, p.ir_id || '', p.team);
  }
  localTeam = myTeam;

  flags.blue.mesh.position.copy(flags.blue.basePos);
  flags.red.mesh.position.copy(flags.red.basePos);
  flags.blue.carrier = flags.red.carrier = null;

  const baseX = localTeam === 'blue' ? -20 : 20;
  camera.position.set(baseX, H, 0);
  yaw = localTeam === 'blue' ? -Math.PI / 2 : Math.PI / 2;
  pitch = 0;
  health = 100; alive = true; ammo = 12; reloadT = 0; invulnT = 1;

  net.subscribeMatch(matchId, {
    onState: onMatchState, onShot: onShotFired, onHit: onHitReceived,
    onFlag: onFlagUpdate, onScore: onScoreUpdate, onKill: onKillFeed, onEnd: onMatchEnd,
    onJoined: () => { running = true; if (!touch) renderer.domElement.requestPointerLock?.(); },
  });
  updateHud();
}

function enterPractice() {
  lockLandscape();
  practiceMode = true;
  gameOver = false; running = true; paused = false;
  matchId = null;
  localTeam = 'blue';
  scoreBlue = scoreRed = 0;
  kills = deaths = captures = headshots = 0;

  $('lobby').classList.add('hidden');
  $('room').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (touch) $('mobile').classList.remove('hidden');

  clearBotsAndProjectiles();

  // 2 blue teammates + 3 red enemies
  addBot('Blue 1', 'blue');
  addBot('Blue 2', 'blue');
  addBot('Red 1', 'red');
  addBot('Red 2', 'red');
  addBot('Red 3', 'red');

  // Reset flags
  flags.blue.mesh.position.copy(flags.blue.basePos);
  flags.red.mesh.position.copy(flags.red.basePos);
  flags.blue.carrier = flags.red.carrier = null;

  camera.position.set(-20, H, 0);
  yaw = -Math.PI / 2; pitch = 0;
  health = 100; alive = true; ammo = 12; reloadT = 0; invulnT = 1;

  updateHud();
  if (!touch) renderer.domElement.requestPointerLock?.();
}

/* ===== LOBBY ===== */
function showLobby() {
  running = false; gameOver = true; paused = false;
  $('lobby').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('gameover').classList.add('hidden');

  $('sens-slider').value = aim.sensitivity;
  $('sens-val').textContent = aim.sensitivity.toFixed(1);
  $('assist-slider').value = Math.round(aim.assistStrength * 100);
  $('assist-val').textContent = Math.round(aim.assistStrength * 100) + '%';
  $('vol-slider').value = Math.round((+(localStorage.getItem('rivals-vol') || 50)));
  $('vol-val').textContent = $('vol-slider').value + '%';
  $('lobby-name').textContent = `${localName} · ${localIrId}`;
  document.querySelectorAll('.mode-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.mode === gameMode));
  $('mode-desc').textContent = MODES[gameMode].desc;
  $('practice-panel').classList.toggle('hidden', gameMode !== 'practice');
  $('match-panel').classList.toggle('hidden', gameMode === 'practice');
  document.querySelectorAll('.swatch').forEach(b => b.classList.toggle('active', b.dataset.color === playerColorKey));
  $('color-name').textContent = COLORS[playerColorKey].name;
  document.querySelectorAll('.diff-tab').forEach(b => b.classList.toggle('active', b.dataset.diff === practiceDifficulty));

  if (!lobbyPreview) {
    lobbyPreview = new LobbyPreview($('lobby-canvas'));
    lobbyPreview.setColor(COLORS[playerColorKey].hex);
    requestAnimationFrame(() => lobbyPreview.resize());
  } else {
    lobbyPreview.setColor(COLORS[playerColorKey].hex);
    lobbyPreview.resize();
  }
}

function bindLobby() {
  $('lobby').addEventListener('pointerdown', () => { lockLandscape(); }, { once: true });

  document.querySelectorAll('.mode-tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      gameMode = btn.dataset.mode;
      document.querySelectorAll('.mode-tabs .tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('mode-desc').textContent = MODES[gameMode].desc;
      $('practice-panel').classList.toggle('hidden', gameMode !== 'practice');
      $('match-panel').classList.toggle('hidden', gameMode === 'practice');
    });
  });
  document.querySelectorAll('.diff-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      practiceDifficulty = btn.dataset.diff;
      document.querySelectorAll('.diff-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      playerColorKey = btn.dataset.color;
      localStorage.setItem('rivals-color', playerColorKey);
      document.querySelectorAll('.swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('color-name').textContent = COLORS[playerColorKey].name;
      if (lobbyPreview) lobbyPreview.setColor(COLORS[playerColorKey].hex);
    });
  });
  $('sens-slider').addEventListener('input', e => {
    aim.sensitivity = +e.target.value;
    localStorage.setItem('rivals-sens', aim.sensitivity);
    $('sens-val').textContent = aim.sensitivity.toFixed(1);
  });
  $('assist-slider').addEventListener('input', e => {
    aim.assistStrength = +e.target.value / 100;
    localStorage.setItem('rivals-assist', aim.assistStrength);
    $('assist-val').textContent = e.target.value + '%';
  });
  $('vol-slider').addEventListener('input', e => {
    localStorage.setItem('rivals-vol', e.target.value);
    $('vol-val').textContent = e.target.value + '%';
  });

  let teamSize = 3;
  document.querySelectorAll('.size-tab').forEach(t => {
    t.addEventListener('click', () => {
      teamSize = +t.dataset.size;
      document.querySelectorAll('.size-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
    });
  });

  $('btn-practice').addEventListener('click', enterPractice);
  $('btn-create').addEventListener('click', async () => {
    const r = await net.createRoom(teamSize, gameMode);
    if (!r.ok) return toast('Could not create room');
    showRoomUI();
  });
  $('btn-find').addEventListener('click', async () => {
    const r = await net.findMatch(teamSize, gameMode);
    if (!r.ok) return toast('No match available — try again');
    showRoomUI();
  });
  $('btn-join').addEventListener('click', () => $('join-row').classList.toggle('hidden'));
  $('btn-join-go').addEventListener('click', async () => {
    const code = $('join-code').value.trim().toUpperCase();
    if (!code) return;
    const r = await net.joinRoom(code);
    if (!r.ok) return toast(r.reason === 'not_found' ? 'Room not found' : 'Could not join');
    showRoomUI();
  });
  $('btn-leave').addEventListener('click', async () => {
    await net.leaveRoom();
    $('room').classList.add('hidden');
    $('lobby').classList.remove('hidden');
  });
  $('btn-ready').addEventListener('click', async () => {
    const me = (await net.client.from('room_players')
      .select('*').eq('room_id', net.room.id).eq('user_id', localId).maybeSingle()).data;
    await net.setReady(!me?.ready);
  });
  $('btn-start').addEventListener('click', async () => {
    const r = await net.startMatch();
    if (!r.ok) toast('Could not start');
    else enterMatch(r.match, r.players);
  });
  $('btn-logout').addEventListener('click', async () => {
    await net.logout();
    location.reload();
  });
}

function showRoomUI() {
  $('lobby').classList.add('hidden');
  $('room').classList.remove('hidden');
  $('room-code-display').textContent = net.room.code;
  net.subscribeRoom({
    onPlayers: renderRoomPlayers,
    onStart: data => enterMatch(data.match, data.players),
    onRoomClosed: () => {
      toast('Room closed');
      $('room').classList.add('hidden');
      $('lobby').classList.remove('hidden');
    },
  });
}

function renderRoomPlayers(list) {
  const cap = net.room.team_size;
  const blue = list.filter(p => p.team === 'blue');
  const red = list.filter(p => p.team === 'red');
  const row = p => `
    <li class="${p.ready ? 'ready' : ''}">
      <div><div>${escapeHtml(p.display_name)}</div><div style="font-size:10px;opacity:.6">${escapeHtml(p.ir_id || '')}</div></div>
      ${p.ready ? '<span class="badge">READY</span>' : ''}
    </li>`;
  $('room-players').innerHTML = `
    <div class="team-col blue"><h3>BLUE (${blue.length}/${cap})</h3><ul>${blue.map(row).join('') || '<li>—</li>'}</ul></div>
    <div class="team-col red"><h3>RED (${red.length}/${cap})</h3><ul>${red.map(row).join('') || '<li>—</li>'}</ul></div>`;
  const me = list.find(p => p.user_id === localId);
  const allReady = list.length === cap * 2 && list.every(p => p.ready);
  $('btn-ready').textContent = me?.ready ? 'UNREADY' : 'READY';
  if (net.isHost) {
    $('btn-start').classList.toggle('hidden', !allReady);
    $('btn-ready').classList.toggle('hidden', allReady);
  } else {
    $('btn-start').classList.add('hidden');
  }
}

/* ===== BOOT ===== */
async function boot() {
  const initRes = await net.init();
  if (!initRes.ok) {
    $('auth-gate').classList.remove('hidden');
    $('auth-msg').textContent = 'Please sign in on the main site first.';
    return;
  }
  localId = net.user.id;
  localName = net.displayName;
  localIrId = net.irId;

  $('auth-gate').classList.add('hidden');

  initWorld();
  bindInput();
  bindLobby();
  loop();
  showLobby();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }
}

boot();
