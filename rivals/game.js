import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

/* ============ UTILS ============ */
const $ = id => document.getElementById(id);
const touch = matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: .8 });

/* ============ AUDIO ENGINE ============ */
class AudioEngine {
  constructor() { this.ctx = null; this.master = null; }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }
  tone({ freq = 440, dur = 0.1, type = 'sine', vol = 0.3, slide = 0, delay = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  noise({ dur = 0.08, vol = 0.2, delay = 0, hp = 1000 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = vol;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = hp;
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }
  shot() { this.noise({ dur: 0.09, vol: 0.25, hp: 1200 }); this.tone({ freq: 180, dur: 0.06, type: 'square', vol: 0.18, slide: -120 }); }
  hit() { this.tone({ freq: 880, dur: 0.07, type: 'sine', vol: 0.2, slide: 400 }); }
  headshot() { this.tone({ freq: 1320, dur: 0.06, type: 'sine', vol: 0.22 }); this.tone({ freq: 1760, dur: 0.12, type: 'sine', vol: 0.18, delay: 0.05 }); }
  reload() { this.noise({ dur: 0.04, vol: 0.15, hp: 2000 }); this.noise({ dur: 0.05, vol: 0.15, hp: 2000, delay: 0.35 }); }
  hurt() { this.tone({ freq: 110, dur: 0.2, type: 'sawtooth', vol: 0.25, slide: -50 }); this.noise({ dur: 0.15, vol: 0.15, hp: 400 }); }
  pickup() { this.tone({ freq: 660, dur: 0.08, type: 'triangle', vol: 0.2 }); this.tone({ freq: 990, dur: 0.1, type: 'triangle', vol: 0.2, delay: 0.06 }); }
  enemyShot() { this.tone({ freq: 320, dur: 0.12, type: 'sawtooth', vol: 0.1, slide: -180 }); }
  dash() { this.noise({ dur: 0.15, vol: 0.15, hp: 800 }); }
  gameOver() { this.tone({ freq: 440, dur: 0.2, type: 'sine', vol: 0.25 }); this.tone({ freq: 330, dur: 0.2, type: 'sine', vol: 0.25, delay: 0.15 }); this.tone({ freq: 220, dur: 0.4, type: 'sine', vol: 0.25, delay: 0.3 }); }
  win() { this.tone({ freq: 523, dur: 0.12, type: 'sine', vol: 0.25 }); this.tone({ freq: 659, dur: 0.12, type: 'sine', vol: 0.25, delay: 0.1 }); this.tone({ freq: 784, dur: 0.12, type: 'sine', vol: 0.25, delay: 0.2 }); this.tone({ freq: 1046, dur: 0.3, type: 'sine', vol: 0.25, delay: 0.3 }); }
}
const audio = new AudioEngine();

/* ============ CONSTANTS ============ */
const H = 1.7;
const PLAYER_SPEED = 7.5;
const DASH_SPEED = 22;
const DASH_DURATION = 0.15;
const DASH_COOLDOWN = 1.5;
const ROUND_TIME = 120;
const COMBO_WINDOW = 3.0;
const REGEN_DELAY = 4.0;
const REGEN_RATE = 4.0;
const INVULN_TIME = 0.6;

/* ============ STATE ============ */
let scene, camera, renderer, clock, raycaster;
let started = false, running = false, gameOver = false;
let health = 100, ammo = 12, score = 0;
let reload = 0, toastTime = 0, hitTime = 0;
let yaw = 0, pitch = 0, vy = 0, onGround = true;
let mx = 0, my = 0, joyId = null, aimId = null;
let lastX = 0, lastY = 0, fire = false, lastShot = 0, jump = false;
let epoch = 0;
let roundTime = ROUND_TIME;
let lastDamage = 0;
let combo = 0, comboTimer = 0;
let totalShots = 0, totalHits = 0, headshots = 0;
let bestScore = +(localStorage.getItem('rivals-best') || 0);
let dashTimer = 0, dashCooldown = 0, dashDirX = 0, dashDirZ = 1;
let cameraShake = 0, shakePitch = 0, shakeYaw = 0, recoilPitch = 0;
let playerInvuln = 0;

const keys = {};
const targets = [], covers = [], wallMeshes = [], projectiles = [], pickups = [];

/* ============ HELPERS ============ */
function box(w, h, d, m, x, y, z) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  scene.add(o);
  return o;
}
function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) Array.isArray(o.material) ? o.material.forEach(m => m.dispose()) : o.material.dispose();
  });
}

/* ============ HUMANOID TARGET ============ */
function buildHumanoid(color) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: .05 });
  const bull = new THREE.MeshStandardMaterial({ color: 0xffe38b, emissive: 0xffe38b, emissiveIntensity: .5, roughness: .5 });
  const hitParts = [];

  const part = (geo, m, x, y, z, isHead = false) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    if (isHead) mesh.userData.isHead = true;
    g.add(mesh); hitParts.push(mesh);
    return mesh;
  };

  part(new THREE.SphereGeometry(0.18, 14, 12), skin, 0, 1.76, 0, true);
  part(new THREE.CylinderGeometry(.06, .07, .08, 8), skin, 0, 1.54, 0);
  part(new THREE.BoxGeometry(.48, .60, .24), skin, 0, 1.20, 0);
  const disc = part(new THREE.CylinderGeometry(.08, .08, .02, 16), bull, 0, 1.22, .13);
  disc.rotation.x = Math.PI / 2;
  part(new THREE.BoxGeometry(.42, .15, .22), skin, 0, .825, 0);
  for (const s of [-1, 1]) {
    part(new THREE.BoxGeometry(.12, .36, .12), skin, s * .30, 1.32, 0);
    part(new THREE.BoxGeometry(.10, .34, .10), skin, s * .30, .97, 0);
    part(new THREE.BoxGeometry(.10, .10, .10), skin, s * .30, .75, 0);
    part(new THREE.BoxGeometry(.15, .40, .15), skin, s * .11, .55, 0);
    part(new THREE.BoxGeometry(.13, .35, .13), skin, s * .11, .175, 0);
    part(new THREE.BoxGeometry(.15, .08, .22), skin, s * .11, .04, .04);
  }
  const frameMat = new THREE.LineBasicMaterial({ color: 0x44d7ff, transparent: true, opacity: .55 });
  const frameGeo = new THREE.BoxGeometry(1.10, 2.10, .70);
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(frameGeo), frameMat);
  frame.position.y = 1.05; frame.raycast = () => {};
  g.add(frame); frameGeo.dispose();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(.45, .50, .08, 20),
    new THREE.MeshStandardMaterial({ color: 0x0e1a2e, roughness: .9, metalness: .3 })
  );
  base.position.y = .04; base.castShadow = true; base.receiveShadow = true;
  base.raycast = () => {};
  g.add(base);

  return { group: g, hitParts, frame };
}

function findFreeSpot() {
  for (let i = 0; i < 60; i++) {
    const x = (Math.random() - .5) * 29;
    const z = (Math.random() - .5) * 24;
    const blocked = covers.some(c => Math.abs(x - c.x) < c.w / 2 + 1.8 && Math.abs(z - c.z) < c.d / 2 + 1.8);
    const nearStart = Math.hypot(x, z - 13) < 5;
    if (!blocked && !nearStart) return { x, z };
  }
  return { x: 0, z: -8 };
}

function newTarget() {
  const { group, hitParts, frame } = buildHumanoid(Math.random() < .5 ? 0xff3e69 : 0xff7aa0);
  const { x, z } = findFreeSpot();
  group.position.set(x, 0, z);
  group.userData = {
    x, z, p: rand(0, 6.28), r: rand(.5, 1.2), s: rand(.7, 1.7),
    alive: true, isTarget: true, hitParts, frame,
    nextShot: performance.now() / 1000 + rand(3, 8),
    flash: 0,
  };
  scene.add(group);
  return group;
}
function spawnTarget() { targets.push(newTarget()); }

/* ============ INIT WORLD ============ */
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ed9f5);
  scene.fog = new THREE.Fog(0x8ed9f5, 35, 78);

  camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, .1, 120);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, H, 13);

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
    Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 80 });
    sun.shadow.bias = -0.0005;
  }

  box(42, .5, 42, mat(0x263653), 0, -.25, 0);
  const grid = new THREE.GridHelper(42, 42, 0x48c9e8, 0x435b7a);
  grid.position.y = .01; scene.add(grid);

  const blue = mat(0x168bd3), red = mat(0xd93258), wall = mat(0x19243d);
  box(42, .7, .7, blue, 0, .35, -21);
  box(42, .7, .7, red, 0, .35, 21);
  box(.7, 2, 42, wall, -21, 1, 0);
  box(.7, 2, 42, wall, 21, 1, 0);

  [[-8, -5], [8, -5], [-8, 5], [8, 5], [0, -8], [0, 8], [-14, 0], [14, 0]].forEach((p, i) => {
    const w = i % 2 ? 2.8 : 2.2, d = i % 2 ? 2.2 : 2.8, h = i % 3 ? 1.7 : 2.5;
    const m = box(w, h, d, i % 2 ? blue : red, p[0], h / 2, p[1]);
    covers.push({ x: p[0], z: p[1], w, d });
    wallMeshes.push(m);
  });

  for (const [x, z, c] of [[-18, -15, 0x2d8ab9], [18, -15, 0x9b3f67], [-18, 15, 0x9b3f67], [18, 15, 0x2d8ab9]]) {
    wallMeshes.push(box(3, 4, 3, mat(c), x, 2, z));
    box(3.4, .2, 3.4, mat(0xf1f7ff), x, 4.1, z);
  }
  for (let x = -18; x <= 18; x += 6) {
    box(.14, .08, .14, mat(0xeaf5ff), x, .08, -18);
    box(.14, .08, .14, mat(0xeaf5ff), x, .08, 18);
  }

  for (let i = 0; i < 8; i++) spawnTarget();

  $('best-start').textContent = bestScore;

  bind();
  addEventListener('resize', resize);
}

/* ============ INPUT BINDING ============ */
function bind() {
  $('start-btn').onclick = start;
  $('pause-btn').onclick = pause;
  $('resume-btn').onclick = resume;
  $('restart-btn').onclick = restart;
  $('go-retry').onclick = restart;

  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyR') doReload();
    if (e.code === 'Escape' && started && !gameOver) running ? pause() : resume();
    if (e.code === 'Space' && !e.repeat) jump = true;
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) tryDash();
  });
  document.addEventListener('keyup', e => keys[e.code] = false);

  document.addEventListener('pointerlockchange', () => {
    if (!touch && running && !gameOver && !document.pointerLockElement) pause();
  });

  renderer.domElement.addEventListener('pointerdown', e => {
    if (!running) return;
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
    if (running && !touch && document.pointerLockElement === renderer.domElement) {
      yaw -= e.movementX * .0022;
      pitch = clamp(pitch - e.movementY * .0022, -1.3, 1.3);
    }
  });

  renderer.domElement.addEventListener('pointermove', e => {
    if (touch && e.pointerId === aimId) {
      yaw -= (e.clientX - lastX) * .006;
      pitch = clamp(pitch - (e.clientY - lastY) * .006, -1.2, 1.2);
      lastX = e.clientX; lastY = e.clientY;
    }
  });
  const stopAim = e => { if (e.pointerId === aimId) aimId = null; };
  renderer.domElement.addEventListener('pointerup', stopAim);
  renderer.domElement.addEventListener('pointercancel', stopAim);

  const zone = $('joy-zone'), base = $('joy-base'), knob = $('joy-knob');
  zone.addEventListener('pointerdown', e => {
    if (!running) return;
    joyId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    joy(e, base, knob);
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId === joyId) joy(e, base, knob); });
  const stopJoy = e => {
    if (e.pointerId === joyId) { joyId = null; mx = my = 0; knob.style.transform = 'translate(0,0)'; }
  };
  zone.addEventListener('pointerup', stopJoy);
  zone.addEventListener('pointercancel', stopJoy);

  const fireBtn = $('fire-btn');
  fireBtn.addEventListener('pointerdown', e => {
    e.preventDefault(); fire = true;
    try { fireBtn.setPointerCapture(e.pointerId); } catch (_) {}
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t =>
    fireBtn.addEventListener(t, () => fire = false));

  $('jump-btn').addEventListener('pointerdown', e => { e.preventDefault(); jump = true; });
  $('reload-btn')?.addEventListener('pointerdown', e => { e.preventDefault(); doReload(); });
  $('dash-btn')?.addEventListener('pointerdown', e => { e.preventDefault(); tryDash(); });

  $('resume-btn').addEventListener('click', async () => {
    if (!touch) return;
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (screen.orientation?.lock) await screen.orientation.lock('landscape');
    } catch (_) {}
  });
}

function joy(e, b, k) {
  const r = b.getBoundingClientRect();
  let x = e.clientX - (r.left + r.width / 2);
  let y = e.clientY - (r.top + r.height / 2);
  const l = Math.hypot(x, y) || 1;
  if (l > 42) { x = x / l * 42; y = y / l * 42; }
  mx = x / 42; my = y / 42;
  k.style.transform = `translate(${x}px,${y}px)`;
}

/* ============ STATE TRANSITIONS ============ */
function start() {
  audio.init();
  audio.ctx?.resume?.();
  started = running = true;
  $('start').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('gameover').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (touch) $('mobile').classList.remove('hidden');
  else renderer.domElement.requestPointerLock?.();
}

function pause() {
  if (!started || gameOver) return;
  running = false; fire = false;
  $('pause').classList.remove('hidden');
  $('pause-score').textContent = score;
  document.exitPointerLock?.();
}

function resume() {
  running = true;
  $('pause').classList.add('hidden');
  if (!touch) renderer.domElement.requestPointerLock?.();
}

function restart() {
  epoch++;
  targets.forEach(t => { disposeGroup(t); scene.remove(t); });
  targets.length = 0;
  projectiles.forEach(p => { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); });
  projectiles.length = 0;
  pickups.forEach(p => { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); });
  pickups.length = 0;

  score = 0; health = 100; ammo = 12; reload = 0;
  totalShots = 0; totalHits = 0; headshots = 0;
  combo = 0; comboTimer = 0;
  roundTime = ROUND_TIME;
  gameOver = false;
  lastDamage = 0; playerInvuln = 0;
  dashTimer = 0; dashCooldown = 0;
  cameraShake = 0; recoilPitch = 0;
  yaw = pitch = vy = 0;
  camera.position.set(0, H, 13);
  camera.fov = 76; camera.updateProjectionMatrix();
  onGround = true;

  for (let i = 0; i < 8; i++) spawnTarget();
  $('gameover').classList.add('hidden');
  $('combo').classList.add('hidden');
  $('killfeed').innerHTML = '';
  hud();
  start();
}

function endRound(win) {
  if (gameOver) return;
  running = false;
  gameOver = true;
  const accuracy = totalShots > 0 ? Math.round(totalHits / totalShots * 100) : 0;
  const newBest = Math.max(score, bestScore);
  if (score > bestScore) {
    bestScore = score;
    try { localStorage.setItem('rivals-best', bestScore); } catch (_) {}
  }
  $('go-title').textContent = win ? "TIME'S UP" : 'DEFEATED';
  $('go-title').className = win ? 'win' : 'lose';
  $('go-eyebrow').textContent = win ? 'ROUND COMPLETE' : 'YOU WERE DEFEATED';
  $('go-score').textContent = score;
  $('go-accuracy').textContent = accuracy + '%';
  $('go-headshots').textContent = headshots;
  $('go-best').textContent = newBest;
  $('gameover').classList.remove('hidden');
  $('hud').classList.add('hidden');
  if (win) audio.win(); else audio.gameOver();
  document.exitPointerLock?.();

  projectiles.forEach(p => { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); });
  projectiles.length = 0;
  pickups.forEach(p => { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); });
  pickups.length = 0;
}

/* ============ ACTIONS ============ */
function doReload() {
  if (!running || reload > 0 || ammo === 12 || gameOver) return;
  reload = 1.15;
  toast('RELOADING...');
  audio.reload();
}

function tryDash() {
  if (!running || gameOver || dashCooldown > 0 || dashTimer > 0) return;
  let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - my;
  let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + mx;
  if (Math.abs(f) < 0.1 && Math.abs(s) < 0.1) { f = 1; s = 0; }
  const len = Math.hypot(f, s);
  f /= len; s /= len;
  dashDirX = -Math.sin(yaw) * f + Math.cos(yaw) * s;
  dashDirZ = -Math.cos(yaw) * f - Math.sin(yaw) * s;
  dashTimer = DASH_DURATION;
  dashCooldown = DASH_COOLDOWN;
  audio.dash();
  camera.fov = 84; camera.updateProjectionMatrix();
}

function shoot() {
  if (!running || gameOver) return;
  const now = performance.now();
  if (now - lastShot < 180 || reload > 0) return;
  lastShot = now;
  if (ammo <= 0) { doReload(); return; }

  ammo--;
  totalShots++;
  audio.shot();
  cameraShake = Math.min(cameraShake + 0.15, 0.4);
  recoilPitch = Math.min(recoilPitch + 0.03, 0.09);

  const ch = $('crosshair');
  ch.classList.add('fired');
  setTimeout(() => ch.classList.remove('fired'), 60);

  raycaster.far = Infinity;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  const hittables = [...wallMeshes];
  targets.forEach(t => { if (t.userData.alive) t.userData.hitParts.forEach(m => hittables.push(m)); });

  const hits = raycaster.intersectObjects(hittables, false);
  if (hits.length) {
    const hitObj = hits[0].object;
    let node = hitObj;
    while (node && !node.userData.isTarget) node = node.parent;

    if (node && node.userData.alive) {
      const isHead = hitObj.userData.isHead === true;
      node.userData.alive = false;
      totalHits++;
      if (isHead) headshots++;

      combo++;
      comboTimer = COMBO_WINDOW;
      const mult = Math.min(combo, 10);
      const base = isHead ? 200 : 100;
      const gained = base * mult;
      score += gained;

      if (isHead) audio.headshot(); else audio.hit();
      cameraShake = Math.min(cameraShake + (isHead ? 0.25 : 0.15), 0.5);

      const pos = node.position.clone();
      disposeGroup(node);
      scene.remove(node);
      const idx = targets.indexOf(node);

      if (Math.random() < 0.15) spawnPickup(pos.x, pos.z);

      const label = (isHead ? '🎯 HEADSHOT' : '💥 KILL') + (mult > 1 ? ` ×${mult}` : '') + ` +${gained}`;
      killFeed(label);

      $('hit').textContent = isHead ? '🎯' : '✕';
      $('hit').classList.toggle('headshot', isHead);
      $('hit').classList.add('show');
      hitTime = 0.18;

      if (combo >= 2) {
        const c = $('combo');
        c.textContent = '×' + combo;
        c.style.animation = 'none';
        c.offsetHeight;
        c.style.animation = '';
        c.classList.remove('hidden');
      }

      const el = $('score');
      el.style.transform = 'scale(1.3)';
      el.style.transition = 'none';
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.2s ease';
        el.style.transform = 'scale(1)';
      });

      const myEpoch = epoch;
      setTimeout(() => {
        if (started && !gameOver && myEpoch === epoch && idx >= 0) {
          targets[idx] = newTarget();
          hud();
        }
      }, 800);
    }
  }

  hud();
  if (ammo === 0) doReload();
}

function damagePlayer(amount, sx, sz) {
  if (playerInvuln > 0 || gameOver) return;
  playerInvuln = INVULN_TIME;
  health = Math.max(0, health - amount);
  lastDamage = performance.now() / 1000;
  cameraShake = Math.min(cameraShake + 0.4, 0.7);
  audio.hurt();
  showDamageDir(sx, sz);

  const v = $('damage-vignette');
  v.classList.add('on');
  setTimeout(() => v.classList.remove('on'), 200);

  hud();
  if (health <= 0) endRound(false);
}

function showDamageDir(sx, sz) {
  const dx = sx - camera.position.x;
  const dz = sz - camera.position.z;
  const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const forward = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
  const angle = Math.atan2(right, forward);
  const abs = Math.abs(angle);
  let dir;
  if (abs < Math.PI / 4) dir = 'top';
  else if (abs > Math.PI * 3 / 4) dir = 'bottom';
  else dir = angle > 0 ? 'right' : 'left';
  const el = document.querySelector('#damage-ring .diag.' + dir);
  if (!el) return;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 350);
}

function spawnPickup(x, z) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.3, 0),
    new THREE.MeshBasicMaterial({ color: 0x52ffb1, transparent: true, opacity: .9 })
  );
  mesh.position.set(x, 0.6, z);
  scene.add(mesh);
  pickups.push({ mesh, life: 8 });
}

/* ============ ENEMY FIRE ============ */
function fireAtPlayer(target) {
  const tx = target.position.x, tz = target.position.z;
  const px = camera.position.x, pz = camera.position.z;
  const dx = px - tx, dz = pz - tz;
  const dist = Math.hypot(dx, dz);
  if (dist < 3 || dist > 30) return false;

  // LOS check
  const losRay = new THREE.Raycaster(
    new THREE.Vector3(tx, 1.2, tz),
    new THREE.Vector3(dx, 0, dz).normalize(),
    0, dist
  );
  const wallHit = losRay.intersectObjects(wallMeshes, false);
  if (wallHit.length) return false;

  const speed = 8;
  const vx = dx / dist * speed;
  const vz = dz / dist * speed;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff3060 })
  );
  mesh.position.set(tx, 1.2, tz);
  scene.add(mesh);
  projectiles.push({ mesh, vx, vz, life: 4 });
  audio.enemyShot();
  target.userData.flash = 0.35;
  return true;
}

/* ============ HUD ============ */
function hud() {
  $('health').textContent = Math.ceil(health);
  $('healthbar').style.width = health + '%';
  $('ammo').innerHTML = ammo + ' <em>/ 12</em>';
  $('score').textContent = score;
  $('count').textContent = targets.filter(t => t.userData.alive).length;
  const m = Math.floor(Math.max(0, roundTime) / 60);
  const s = Math.floor(Math.max(0, roundTime) % 60).toString().padStart(2, '0');
  const timerEl = $('timer');
  timerEl.textContent = `${m}:${s}`;
  timerEl.classList.toggle('low', roundTime < 20);

  const v = $('damage-vignette');
  v.classList.toggle('low-health', health > 0 && health < 25);

  $('best-start').textContent = bestScore;
}

function toast(s) { $('toast').textContent = s; toastTime = 1; }

function killFeed(text) {
  const feed = $('killfeed');
  const el = document.createElement('div');
  el.className = 'feed-item';
  el.textContent = text;
  feed.appendChild(el);
  while (feed.children.length > 5) feed.firstChild.remove();
  setTimeout(() => el.classList.add('out'), 1800);
  setTimeout(() => el.remove(), 2400);
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.2 : 1.6));
}

/* ============ UPDATE ============ */
function update(dt, t) {
  // Timer
  roundTime -= dt;
  if (roundTime <= 0) { roundTime = 0; endRound(true); return; }

  // Movement
  let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - my;
  let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + mx;
  const len = Math.hypot(f, s) || 1;
  f /= Math.max(1, len);
  s /= Math.max(1, len);

  const hitWall = (x, z) => covers.some(c =>
    Math.abs(x - c.x) < c.w / 2 + 0.38 && Math.abs(z - c.z) < c.d / 2 + 0.38);

  if (dashTimer > 0) {
    dashTimer -= dt;
    const nx = clamp(camera.position.x + dashDirX * DASH_SPEED * dt, -19.5, 19.5);
    const nz = clamp(camera.position.z + dashDirZ * DASH_SPEED * dt, -19.5, 19.5);
    if (!hitWall(nx, camera.position.z)) camera.position.x = nx;
    if (!hitWall(camera.position.x, nz)) camera.position.z = nz;
  } else {
    const nx = clamp(camera.position.x + (-Math.sin(yaw) * f + Math.cos(yaw) * s) * PLAYER_SPEED * dt, -19.5, 19.5);
    const nz = clamp(camera.position.z + (-Math.cos(yaw) * f - Math.sin(yaw) * s) * PLAYER_SPEED * dt, -19.5, 19.5);
    if (!hitWall(nx, camera.position.z)) camera.position.x = nx;
    if (!hitWall(camera.position.x, nz)) camera.position.z = nz;
  }
  if (dashCooldown > 0) dashCooldown -= dt;
  if (camera.fov > 76) {
    camera.fov = Math.max(76, camera.fov - 60 * dt);
    camera.updateProjectionMatrix();
  }

  // Jump
  if (jump && onGround) { vy = 6.5; onGround = false; }
  jump = false;
  vy -= 18 * dt;
  camera.position.y += vy * dt;
  if (camera.position.y <= H) { camera.position.y = H; vy = 0; onGround = true; }

  // Recoil settle
  if (recoilPitch > 0) recoilPitch = Math.max(0, recoilPitch - dt * 0.3);

  // Camera shake
  if (cameraShake > 0) {
    cameraShake = Math.max(0, cameraShake - dt * 1.8);
    shakePitch = (Math.random() - 0.5) * cameraShake * 0.04;
    shakeYaw = (Math.random() - 0.5) * cameraShake * 0.04;
  } else { shakePitch = shakeYaw = 0; }

  camera.rotation.set(pitch + recoilPitch + shakePitch, yaw + shakeYaw, 0, 'YXZ');

  // Player invuln
  if (playerInvuln > 0) playerInvuln -= dt;

  // Health regen
  const now = performance.now() / 1000;
  if (health > 0 && health < 100 && now - lastDamage > REGEN_DELAY) {
    health = Math.min(100, health + REGEN_RATE * dt);
    hud();
  }

  // Combo timer
  if (comboTimer > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0) {
      combo = 0;
      $('combo').classList.add('hidden');
    }
  }

  // Targets — sway + fire
  targets.forEach(g => {
    if (!g.userData.alive) return;
    const d = g.userData;
    g.position.x = d.x + Math.sin(t * d.s + d.p) * d.r;
    g.position.z = d.z + Math.cos(t * d.s * .7 + d.p) * d.r * .4;
    g.rotation.y = Math.sin(t + d.p) * .15;

    if (now > d.nextShot) {
      if (fireAtPlayer(g)) d.nextShot = now + rand(4, 7);
      else d.nextShot = now + rand(1, 2);
    }
    if (d.flash > 0) {
      d.flash -= dt;
      d.frame.material.color.setHex(d.flash > 0 ? 0xff6030 : 0x44d7ff);
    }
  });

  // Projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.z += p.vz * dt;
    p.life -= dt;

    const dx = p.mesh.position.x - camera.position.x;
    const dz = p.mesh.position.z - camera.position.z;
    if (dx * dx + dz * dz < 1.0) {
      damagePlayer(10, p.mesh.position.x, p.mesh.position.z);
      scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
      projectiles.splice(i, 1); continue;
    }
    const inWall = covers.some(c =>
      Math.abs(p.mesh.position.x - c.x) < c.w / 2 && Math.abs(p.mesh.position.z - c.z) < c.d / 2);
    if (p.life <= 0 || inWall) {
      scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
      projectiles.splice(i, 1);
    }
  }

  // Pickups
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.mesh.rotation.y += dt * 3;
    p.mesh.position.y = 0.6 + Math.sin(now * 2) * 0.1;
    p.life -= dt;

    const dx = p.mesh.position.x - camera.position.x;
    const dz = p.mesh.position.z - camera.position.z;
    if (dx * dx + dz * dz < 2.25) {
      health = Math.min(100, health + 25);
      audio.pickup();
      hud();
      scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
      pickups.splice(i, 1); continue;
    }
    if (p.life <= 0) {
      scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
      pickups.splice(i, 1);
    }
  }

  if (fire) shoot();

  if (reload > 0 && ((reload -= dt) <= 0)) {
    ammo = 12;
    hud();
    toast('RELOADED');
  }
  if (toastTime > 0 && ((toastTime -= dt) <= 0)) $('toast').textContent = '';
  if (hitTime > 0 && ((hitTime -= dt) <= 0)) $('hit').classList.remove('show');
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), .04);
  if (running) update(dt, clock.elapsedTime);
  renderer.render(scene, camera);
}

/* ============ BOOT ============ */
init();
hud();
loop();

document.getElementById('start-btn')?.addEventListener('click', async () => {
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
});
