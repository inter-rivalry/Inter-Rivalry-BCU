import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { Net } from './net.js';

const $ = id => document.getElementById(id);
const touch = matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const rand = (a, b) => a + Math.random() * (b - a);

const store = {
  get: (k, fallback) => { try { return localStorage.getItem(k) || fallback; } catch(e) { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch(e) {} }
};

async function lockLandscape() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  } catch (_) {}
  try { if (screen.orientation?.lock) await screen.orientation.lock('landscape'); } catch (_) {}
}

const H = 1.7, SPEED = 7.5, DASH_SPEED = 22, DASH_DUR = .15, DASH_CD = 1.5;
const INVULN = .6, RESPAWN = 3;
const LOCK_CONE = .20, LOCK_RANGE = 25, LOCK_PULL = 12, DRIFT_BREAK = .35;
const HEAD_CD = .8, HEAD_ACCUM = touch ? 60 : 100;
const CAPTURES_TO_WIN = 3, BROADCAST_HZ = 15;
const STEAL_RANGE = 4, TREASURE_RANGE = 6;
const BOT_RETREAT_HP = 30;

const MODES = {
  practice: { desc: 'Practice offline. Pick a mode below.', matchTime: 999 },
  standard: { desc: '5 minutes. Enemies fire back.', matchTime: 300 },
  hardcore: { desc: '3 minutes. Faster fire.', matchTime: 180 },
};

const DIFFICULTY = {
  easy:   { fireDelay: [1.8, 3.2], accuracy: 0.55, speed: 6.5, projectileSpeed: 16, dmg: 8 },
  medium: { fireDelay: [1.2, 2.2], accuracy: 0.70, speed: 7.0, projectileSpeed: 20, dmg: 10 },
  hard:   { fireDelay: [0.8, 1.5], accuracy: 0.85, speed: 7.5, projectileSpeed: 24, dmg: 14 },
};

const RANGE_FIRE_DELAY = [1.5, 2.5];
const RANGE_PROJ_SPEED = 16;
const RANGE_DMG = 8;

const COLORS = {
  azure: { hex: 0x44d7ff, name: 'AZURE' },
  crimson: { hex: 0xff4c73, name: 'CRIMSON' },
  gold: { hex: 0xffe38b, name: 'GOLD' },
  venom: { hex: 0x52ffb1, name: 'VENOM' },
};

const net = new Net();
let scene, camera, renderer, clock, raycaster;
let localId = null, localName = '', localIrId = '', localTeam = 'blue', isHost = false;
let matchId = null;
let running = false, paused = false, customizing = false;
let practiceMode = false, practiceVariant = 'range';
let health = 100, alive = true, respawnTimer = 0;
let ammo = 12, reloadT = 0;
let yaw = 0, pitch = 0, vy = 0, onGround = true;
let mx = 0, my = 0, joyId = null, aimId = null;
let lastX = 0, lastY = 0, fire = false, lastShot = 0, jump = false;
let dashT = 0, dashCd = 0, dashDirX = 0, dashDirZ = 1;
let recoil = 0, cameraShake = 0, shakeX = 0, shakeY = 0;
let invulnT = 0;
let scoreBlue = 0, scoreRed = 0, roundTime = 999;
let kills = 0, deaths = 0, captures = 0, headshots = 0;
let stateBroadcastTimer = 0, gameOver = false, matchMode = 'practice';
let practiceDifficulty = 'medium';
let frameCount = 0;
let lastScoreBlue = 0, lastScoreRed = 0;

let walkBob = 0, landingDip = 0, dashWhoosh = 0, matchElapsed = 0;
const lastPlayerPos = new THREE.Vector3();
const playerVel = new THREE.Vector3();

const aim = {
  sensitivity: +(store.get('rivals-sens', touch ? 1.4 : 1.0)),
  assistStrength: +(store.get('rivals-assist', touch ? 1.0 : 0.85)),
  locked: null, lockPoint: 'chest', headCd: 0, upAccum: 0, upWin: 0,
};

let gameMode = 'practice';
let playerColorKey = store.get('rivals-color', 'azure');
let lobbyPreview = null;

const players = new Map();
const bots = [];
const targets = [];
const projectiles = [];
const effects = [];
const damageNumbers = [];
const flags = { blue: null, red: null };
const covers = [], wallMeshes = [];
const keys = {};
let gunGroup = null;
let muzzleFlash = null;
let ambientParticles = null;

// Battlefield Animation References
let baseBlueRing, baseRedRing, floorGrid;
const coverGlowEdges = [];
const centerEnergyRings = [];
const battlefieldSparks = [];
const animeDecor = [];

/* ===== UI CUSTOMIZATION ===== */
// Use a versioned key so old saved coordinates cannot unexpectedly move buttons.
const CUSTOM_LAYOUT_KEY = 'rivals-layout-v2';
const FIXED_ACTION_BUTTONS = new Set(['steal-btn', 'treasure-btn']);

function loadCustomLayout() {
  const saved = store.get(CUSTOM_LAYOUT_KEY, null);
  if (!saved) return;
  try {
    const layout = JSON.parse(saved);
    Object.keys(layout).forEach(id => {
      const el = $(id);
      const pos = layout[id];
      if (!el || !pos || typeof pos.left !== 'string' || typeof pos.top !== 'string') return;
      // Only apply coordinates created by the current customization system.
      el.style.position = 'fixed';
      el.style.left = pos.left;
      el.style.top = pos.top;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.transform = 'none';
      el.style.margin = '0';
    });
  } catch (e) { /* Ignore corrupt saved layouts and keep the default CSS layout. */ }
}

function initDragging() {
  document.querySelectorAll('.draggable').forEach(el => {
    let startX = 0, startY = 0, startLeft = 0, startTop = 0, pointerId = null;
    el.style.touchAction = 'none';

    el.addEventListener('pointerdown', e => {
      if (!customizing || el.classList.contains('hidden')) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      pointerId = e.pointerId;
      el.classList.add('dragging');
      el.style.position = 'fixed';
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.transform = 'none';
      el.style.margin = '0';
      startLeft = rect.left; startTop = rect.top;
      startX = e.clientX; startY = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    });

    el.addEventListener('pointermove', e => {
      if (!customizing || !el.classList.contains('dragging') || e.pointerId !== pointerId) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);
      const left = clamp(startLeft + e.clientX - startX, 0, maxLeft);
      const top = clamp(startTop + e.clientY - startY, 0, maxTop);
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    });

    const finishDrag = e => {
      if (pointerId !== null && e.pointerId !== pointerId) return;
      const wasDragging = el.classList.contains('dragging');
      el.classList.remove('dragging');
      try { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); } catch (_) {}
      pointerId = null;
      if (wasDragging && customizing) saveCustomLayout();
    };
    el.addEventListener('pointerup', finishDrag);
    el.addEventListener('pointercancel', finishDrag);
    el.addEventListener('lostpointercapture', finishDrag);
  });
}

function saveCustomLayout() {
  const layout = {};
  document.querySelectorAll('.draggable').forEach(el => {
    if (!el.id || el.classList.contains('hidden')) return;
    // Save only elements that the player has actually placed with the current layout.
    if (el.style.position === 'fixed' && el.style.left && el.style.top) {
      layout[el.id] = { left: el.style.left, top: el.style.top };
    }
  });
  store.set(CUSTOM_LAYOUT_KEY, JSON.stringify(layout));
}

/* ===== UTILS & HUMANOID ===== */
function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}
function disposeGroup(g) {
  g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) Array.isArray(o.material) ? o.material.forEach(m => m.dispose()) : o.material.dispose(); });
}
function isBlocked(x, z, margin = 0.5) { return covers.some(c => Math.abs(x - c.x) < c.w / 2 + margin && Math.abs(z - c.z) < c.d / 2 + margin); }
function steerMove(entity, targetX, targetZ, speed, dt) {
  const px = entity.group.position.x, pz = entity.group.position.z;
  const dx = targetX - px, dz = targetZ - pz;
  const dist = Math.hypot(dx, dz); if (dist < 0.3) return false;
  const step = Math.min(speed * dt, dist); const angle0 = Math.atan2(dz, dx);
  const angles = [0, 0.4, -0.4, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, 2.6, -2.6, Math.PI];
  for (const off of angles) {
    const a = angle0 + off; const nx = clamp(px + Math.cos(a) * step, -24, 24); const nz = clamp(pz + Math.sin(a) * step, -24, 24);
    if (!isBlocked(nx, nz)) { entity.group.position.x = nx; entity.group.position.z = nz; return true; }
  }
  return false;
}

function buildHumanoid(color) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color, roughness: .8, emissive: color, emissiveIntensity: .1 });
  const skinDark = new THREE.MeshStandardMaterial({ color, roughness: .85, emissive: color, emissiveIntensity: .05 });
  const hitParts = []; const animParts = {};
  const part = (geo, m, x, y, z, isHead = false) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z);
    if (isHead) mesh.userData.isHead = true;
    g.add(mesh); hitParts.push(mesh); return mesh;
  };
  part(new THREE.SphereGeometry(.18, 10, 8), skin, 0, 1.76, 0, true);
  
  const torsoPivot = new THREE.Group(); torsoPivot.position.set(0, 0.85, 0); g.add(torsoPivot);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(.48, .60, .24), skin);
  torso.position.set(0, .35, 0); torsoPivot.add(torso); hitParts.push(torso); animParts.torso = torsoPivot;
  part(new THREE.BoxGeometry(.42, .15, .22), skinDark, 0, .825, 0);

  animParts.legs = [];
  for (const side of [-1, 1]) {
    const legPivot = new THREE.Group(); legPivot.position.set(side * .11, .775, 0); g.add(legPivot);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(.15, .40, .15), skin); upper.position.set(0, -.20, 0); legPivot.add(upper); hitParts.push(upper);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(.13, .35, .13), skin); lower.position.set(0, -.55, 0); legPivot.add(lower); hitParts.push(lower);
    animParts.legs.push(legPivot);
  }

  animParts.arms = [];
  for (const side of [-1, 1]) {
    const armPivot = new THREE.Group(); armPivot.position.set(side * .30, 1.44, 0); g.add(armPivot);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(.12, .36, .12), skin); upper.position.set(0, -.18, 0); armPivot.add(upper); hitParts.push(upper);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(.10, .34, .10), skin); lower.position.set(0, -.52, 0); armPivot.add(lower); hitParts.push(lower);
    animParts.arms.push(armPivot);
  }

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.45, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .35 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .02; shadow.raycast = () => {}; g.add(shadow);

  g.userData.anim = { walkPhase: 0, aimTimer: 0, hitTimer: 0, deathTimer: 0, spawnTimer: 0.4 };
  g.userData.animParts = animParts;
  g.userData.materials = [skin, skinDark];
  g.scale.set(0.01, 0.01, 0.01);
  return { group: g, hitParts };
}

function updateHumanoidAnim(group, dt, isMoving, isAiming) {
  const anim = group.userData.anim;
  const parts = group.userData.animParts;
  if (!anim || !parts) return;
  
  if (anim.spawnTimer > 0) { anim.spawnTimer -= dt; group.scale.setScalar(1 - Math.max(0, anim.spawnTimer / 0.4)); } 
  else if (group.scale.x !== 1) group.scale.setScalar(1);

  if (anim.deathTimer > 0) {
    anim.deathTimer -= dt; const t = 1 - Math.max(0, anim.deathTimer / 0.5);
    group.rotation.z = t * Math.PI / 2;
    group.userData.materials.forEach(m => { m.opacity = 1 - t; m.transparent = true; });
    return;
  }
  
  if (isMoving) {
    anim.walkPhase += dt * 12; // Faster, visible walk
    const swing = Math.sin(anim.walkPhase) * 0.8; // Exaggerated swing
    const armSwing = Math.sin(anim.walkPhase + Math.PI) * 0.6;
    const bounce = Math.abs(Math.sin(anim.walkPhase)) * 0.08; // Bouncy walk
    
    if (parts.legs[0]) parts.legs[0].rotation.x = swing; 
    if (parts.legs[1]) parts.legs[1].rotation.x = -swing;
    if (parts.arms[0] && anim.aimTimer <= 0) parts.arms[0].rotation.x = armSwing;
    if (parts.arms[1] && anim.aimTimer <= 0) parts.arms[1].rotation.x = -armSwing;
    
    if (parts.torso) {
      parts.torso.rotation.x = -0.1; // Lean forward
      parts.torso.rotation.z = Math.sin(anim.walkPhase * 2) * 0.05;
    }
    group.position.y = bounce;
  } else {
    group.position.y = 0;
    const breath = Math.sin(performance.now() / 1000 * 2) * 0.02;
    if (parts.torso) { parts.torso.rotation.z = breath; parts.torso.rotation.x = 0; }
    if (parts.legs[0]) parts.legs[0].rotation.x *= 0.9; if (parts.legs[1]) parts.legs[1].rotation.x *= 0.9;
    if (parts.arms[0] && anim.aimTimer <= 0) parts.arms[0].rotation.x *= 0.9;
    if (parts.arms[1] && anim.aimTimer <= 0) parts.arms[1].rotation.x *= 0.9;
  }
  
  if (isAiming) anim.aimTimer = 0.3;
  if (anim.aimTimer > 0) { anim.aimTimer -= dt; if (parts.arms[1]) parts.arms[1].rotation.x = -1.4; }
  if (anim.hitTimer > 0) { anim.hitTimer -= dt; if (parts.torso) parts.torso.rotation.x = Math.sin(anim.hitTimer * 60) * 0.1; } 
  else if (parts.torso) parts.torso.rotation.x *= 0.85;
}
function triggerHitAnim(group) { if (group?.userData?.anim) group.userData.anim.hitTimer = 0.15; }
function triggerDeathAnim(group) { if (group?.userData?.anim) group.userData.anim.deathTimer = 0.5; }
function resetHumanoidAnim(group) {
  if (!group?.userData?.anim) return;
  group.rotation.z = 0; group.userData.anim.deathTimer = 0;
  group.userData.anim.spawnTimer = 0.4; group.scale.set(0.01, 0.01, 0.01);
  group.userData.materials.forEach(m => { m.opacity = 1; m.transparent = false; });
}

/* ===== ANIME ARENA ART DIRECTION ===== */
function makeAnimeFloorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 1024, 1024);
  grad.addColorStop(0, '#111b38'); grad.addColorStop(.48, '#17152f'); grad.addColorStop(1, '#0a1025');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 1024, 1024);
  ctx.globalAlpha = .32;
  for (let i = -1024; i < 2048; i += 128) {
    ctx.fillStyle = (Math.floor(i / 128) % 2) ? '#193b66' : '#422050';
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 54, 0); ctx.lineTo(i - 470, 1024); ctx.lineTo(i - 524, 1024); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 42; i++) {
    const x = (i * 173) % 1024, y = (i * 257) % 1024;
    ctx.strokeStyle = i % 2 ? '#ff477b' : '#36e5ff'; ctx.globalAlpha = .22; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (i % 2 ? 80 : -80), y); ctx.lineTo(x + (i % 2 ? 80 : -80), y + (i % 3 ? 54 : -54)); ctx.stroke();
    ctx.globalAlpha = .7; ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  for (let y = 90; y < 1024; y += 170) for (let x = 90; x < 1024; x += 170) {
    ctx.strokeStyle = '#7d8dff'; ctx.globalAlpha = .2; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 21, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = .75; ctx.strokeStyle = '#54eaff'; ctx.lineWidth = 5;
  ctx.setLineDash([20, 16]); ctx.beginPath(); ctx.moveTo(512, 0); ctx.lineTo(512, 1024); ctx.stroke(); ctx.setLineDash([]);
  ctx.globalAlpha = .18; ctx.fillStyle = '#45dcff'; ctx.fillRect(480, 0, 64, 1024); ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex;
}
function makeFlagTexture(color, label) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 320; const ctx = c.getContext('2d');
  const hex = '#' + color.toString(16).padStart(6, '0');
  const grad = ctx.createLinearGradient(0, 0, 512, 320); grad.addColorStop(0, '#11152e'); grad.addColorStop(.52, hex); grad.addColorStop(1, '#17112d');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 512, 320); ctx.globalAlpha = .28; ctx.fillStyle = '#fff';
  for (let i = -300; i < 700; i += 90) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 42, 0); ctx.lineTo(i - 150, 320); ctx.lineTo(i - 192, 320); ctx.fill(); }
  ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.strokeRect(14, 14, 484, 292);
  ctx.save(); ctx.translate(256, 126); ctx.shadowColor = hex; ctx.shadowBlur = 26; ctx.fillStyle = '#fff'; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 34 : 74; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.closePath(); ctx.fill(); ctx.restore(); ctx.fillStyle = '#fff'; ctx.font = '900 42px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = '#000'; ctx.shadowBlur = 8; ctx.fillText(label, 256, 250);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

/* ===== FLAG, GUN, EFFECTS ===== */
function buildFlag(color) {
  const g = new THREE.Group(); const isBlue = color === 0x44d7ff;
  const metal = new THREE.MeshStandardMaterial({ color: 0x293653, metalness: .82, roughness: .22, emissive: color, emissiveIntensity: .22 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.035, .065, 2.45, 10), metal); pole.position.y = 1.22; g.add(pole);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(.11, .28, 6), new THREE.MeshBasicMaterial({ color })); fin.position.y = 2.52; g.add(fin);
  const clothGeo = new THREE.PlaneGeometry(1.15, .72, 12, 8);
  const clothMat = new THREE.MeshStandardMaterial({ map: makeFlagTexture(color, isBlue ? 'SKY UNIT' : 'CRIMSON'), color: 0xffffff, side: THREE.DoubleSide, emissive: color, emissiveIntensity: .24, roughness: .48, metalness: .08 });
  const cloth = new THREE.Mesh(clothGeo, clothMat); cloth.position.set(.58, 1.92, 0); g.add(cloth);
  g.userData.cloth = cloth; g.userData.clothBase = clothGeo.attributes.position.array.slice();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.62, .76, .16, 8), new THREE.MeshStandardMaterial({ color: 0x131a32, metalness: .6, roughness: .35, emissive: color, emissiveIntensity: .16 })); base.position.y = .08; g.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.53, .035, 6, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9 })); ring.rotation.x = Math.PI / 2; ring.position.y = .18; g.add(ring);
  return g;
}
function updateFlagWave(flagMesh, t) {
  if (!flagMesh?.userData?.cloth) return;
  const cloth = flagMesh.userData.cloth; const pos = cloth.geometry.attributes.position; const base = flagMesh.userData.clothBase;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3]; const y = base[i * 3 + 1];
    pos.setZ(i, Math.sin(t * 4 + x * 8) * 0.06 * (x + 0.4));
    pos.setY(i, y + Math.sin(t * 3 + x * 6) * 0.02 * x);
  }
  pos.needsUpdate = true;
}

function buildGun() {
  const g = new THREE.Group();
  const matDark = new THREE.MeshStandardMaterial({ color: 0x1a1a24, roughness: .8, metalness: .2 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0x44d7ff, emissive: 0x44d7ff, emissiveIntensity: .5 });
  const matHand = new THREE.MeshStandardMaterial({ color: 0xd9a07c, roughness: .9 });
  const matSleeve = new THREE.MeshStandardMaterial({ color: 0x168bd3, roughness: .9 });
  
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(.1, .25, .4), matSleeve); rightArm.position.set(0.05, -0.15, 0.15); rightArm.rotation.x = 0.4; g.add(rightArm);
  const rightHand = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), matHand); rightHand.position.set(0.05, -0.08, -0.02); g.add(rightHand);
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(.1, .25, .4), matSleeve); leftArm.position.set(-0.15, -0.15, -0.25); leftArm.rotation.x = 0.6; leftArm.rotation.y = -0.2; g.add(leftArm);
  const leftHand = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), matHand); leftHand.position.set(-0.1, -0.08, -0.4); g.add(leftHand);

  const body = new THREE.Mesh(new THREE.BoxGeometry(.12, .14, .45), matDark); body.position.set(0, 0.02, -0.15); g.add(body);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(.08, .04, .3), matDark); rail.position.set(0, 0.1, -0.15); g.add(rail);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .35, 8), matDark); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.5); g.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(.08, .18, .1), matDark); mag.position.set(0, -0.1, -0.05); mag.rotation.x = 0.2; g.add(mag);
  const magAccent = new THREE.Mesh(new THREE.BoxGeometry(.09, .04, .11), matAccent); magAccent.position.set(0, -0.1, -0.05); magAccent.rotation.x = 0.2; g.add(magAccent);

  muzzleFlash = new THREE.Mesh(new THREE.ConeGeometry(.1, .2, 8), new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0, depthWrite: false }));
  muzzleFlash.rotation.x = -Math.PI / 2; muzzleFlash.position.set(0, 0.02, -0.68); g.add(muzzleFlash);

  g.position.set(.22, -.2, -.45); g.rotation.y = -0.05; g.rotation.z = -0.02;
  return g;
}

function createAmbientParticles() {
  const count = 40; const geo = new THREE.BufferGeometry(); const positions = new Float32Array(count * 3); const velocities = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = rand(-24, 24); positions[i * 3 + 1] = rand(1, 8); positions[i * 3 + 2] = rand(-24, 24);
    velocities.push({ x: rand(-0.3, 0.3), y: rand(-0.1, 0.15), z: rand(-0.3, 0.3) });
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1, transparent: true, opacity: 0.4, depthWrite: false });
  const points = new THREE.Points(geo, mat); points.userData = { velocities, count }; scene.add(points); return points;
}
function updateAmbientParticles(particles, dt) {
  if (!particles) return;
  const pos = particles.geometry.attributes.position; const vels = particles.userData.velocities;
  for (let i = 0; i < particles.userData.count; i++) {
    pos.setX(i, pos.getX(i) + vels[i].x * dt); pos.setY(i, pos.getY(i) + vels[i].y * dt); pos.setZ(i, pos.getZ(i) + vels[i].z * dt);
    if (pos.getY(i) > 10) pos.setY(i, 1); if (pos.getY(i) < 0.5) pos.setY(i, 9);
    if (pos.getX(i) > 25) pos.setX(i, -25); if (pos.getX(i) < -25) pos.setX(i, 25);
    if (pos.getZ(i) > 25) pos.setZ(i, -25); if (pos.getZ(i) < -25) pos.setZ(i, 25);
  }
  pos.needsUpdate = true;
}

function spawnMuzzleFlash() { if (muzzleFlash) muzzleFlash.material.opacity = 1; }
function spawnBotFlash(x, z, color) {
  const geo = new THREE.SphereGeometry(0.2, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
  const flash = new THREE.Mesh(geo, mat); flash.position.set(x, 1.2, z);
  scene.add(flash); effects.push({ mesh: flash, life: 0.08, maxLife: 0.08, isImpact: true });
}
function spawnImpact(x, y, z, color = 0xffffff) {
  const geo = new THREE.RingGeometry(.05, .15, 12); const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(geo, mat); ring.position.set(x, y, z); ring.lookAt(camera.position);
  scene.add(ring); effects.push({ mesh: ring, life: 0.3, maxLife: 0.3, isImpact: true });
}
function spawnDamageNumber(x, y, z, text, isHeadshot) {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64; const ctx = canvas.getContext('2d');
  ctx.font = 'bold 48px Orbitron, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = isHeadshot ? '#52ffb1' : '#ffe38b'; ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
  ctx.strokeText(text, 64, 32); ctx.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(canvas); const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat); sprite.position.set(x, y + 2.2, z); sprite.scale.set(1.5, 0.75, 1);
  scene.add(sprite); damageNumbers.push({ sprite, life: 0.9, maxLife: 0.9, tex });
}

/* ===== LOBBY PREVIEW ===== */
class LobbyPreview {
  constructor(canvas) {
    this.canvas = canvas; this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(32, 1, .1, 50);
    this.camera.position.set(0, 1.15, 3.4); this.camera.lookAt(0, 1.05, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445577, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.8); key.position.set(2, 4, 3); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x44d7ff, 2); rim.position.set(-3, 2, -3); this.scene.add(rim);
    this.model = null; this.running = true; this._loop = this._loop.bind(this); this._loop();
  }
  setColor(hex) {
    if (this.model) { this.scene.remove(this.model); disposeGroup(this.model); }
    const { group } = buildHumanoid(hex); group.scale.setScalar(1);
    if (group.userData.anim) group.userData.anim.spawnTimer = 0;
    this.model = group; this.scene.add(group);
  }
  _loop() { if (!this.running) return; requestAnimationFrame(this._loop); const t = performance.now() / 1000; if (this.model) this.model.rotation.y = t * .7; this.renderer.render(this.scene, this.camera); }
  resize() { const r = this.canvas.getBoundingClientRect(); if (!r.width || !r.height) return; this.renderer.setSize(r.width, r.height, false); this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix(); }
  dispose() { this.running = false; if (this.model) disposeGroup(this.model); this.renderer.dispose(); }
}

/* ===== WORLD ===== */
function initWorld() {
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x10132b); scene.fog = new THREE.Fog(0x10132b, 48, 105);
  camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, .1, 120); camera.rotation.order = 'YXZ'; scene.add(camera);
  renderer = new THREE.WebGLRenderer({ antialias: !touch, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.0 : 1.2)); renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = false; $('game-root').appendChild(renderer.domElement);
  clock = new THREE.Clock(); raycaster = new THREE.Raycaster();
  
  scene.add(new THREE.HemisphereLight(0xb6c9ff, 0x17102f, 1.75));
  const sun = new THREE.DirectionalLight(0xffd6f4, 2.0); sun.position.set(-12, 25, 15); scene.add(sun);
  const animeRimBlue = new THREE.PointLight(0x27dfff, 42, 42); animeRimBlue.position.set(-17, 5, 0); scene.add(animeRimBlue);
  const animeRimRed = new THREE.PointLight(0xff286a, 42, 42); animeRimRed.position.set(17, 5, 0); scene.add(animeRimRed);
  const animeCenterLight = new THREE.PointLight(0x9666ff, 28, 32); animeCenterLight.position.set(0, 5, 0); scene.add(animeCenterLight);

  const animeFloorMat = new THREE.MeshStandardMaterial({ map: makeAnimeFloorTexture(), color: 0xffffff, roughness: .72, metalness: .12, emissive: 0x111b3a, emissiveIntensity: .28 });
  box(50, .5, 50, animeFloorMat, 0, -.25, 0);
  
  // THE MOVING FLOOR GRID
  floorGrid = new THREE.GridHelper(50, 50, 0x61eaff, 0x58417c); 
  floorGrid.position.y = .01; scene.add(floorGrid);

  const blue = new THREE.MeshStandardMaterial({ color: 0x147fc9, roughness: .48, metalness: .32, emissive: 0x087dff, emissiveIntensity: .48 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc71d58, roughness: .48, metalness: .32, emissive: 0xff174f, emissiveIntensity: .48 });
  const wallM = new THREE.MeshStandardMaterial({ color: 0x121a35, roughness: .55, metalness: .35, emissive: 0x34275d, emissiveIntensity: .24 });

  box(50, 2, .8, wallM, 0, 1, -25); box(50, 2, .8, wallM, 0, 1, 25); box(.8, 2, 50, wallM, -25, 1, 0); box(.8, 2, 50, wallM, 25, 1, 0);
  box(6, .2, 12, blue, -21, .1, 0); box(6, .2, 12, red, 21, .1, 0);
  // Futuristic anime arena perimeter rails and faction pylons.
  const railBlue = new THREE.MeshBasicMaterial({ color: 0x35e7ff, transparent: true });
  const railPink = new THREE.MeshBasicMaterial({ color: 0xff3478, transparent: true });
  const railViolet = new THREE.MeshBasicMaterial({ color: 0x9275ff, transparent: true });
  for (const [x,z,w,d,mat] of [[0,-24.48,48,.055,railViolet],[0,24.48,48,.055,railViolet],[-24.48,0,.055,48,railViolet],[24.48,0,.055,48,railViolet],[-21,0,5.7,.07,railBlue],[21,0,5.7,.07,railPink]]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w,.045,d),mat); rail.position.set(x,.045,z); scene.add(rail); animeDecor.push({mesh:rail,kind:'rail',phase:Math.random()*6.28});
  }
  for (const [x,color,mat] of [[-21,0x35e7ff,railBlue],[21,0xff3478,railPink]]) for (const z of [-5.1,5.1]) {
    const pylon = new THREE.Mesh(new THREE.OctahedronGeometry(.42,0), new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:1.1,metalness:.25,roughness:.28}));
    pylon.position.set(x,1.45,z); scene.add(pylon); animeDecor.push({mesh:pylon,kind:'pylon',phase:Math.random()*6.28});
    const beam = new THREE.Mesh(new THREE.BoxGeometry(.07,1.6,.07),mat); beam.position.set(x,.8,z); scene.add(beam);
  }
  for (let i=0;i<18;i++) {
    const color=i%2?0x3ceaff:0xff397d;
    const shard=new THREE.Mesh(new THREE.OctahedronGeometry(.22+(i%3)*.1,0),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.55}));
    shard.position.set(-22+(i*2.61)%44,2.5+(i%5)*.85,-20+(i*7.3)%40); scene.add(shard);
    animeDecor.push({mesh:shard,kind:'shard',phase:i*.71,baseY:shard.position.y});
  }

  // ENERGY BASE RINGS
  const ringGeo = new THREE.RingGeometry(3, 3.2, 48);
  baseBlueRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x44d7ff, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
  baseBlueRing.rotation.x = -Math.PI / 2; baseBlueRing.position.set(-21, 0.25, 0); scene.add(baseBlueRing);
  
  baseRedRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff4c73, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
  baseRedRing.rotation.x = -Math.PI / 2; baseRedRing.position.set(21, 0.25, 0); scene.add(baseRedRing);

  const coverDefs = [
    [-8, -6, 3, 2, 2], [-8, 6, 3, 2, 2], [8, -6, 3, 2, 2], [8, 6, 3, 2, 2],
    [0, -10, 2, 2.5, 2], [0, 10, 2, 2.5, 2], [-14, 0, 2, 1.8, 4], [14, 0, 2, 1.8, 4], [-4, 0, 2.5, 1.6, 2.5], [4, 0, 2.5, 1.6, 2.5],
  ];
  for (const [x, z, w, h, d] of coverDefs) {
    // Give every block its own material so its anime energy pulse can animate independently.
    const teamMat = x < -1 ? blue : x > 1 ? red : (z < 0 ? blue : red);
    const blockMaterial = teamMat.clone();
    const m = box(w, h, d, blockMaterial, x, h / 2, z);
    // Layered armor caps and luminous anime sigils dress the cover while collision remains unchanged.
    const accentColor = x < -1 ? 0x35e7ff : x > 1 ? 0xff3478 : (z < 0 ? 0x35e7ff : 0xff3478);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + .16, .12, d + .16), new THREE.MeshStandardMaterial({color:0x202747,metalness:.65,roughness:.28,emissive:accentColor,emissiveIntensity:.24}));
    cap.position.set(x, h + .05, z); scene.add(cap);
    const capEdge = new THREE.LineSegments(new THREE.EdgesGeometry(cap.geometry), new THREE.LineBasicMaterial({color:accentColor,transparent:true,opacity:.95})); capEdge.position.copy(cap.position); scene.add(capEdge);
    const sigil = new THREE.Mesh(new THREE.BoxGeometry(Math.max(.12,w*.62), .055, .055), new THREE.MeshBasicMaterial({color:accentColor,transparent:true,opacity:.8})); sigil.position.set(x, h*.63, z + d/2 + .035); scene.add(sigil);
    animeDecor.push({mesh:capEdge,kind:'edge',phase:rand(0,Math.PI*2)});
    animeDecor.push({mesh:sigil,kind:'sigil',phase:rand(0,Math.PI*2)});
    m.userData.baseY = h / 2;
    wallMeshes.push(m);
    covers.push({ x, z, w, d });

    // Neon outline makes cover readable and visibly energized without changing collision/gameplay.
    const edgeGeo = new THREE.EdgesGeometry(m.geometry);
    const edgeMat = new THREE.LineBasicMaterial({
      color: (x < 0 ? 0x44d7ff : x > 0 ? 0xff4c73 : 0x8b8cff),
      transparent: true,
      opacity: 0.78
    });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    edges.position.copy(m.position);
    edges.scale.set(1.006, 1.006, 1.006);
    scene.add(edges);
    coverGlowEdges.push({ mesh: edges, material: edgeMat, phase: rand(0, Math.PI * 2) });
  }

  // Concentric energy circles across the middle of the arena: purely visual, no collision.
  const centerRingSpecs = [
    { inner: 2.0, outer: 2.09, color: 0x44d7ff, speed: 0.38, phase: 0 },
    { inner: 3.0, outer: 3.07, color: 0xff4c73, speed: -0.28, phase: 1.7 },
    { inner: 4.1, outer: 4.16, color: 0x8b8cff, speed: 0.2, phase: 3.1 }
  ];
  for (const spec of centerRingSpecs) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(spec.inner, spec.outer, 96),
      new THREE.MeshBasicMaterial({
        color: spec.color, side: THREE.DoubleSide,
        transparent: true, opacity: 0.42, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.035 + centerEnergyRings.length * 0.006, 0);
    scene.add(ring);
    centerEnergyRings.push({ mesh: ring, speed: spec.speed, phase: spec.phase });
  }

  // Small, low-cost energy sparks orbit the centre. Decorative only: no collision or gameplay changes.
  const sparkGeo = new THREE.SphereGeometry(0.075, 8, 6);
  const sparkMats = [
    new THREE.MeshBasicMaterial({ color: 0x44d7ff, transparent: true, opacity: 0.8, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: 0xff4c73, transparent: true, opacity: 0.8, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: 0x8b8cff, transparent: true, opacity: 0.8, depthWrite: false })
  ];
  for (let i = 0; i < 15; i++) {
    const spark = new THREE.Mesh(sparkGeo, sparkMats[i % sparkMats.length]);
    scene.add(spark);
    battlefieldSparks.push({
      mesh: spark,
      angle: (i / 15) * Math.PI * 2,
      radius: 2.3 + (i % 5) * 0.62,
      speed: (i % 2 ? -1 : 1) * (0.22 + (i % 4) * 0.07),
      phase: i * 0.83,
      height: 0.22 + (i % 3) * 0.16
    });
  }

  flags.blue = { mesh: buildFlag(0x44d7ff), basePos: new THREE.Vector3(-21, 0, 0), carrier: null, team: 'blue' };
  flags.red = { mesh: buildFlag(0xff4c73), basePos: new THREE.Vector3(21, 0, 0), carrier: null, team: 'red' };
  flags.blue.mesh.position.copy(flags.blue.basePos); flags.red.mesh.position.copy(flags.red.basePos); scene.add(flags.blue.mesh, flags.red.mesh);

  gunGroup = buildGun(); camera.add(gunGroup);
  ambientParticles = createAmbientParticles();
  loadCustomLayout(); initDragging();

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
    if (lobbyPreview) lobbyPreview.resize();
  });
}

/* ===== PLAYERS / BOTS ===== */
function addPlayer(id, name, irId, team) {
  if (players.has(id) || id === localId) return;
  const color = team === 'blue' ? 0x44d7ff : 0xff4c73;
  const { group, hitParts } = buildHumanoid(color); scene.add(group);
  const label = document.createElement('div'); label.className = 'name-tag ' + team;
  label.innerHTML = `<div class="tag-name">${escapeHtml(name)}</div><div class="tag-ir">${escapeHtml(irId)}</div>`;
  $('name-tags').appendChild(label);
  players.set(id, { id, name, irId, team, group, hitParts, label, targetPos: new THREE.Vector3(team === 'blue' ? -20 : 20, 0, 0), yaw: 0, hp: 100, alive: true, prevPos: new THREE.Vector3() });
}
function removePlayer(id) {
  const p = players.get(id); if (!p) return;
  disposeGroup(p.group); scene.remove(p.group); p.label.remove(); players.delete(id);
}
function addBot(name, team) {
  const color = team === 'blue' ? 0x44d7ff : 0xff4c73;
  const { group, hitParts } = buildHumanoid(color);
  const baseX = team === 'blue' ? -20 : 20; const baseZ = rand(-4, 4);
  group.position.set(baseX, 0, baseZ); scene.add(group);
  const label = document.createElement('div'); label.className = 'name-tag ' + team;
  label.innerHTML = `<div class="tag-name">${escapeHtml(name)}</div><div class="tag-ir">BOT</div>`;
  $('name-tags').appendChild(label);
  const bot = {
    isBot: true, id: 'bot_' + Math.random().toString(36).slice(2, 8), name, team, group, hitParts, label,
    hp: 100, alive: true, baseX, baseZ, fireTimer: rand(.3, 1.2), respawnTimer: 0, carrying: null,
    strafePhase: rand(0, 6.28), prevPos: new THREE.Vector3(baseX, 0, baseZ), isAiming: false,
  };
  bots.push(bot); return bot;
}
function removeAllBots() { for (const b of bots) { disposeGroup(b.group); scene.remove(b.group); b.label.remove(); } bots.length = 0; }

function addRangeTarget() {
  const color = Math.random() < .5 ? 0xff3e69 : 0xff7aa0;
  const { group, hitParts } = buildHumanoid(color);
  const angle = Math.random() * Math.PI * 2; const radius = rand(8, 15);
  const x = Math.cos(angle) * radius; const z = Math.sin(angle) * radius;
  group.position.set(x, 0, z); scene.add(group);
  targets.push({ group, hitParts, baseX: x, baseZ: z, phase: rand(0, 6.28), speed: rand(.5, 1.0), alive: true, respawnTimer: 0, fireTimer: rand(RANGE_FIRE_DELAY[0], RANGE_FIRE_DELAY[1]) });
}
function clearTargets() { for (const t of targets) { disposeGroup(t.group); scene.remove(t.group); } targets.length = 0; }

/* ===== NET HANDLERS ===== */
function onMatchState(d) {
  const p = players.get(d.id); if (!p) return;
  p.targetPos.set(d.pos[0], 0, d.pos[2]); p.yaw = d.yaw; p.hp = d.hp;
  if (!d.alive && p.alive) triggerDeathAnim(p.group); p.alive = d.alive;
  if (!d.alive) setTimeout(() => { if (p.group) p.group.visible = false; }, 500); else p.group.visible = true;
}
function onShotFired(d) {
  const from = new THREE.Vector3(...d.from); const to = new THREE.Vector3(...d.to);
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8 }));
  scene.add(line); setTimeout(() => { scene.remove(line); geo.dispose(); line.material.dispose(); }, 80);
}
function onHitReceived(d) {
  if (d.target === localId) {
    if (!alive || invulnT > 0) return;
    health = Math.max(0, health - d.damage); invulnT = INVULN;
    cameraShake = Math.min(cameraShake + .4, .7);
    $('damage-vignette').classList.add('on'); setTimeout(() => $('damage-vignette').classList.remove('on'), 200);
    updateHud(); if (health <= 0) die(d.shooter, d.headshot);
  }
}
function onFlagUpdate(d) {
  if (d.type === 'capture' && isHost) {
    const f = flags[d.team]; if (!f || f.carrier !== d.carrier) return;
    const carrier = players.get(d.carrier); if (!carrier || !carrier.alive) return;
    const ownBaseX = carrier.team === 'blue' ? -21 : 21;
    const dx = carrier.group.position.x - ownBaseX; const dz = carrier.group.position.z;
    if (dx * dx + dz * dz > TREASURE_RANGE * TREASURE_RANGE) return;
    if (carrier.team === 'blue') scoreBlue++; else scoreRed++;
    captures++; f.carrier = null; f.mesh.position.copy(f.basePos);
    net.broadcastMatch('score', { scoreBlue, scoreRed });
    net.broadcastMatch('flag', { team: d.team, carrier: null, baseX: f.basePos.x, baseZ: f.basePos.z, scoreBlue, scoreRed });
    if (scoreBlue >= CAPTURES_TO_WIN || scoreRed >= CAPTURES_TO_WIN) endMatch(scoreBlue >= CAPTURES_TO_WIN ? 'blue' : 'red');
    return;
  }
  if (d.type === 'steal' && isHost) {
    const f = flags[d.team]; if (!f || f.carrier) return;
    const stealer = players.get(d.stealer); if (!stealer || !stealer.alive || stealer.team === d.team) return;
    const dx = stealer.group.position.x - f.mesh.position.x; const dz = stealer.group.position.z - f.mesh.position.z;
    if (dx * dx + dz * dz > STEAL_RANGE * STEAL_RANGE) return;
    f.carrier = stealer.id;
    net.broadcastMatch('flag', { team: d.team, carrier: stealer.id, baseX: f.basePos.x, baseZ: f.basePos.z, scoreBlue, scoreRed });
    return;
  }
  const f = flags[d.team]; if (!f) return;
  f.carrier = d.carrier; if (!d.carrier) f.mesh.position.set(d.baseX, 0, d.baseZ);
  scoreBlue = d.scoreBlue ?? scoreBlue; scoreRed = d.scoreRed ?? scoreRed; updateHud();
}
function onScoreUpdate(d) {
  scoreBlue = d.scoreBlue; scoreRed = d.scoreRed; updateHud();
  if (scoreBlue >= CAPTURES_TO_WIN || scoreRed >= CAPTURES_TO_WIN) endMatch(scoreBlue >= CAPTURES_TO_WIN ? 'blue' : 'red');
}
function onKillFeed(d) { killFeed(`${escapeHtml(d.killerName)} (${escapeHtml(d.killerIr || '')}) → ${escapeHtml(d.victimName)}${d.headshot ? ' 🎯' : ''}`); }
function onMatchEnd(d) { endMatch(d.winner || (d.blueScore > d.redScore ? 'blue' : 'red')); }

function resetFlagsOnDeath(entityId) {
  for (const team of ['blue', 'red']) {
    const f = flags[team]; if (!f) continue;
    if (f.carrier === entityId) {
      f.carrier = null; f.mesh.position.copy(f.basePos);
      if (!practiceMode) net.broadcastMatch('flag', { team, carrier: null, baseX: f.basePos.x, baseZ: f.basePos.z, scoreBlue, scoreRed });
    }
  }
}

/* ===== GAME ACTIONS ===== */
function die(killerId, headshot) {
  alive = false; respawnTimer = RESPAWN; deaths++; resetFlagsOnDeath(localId);
  const killer = players.get(killerId);
  net.broadcastMatch('kill', { killer: killerId, killerName: killer?.name || '?', killerIr: killer?.irId || '', victim: localId, victimName: localName, headshot });
  toast('YOU DIED');
}
function respawn() {
  alive = true; health = 100; invulnT = INVULN * 2;
  const baseX = localTeam === 'blue' ? -20 : 20;
  camera.position.set(baseX, H, 0); yaw = localTeam === 'blue' ? -Math.PI / 2 : Math.PI / 2; pitch = 0; updateHud();
}

function shoot() {
  if (!running || paused || customizing || gameOver || !alive) return;
  const now = performance.now(); if (now - lastShot < 180 || reloadT > 0) return;
  lastShot = now; if (ammo <= 0) { startReload(); return; }
  ammo--; recoil = Math.min(recoil + .06, .2); cameraShake = Math.min(cameraShake + .12, .35);
  if (gunGroup) gunGroup.userData.kick = 0.12; spawnMuzzleFlash();
  const ch = $('crosshair'); ch.classList.add('fired'); setTimeout(() => ch.classList.remove('fired'), 60); updateHud();

  const from = camera.position.clone(); const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  const candidates = [];
  if (practiceMode && practiceVariant === 'range') {
    for (const t of targets) if (t.alive) t.hitParts.forEach(m => { m.userData.__target = t; candidates.push(m); });
  } else if (practiceMode && practiceVariant === 'botmatch') {
    for (const b of bots) if (b.alive && b.team !== localTeam) b.hitParts.forEach(m => { m.userData.__bot = b; candidates.push(m); });
  } else {
    players.forEach(p => { if (p.team !== localTeam && p.alive) p.hitParts.forEach(m => { m.userData.__pid = p.id; candidates.push(m); }); });
  }
  candidates.push(...wallMeshes);

  raycaster.set(from, dir); raycaster.far = 100;
  const hits = raycaster.intersectObjects(candidates, false);
  let end = from.clone().add(dir.clone().multiplyScalar(100)); let hitInfo = null;

  if (hits.length) {
    const h = hits[0]; end = h.point.clone(); const isHead = h.object.userData.isHead === true;
    if (practiceMode && practiceVariant === 'range') {
      const t = h.object.userData.__target;
      if (t && t.alive) {
        t.alive = false; t.respawnTimer = 1.2; triggerDeathAnim(t.group);
        setTimeout(() => { if (t.group) t.group.visible = false; }, 500);
        spawnDamageNumber(t.group.position.x, 1.5, t.group.position.z, isHead ? '100' : '35', isHead);
        spawnImpact(h.point.x, h.point.y, h.point.z, 0xff4c73); showHitMarker(isHead);
        if (isHead) headshots++; killFeed(isHead ? '🎯 HEADSHOT' : '💥 HIT');
      }
    } else if (practiceMode && practiceVariant === 'botmatch') {
      const b = h.object.userData.__bot;
      if (b && b.alive) {
        const dmg = isHead ? 100 : 35; b.hp -= dmg; triggerHitAnim(b.group);
        spawnDamageNumber(b.group.position.x, 1.5, b.group.position.z, String(dmg), isHead);
        spawnImpact(h.point.x, h.point.y, h.point.z, 0xff4c73); showHitMarker(isHead);
        if (isHead) headshots++;
        if (b.hp <= 0) {
          b.alive = false; b.respawnTimer = RESPAWN; triggerDeathAnim(b.group);
          setTimeout(() => { if (b.group) b.group.visible = false; }, 500);
          b.carrying = null; resetFlagsOnDeath(b.id); kills++; killFeed(isHead ? '🎯 HEADSHOT' : '💥 KILL');
        }
      }
    } else {
      const pid = h.object.userData.__pid;
      if (pid) {
        hitInfo = { id: pid, headshot: isHead };
        net.broadcastMatch('hit', { target: pid, damage: isHead ? 100 : 35, headshot: isHead, shooter: localId });
        spawnDamageNumber(h.point.x, 1.5, h.point.z, isHead ? '100' : '35', isHead);
        spawnImpact(h.point.x, h.point.y, h.point.z, 0xff4c73); showHitMarker(isHead); if (isHead) headshots++;
      }
    }
  } else {
    const wallHit = raycaster.intersectObjects(wallMeshes, false);
    if (wallHit.length) spawnImpact(wallHit[0].point.x, wallHit[0].point.y, wallHit[0].point.z, 0xffffff);
  }
  if (!practiceMode) net.broadcastMatch('shot', { shooter: localId, from: from.toArray(), to: end.toArray(), hit: hitInfo });
  if (ammo === 0) startReload();
}

function showHitMarker(isHead) {
  $('hit').textContent = isHead ? '🎯' : '✕'; $('hit').classList.toggle('headshot', isHead);
  $('hit').classList.add('show'); setTimeout(() => $('hit').classList.remove('show'), 180);
}
function startReload() { if (reloadT > 0 || ammo === 12) return; reloadT = 1.15; toast('RELOADING'); }
function tryDash() {
  if (!alive || dashCd > 0 || dashT > 0) return;
  let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - my;
  let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + mx;
  if (Math.abs(f) < .1 && Math.abs(s) < .1) { f = 1; s = 0; }
  const len = Math.hypot(f, s); f /= len; s /= len;
  dashDirX = -Math.sin(yaw) * f + Math.cos(yaw) * s; dashDirZ = -Math.cos(yaw) * f - Math.sin(yaw) * s;
  dashT = DASH_DUR; dashCd = DASH_CD; dashWhoosh = 0.2;
}

/* ===== BOT AI ===== */
function findBotTarget(bot) {
  let nearest = null, bestDist = 60;
  for (const p of players.values()) { if (p.team === bot.team || !p.alive) continue; const d = p.group.position.distanceTo(bot.group.position); if (d < bestDist) { bestDist = d; nearest = { pos: p.group.position, ref: p }; } }
  for (const other of bots) { if (other === bot || other.team === bot.team || !other.alive) continue; const d = other.group.position.distanceTo(bot.group.position); if (d < bestDist) { bestDist = d; nearest = { pos: other.group.position, ref: other }; } }
  if (alive && localTeam !== bot.team) { const d = Math.hypot(camera.position.x - bot.group.position.x, camera.position.z - bot.group.position.z); if (d < bestDist) { bestDist = d; nearest = { pos: camera.position, ref: null, isLocal: true }; } }
  return nearest;
}
function botFire(bot) {
  const diff = DIFFICULTY[practiceDifficulty]; const target = findBotTarget(bot); if (!target) return;
  const tx = bot.group.position.x, tz = bot.group.position.z; const err = (1 - diff.accuracy) * 1.5;
  const ax = target.pos.x + rand(-err, err), az = target.pos.z + rand(-err, err);
  const dx = ax - tx, dz = az - tz; const dist = Math.hypot(dx, dz) || 1;
  const vx = dx / dist * diff.projectileSpeed, vz = dz / dist * diff.projectileSpeed;
  
  spawnBotFlash(tx, tz, bot.team === 'blue' ? 0x44d7ff : 0xff3060); // Bot Muzzle flash!
  
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), new THREE.MeshBasicMaterial({ color: bot.team === 'blue' ? 0x44d7ff : 0xff3060 }));
  mesh.position.set(tx, 1.2, tz); scene.add(mesh);
  projectiles.push({ mesh, vx, vz, life: 4, dmg: diff.dmg, team: bot.team });
}
function rangeTargetFire(target) {
  if (!alive) return;
  const tx = target.group.position.x, tz = target.group.position.z; const px = camera.position.x, pz = camera.position.z;
  const dist = Math.hypot(px - tx, pz - tz); if (dist < 2 || dist > 30) return;
  const err = 1.8; const ax = px + rand(-err, err), az = pz + rand(-err, err);
  const dx = ax - tx, dz = az - tz; const dl = Math.hypot(dx, dz) || 1;
  const vx = dx / dl * RANGE_PROJ_SPEED, vz = dz / dl * RANGE_PROJ_SPEED;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3060 }));
  mesh.position.set(tx, 1.2, tz); scene.add(mesh);
  projectiles.push({ mesh, vx, vz, life: 4, dmg: RANGE_DMG, team: 'red' });
}

function updateBots(dt, t) {
  const diff = DIFFICULTY[practiceDifficulty];
  for (const bot of bots) {
    if (!bot.alive) {
      bot.respawnTimer -= dt;
      if (bot.respawnTimer <= 0) {
        bot.alive = true; bot.hp = 100; bot.group.visible = true;
        bot.group.position.set(bot.baseX, 0, bot.baseZ); bot.carrying = null; resetHumanoidAnim(bot.group);
      }
      continue;
    }
    const combat = findBotTarget(bot); const enemyTeam = bot.team === 'blue' ? 'red' : 'blue';
    const enemyFlag = flags[enemyTeam]; const ownFlag = flags[bot.team];
    let targetX = bot.group.position.x, targetZ = bot.group.position.z;

    if (bot.hp < BOT_RETREAT_HP) { targetX = bot.team === 'blue' ? -21 : 21; targetZ = rand(-4, 4); }
    else if (bot.carrying) { targetX = bot.team === 'blue' ? -21 : 21; targetZ = 0; }
    else if (enemyFlag && !enemyFlag.carrier) { targetX = enemyFlag.mesh.position.x; targetZ = enemyFlag.mesh.position.z; }
    else if (ownFlag && ownFlag.carrier && ownFlag.carrier !== bot.id) {
      const carrier = findEntityById(ownFlag.carrier);
      if (carrier) { targetX = carrier.group ? carrier.group.position.x : carrier.position.x; targetZ = carrier.group ? carrier.group.position.z : carrier.position.z; }
    } else if (combat) {
      const dx = combat.pos.x - bot.group.position.x; const dz = combat.pos.z - bot.group.position.z;
      const dist = Math.hypot(dx, dz) || 1; const perpX = -dz / dist, perpZ = dx / dist;
      const strafe = Math.sin(t * 2 + bot.strafePhase) * 3;
      targetX = combat.pos.x + perpX * strafe; targetZ = combat.pos.z + perpZ * strafe;
    }
    steerMove(bot, targetX, targetZ, diff.speed, dt);
    if (combat) { const fdx = combat.pos.x - bot.group.position.x; const fdz = combat.pos.z - bot.group.position.z; bot.group.rotation.y = Math.atan2(-fdx, -fdz); }
    bot.fireTimer -= dt;
    if (bot.fireTimer <= 0) { botFire(bot); bot.fireTimer = rand(diff.fireDelay[0], diff.fireDelay[1]); bot.isAiming = true; } else bot.isAiming = false;

    for (const team of ['blue', 'red']) {
      const f = flags[team]; if (f.carrier || bot.team === team) continue;
      const fdx = bot.group.position.x - f.mesh.position.x; const fdz = bot.group.position.z - f.mesh.position.z;
      if (fdx * fdx + fdz * fdz < STEAL_RANGE * STEAL_RANGE) { f.carrier = bot.id; bot.carrying = team; }
    }
    if (bot.carrying) {
      const ownBaseX = bot.team === 'blue' ? -21 : 21; const bx = bot.group.position.x - ownBaseX; const bz = bot.group.position.z;
      if (bx * bx + bz * bz < TREASURE_RANGE * TREASURE_RANGE) {
        if (bot.team === 'blue') scoreBlue++; else scoreRed++;
        flags[bot.carrying].carrier = null; flags[bot.carrying].mesh.position.copy(flags[bot.carrying].basePos); bot.carrying = null; updateHud();
        if (scoreBlue >= CAPTURES_TO_WIN || scoreRed >= CAPTURES_TO_WIN) { endMatch(scoreBlue >= CAPTURES_TO_WIN ? 'blue' : 'red'); return; }
      }
    }
    for (const team of ['blue', 'red']) { if (flags[team].carrier === bot.id) flags[team].mesh.position.set(bot.group.position.x, 0, bot.group.position.z); }
    const botMoved = bot.group.position.distanceTo(bot.prevPos) > 0.01; bot.prevPos.copy(bot.group.position);
    updateHumanoidAnim(bot.group, dt, botMoved, bot.isAiming);
    if (frameCount % 3 === 0) {
      const wp = new THREE.Vector3(bot.group.position.x, 2.3, bot.group.position.z); const sp = wp.clone().project(camera);
      if (sp.z < 1) { bot.label.style.left = (sp.x * .5 + .5) * innerWidth + 'px'; bot.label.style.top = (-sp.y * .5 + .5) * innerHeight + 'px'; bot.label.style.display = ''; } else bot.label.style.display = 'none';
    }
  }
}
function findEntityById(id) { if (id === localId) return { position: camera.position, isLocal: true, team: localTeam, alive }; const p = players.get(id); if (p) return p; const b = bots.find(b => b.id === id); if (b) return b; return null; }

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]; p.mesh.position.x += p.vx * dt; p.mesh.position.z += p.vz * dt; p.life -= dt;
    if (p.team !== localTeam && alive && invulnT <= 0) {
      const dx = p.mesh.position.x - camera.position.x; const dz = p.mesh.position.z - camera.position.z;
      if (dx * dx + dz * dz < 1.2) {
        health = Math.max(0, health - p.dmg); invulnT = INVULN; cameraShake = Math.min(cameraShake + .4, .7);
        $('damage-vignette').classList.add('on'); setTimeout(() => $('damage-vignette').classList.remove('on'), 200); updateHud();
        if (health <= 0) { if (practiceMode) { alive = false; respawnTimer = RESPAWN; resetFlagsOnDeath(localId); toast('KILLED'); } else die(null, false); }
        scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); projectiles.splice(i, 1); continue;
      }
    }
    let hitBot = false;
    for (const b of bots) {
      if (!b.alive || b.team === p.team) continue;
      const dx = p.mesh.position.x - b.group.position.x; const dz = p.mesh.position.z - b.group.position.z;
      if (dx * dx + dz * dz < 1.2) {
        b.hp -= p.dmg; triggerHitAnim(b.group); hitBot = true;
        if (b.hp <= 0) { b.alive = false; b.respawnTimer = RESPAWN; triggerDeathAnim(b.group); setTimeout(() => { if (b.group) b.group.visible = false; }, 500); b.carrying = null; resetFlagsOnDeath(b.id); }
        break;
      }
    }
    if (hitBot) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); projectiles.splice(i, 1); continue; }
    const inWall = isBlocked(p.mesh.position.x, p.mesh.position.z, 0);
    if (p.life <= 0 || inWall) {
      spawnImpact(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 0xffffff);
      scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); projectiles.splice(i, 1);
    }
  }
}
function clearBotsAndProjectiles() {
  removeAllBots();
  for (const p of projectiles) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); } projectiles.length = 0;
  for (const e of effects) { if (e === muzzleFlash) continue; const mesh = e.mesh || e; scene.remove(mesh); if (mesh.geometry) mesh.geometry.dispose(); if (mesh.material) mesh.material.dispose(); } effects.length = 0;
  for (const dn of damageNumbers) { scene.remove(dn.sprite); if (dn.tex) dn.tex.dispose(); if (dn.sprite.material) dn.sprite.material.dispose(); } damageNumbers.length = 0;
}

/* ===== AIM LOCK ===== */
const losRay = new THREE.Raycaster();
function updateAimLock(dt) {
  if (!running || paused || gameOver || customizing) { aim.locked = null; return; }
  aim.locked = null;
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  let bestAngle = LOCK_CONE, bestRef = null;
  const checkTarget = (refId, x, z) => {
    const y = aim.lockPoint === 'head' ? 1.76 : 1.2;
    const dx = x - camera.position.x, dz = z - camera.position.z, dy = y - camera.position.y;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > LOCK_RANGE || dist < 0.5) return;
    const nx = dx / dist, ny = dy / dist, nz = dz / dist;
    const dot = forward.x * nx + forward.y * ny + forward.z * nz; const ang = Math.acos(clamp(dot, -1, 1));
    if (ang >= bestAngle) return;
    losRay.set(camera.position, new THREE.Vector3(nx, ny, nz)); losRay.far = dist;
    if (losRay.intersectObjects(wallMeshes, false).length > 0) return;
    bestAngle = ang; bestRef = refId;
  };
  if (practiceMode && practiceVariant === 'range') { targets.forEach((t, i) => { if (t.alive) checkTarget('t:' + i, t.group.position.x, t.group.position.z); }); }
  else if (practiceMode && practiceVariant === 'botmatch') { for (const b of bots) if (b.alive && b.team !== localTeam) checkTarget(b.id, b.group.position.x, b.group.position.z); }
  else { players.forEach(p => { if (p.team !== localTeam && p.alive) checkTarget(p.id, p.group.position.x, p.group.position.z); }); }
  if (bestRef) aim.locked = bestRef;
  if (aim.locked) {
    let tx = 0, tz = 0;
    if (aim.locked.startsWith?.('t:')) { const i = +aim.locked.split(':')[1]; const t = targets[i]; if (!t || !t.alive) { aim.locked = null; return; } tx = t.group.position.x; tz = t.group.position.z; }
    else if (practiceMode && practiceVariant === 'botmatch') { const b = bots.find(b => b.id === aim.locked); if (!b || !b.alive) { aim.locked = null; return; } tx = b.group.position.x; tz = b.group.position.z; }
    else { const p = players.get(aim.locked); if (!p || !p.alive) { aim.locked = null; return; } tx = p.group.position.x; tz = p.group.position.z; }
    const y = aim.lockPoint === 'head' ? 1.76 : 1.2; const dx = tx - camera.position.x, dz = tz - camera.position.z, dy = y - camera.position.y;
    const dist = Math.hypot(dx, dy, dz); const wantYaw = Math.atan2(-dx, -dz); const wantPitch = Math.asin(clamp(dy / dist, -1, 1));
    const ddy = wrapAngle(wantYaw - yaw), ddp = wantPitch - pitch; const drift = Math.hypot(ddy, ddp); const flickingUp = aim.upAccum > 30;
    losRay.set(camera.position, new THREE.Vector3(dx / dist, dy / dist, dz / dist)); losRay.far = dist;
    const blocked = losRay.intersectObjects(wallMeshes, false).length > 0;
    if ((drift > DRIFT_BREAK && !flickingUp) || blocked) { aim.locked = null; aim.lockPoint = 'chest'; }
    else { const pull = 1 - Math.exp(-dt * LOCK_PULL); yaw += ddy * pull * aim.assistStrength; pitch = clamp(pitch + ddp * pull * aim.assistStrength, -1.3, 1.3); }
  } else aim.lockPoint = 'chest';
  if (aim.headCd > 0) aim.headCd -= dt;
  if (aim.upWin > 0) { aim.upWin -= dt; if (aim.upWin <= 0) aim.upAccum = 0; }
  if (aim.locked && aim.lockPoint === 'chest' && aim.headCd <= 0 && aim.upAccum > HEAD_ACCUM) { aim.lockPoint = 'head'; aim.headCd = HEAD_CD; aim.upAccum = 0; }
  const ch = $('crosshair');
  if (ch) { ch.classList.toggle('locked', !!aim.locked); ch.classList.toggle('headlock', aim.lockPoint === 'head' && !!aim.locked); ch.classList.toggle('snap-ready', !!aim.locked && aim.lockPoint === 'chest' && aim.headCd <= 0); }
}

/* ===== HOST FLAG LOGIC ===== */
let flagTick = 0;
function hostFlagLogic(dt) {
  if (!isHost || practiceMode || !running) return;
  flagTick += dt; if (flagTick < 0.05) return; flagTick = 0;
  for (const team of ['blue', 'red']) {
    const f = flags[team]; if (!f.carrier) continue;
    const carrier = players.get(f.carrier);
    if (!carrier || !carrier.alive) { f.carrier = null; f.mesh.position.copy(f.basePos); net.broadcastMatch('flag', { team, carrier: null, baseX: f.basePos.x, baseZ: f.basePos.z, scoreBlue, scoreRed }); continue; }
    f.mesh.position.set(carrier.group.position.x, 0, carrier.group.position.z);
  }
}

/* ===== MATCH FLOW ===== */
function endMatch(winner) {
  if (gameOver) return; gameOver = true; running = false; document.exitPointerLock?.();
  $('go-title').textContent = winner === 'blue' ? 'BLUE WINS' : 'RED WINS';
  $('go-title').className = winner === localTeam ? 'win' : 'lose';
  $('go-blue').textContent = scoreBlue; $('go-red').textContent = scoreRed;
  $('gameover').classList.remove('hidden'); $('hud').classList.add('hidden');
  if (net.user && !practiceMode) { net.recordStats(matchId, [{ user_id: net.user.id, display_name: localName, ir_id: localIrId, team: localTeam, kills, deaths, captures, headshots }]).catch(() => {}); }
}
function leaveMatch() {
  running = false; gameOver = true; paused = false;
  if (practiceMode) { clearBotsAndProjectiles(); clearTargets(); } else { net.cleanup().catch(() => {}); for (const id of Array.from(players.keys())) removePlayer(id); }
  $('hud').classList.add('hidden'); $('pause').classList.add('hidden'); $('gameover').classList.add('hidden'); $('mobile').classList.add('hidden');
  $('steal-btn').classList.add('hidden'); $('treasure-btn').classList.add('hidden'); $('lobby').classList.remove('hidden');
  document.exitPointerLock?.(); practiceMode = false;
  if (!lobbyPreview) { lobbyPreview = new LobbyPreview($('lobby-canvas')); lobbyPreview.setColor(COLORS[playerColorKey].hex); requestAnimationFrame(() => lobbyPreview.resize()); }
}

/* ===== STEAL / TREASURE ===== */
function doSteal() {
  const enemyTeam = localTeam === 'blue' ? 'red' : 'blue'; const f = flags[enemyTeam];
  if (!f || f.carrier) return;
  const dx = camera.position.x - f.mesh.position.x, dz = camera.position.z - f.mesh.position.z;
  if (dx * dx + dz * dz > STEAL_RANGE * STEAL_RANGE) return;
  if (practiceMode) { f.carrier = localId; toast('FLAG STOLEN'); }
  else { net.broadcastMatch('flag', { type: 'steal', team: enemyTeam, stealer: localId }); toast('STEALING'); }
}
function doTreasure() {
  const enemyTeam = localTeam === 'blue' ? 'red' : 'blue'; const f = flags[enemyTeam];
  if (!f || f.carrier !== localId) return;
  const baseX = localTeam === 'blue' ? -21 : 21; const dx = camera.position.x - baseX, dz = camera.position.z;
  if (dx * dx + dz * dz > TREASURE_RANGE * TREASURE_RANGE) return;
  if (practiceMode) {
    if (localTeam === 'blue') scoreBlue++; else scoreRed++;
    f.carrier = null; f.mesh.position.copy(f.basePos); captures++; toast('TREASURED'); updateHud();
    if (scoreBlue >= CAPTURES_TO_WIN || scoreRed >= CAPTURES_TO_WIN) endMatch(scoreBlue >= CAPTURES_TO_WIN ? 'blue' : 'red');
  } else { net.broadcastMatch('flag', { type: 'capture', team: enemyTeam, carrier: localId }); toast('TREASURING'); }
}
function updateFlagButtons() {
  const stealBtn = $('steal-btn'), treasureBtn = $('treasure-btn');
  // Keep both action buttons visible in customization so they can be repositioned.
  if (customizing) {
    stealBtn.classList.remove('hidden');
    treasureBtn.classList.remove('hidden');
    return;
  }
  if (!running || paused || gameOver) { stealBtn.classList.add('hidden'); treasureBtn.classList.add('hidden'); return; }
  const enemyTeam = localTeam === 'blue' ? 'red' : 'blue'; const ef = flags[enemyTeam];
  let showSteal = false, showTreasure = false;
  if (ef && !ef.carrier && alive) { const dx = camera.position.x - ef.mesh.position.x, dz = camera.position.z - ef.mesh.position.z; if (dx * dx + dz * dz <= STEAL_RANGE * STEAL_RANGE) showSteal = true; }
  if (ef && ef.carrier === localId && alive) { const baseX = localTeam === 'blue' ? -21 : 21; const dx = camera.position.x - baseX, dz = camera.position.z; if (dx * dx + dz * dz <= TREASURE_RANGE * TREASURE_RANGE) showTreasure = true; }
  $('steal-btn').classList.toggle('hidden', !showSteal); $('treasure-btn').classList.toggle('hidden', !showTreasure);
}

/* ===== HUD ===== */
function updateHud() {
  $('health').textContent = Math.ceil(health); $('healthbar').style.width = health + '%'; $('ammo').innerHTML = ammo + ' <em>/ 12</em>';
  if (scoreBlue !== lastScoreBlue || scoreRed !== lastScoreRed) {
    const el = $('score-blue'), el2 = $('score-red');
    el.style.transform = 'scale(1.4)'; el.style.transition = 'none'; el2.style.transform = 'scale(1.4)'; el2.style.transition = 'none';
    requestAnimationFrame(() => { el.style.transition = 'transform 0.3s ease'; el.style.transform = 'scale(1)'; el2.style.transition = 'transform 0.3s ease'; el2.style.transform = 'scale(1)'; });
    lastScoreBlue = scoreBlue; lastScoreRed = scoreRed;
  }
  $('score-blue').textContent = scoreBlue; $('score-red').textContent = scoreRed;
  const timerEl = $('timer');
  if (practiceMode) { timerEl.textContent = '∞'; timerEl.classList.remove('low'); }
  else { const m = Math.floor(Math.max(0, roundTime) / 60); const s = Math.floor(Math.max(0, roundTime) % 60).toString().padStart(2, '0'); timerEl.textContent = `${m}:${s}`; timerEl.classList.toggle('low', roundTime < 30); }
  $('damage-vignette').classList.toggle('low-health', health > 0 && health < 25);
}
function toast(s) { $('toast').textContent = s; setTimeout(() => { if ($('toast').textContent === s) $('toast').textContent = ''; }, 1400); }
function killFeed(text) {
  const feed = $('killfeed'); const el = document.createElement('div'); el.className = 'feed-item'; el.textContent = text;
  feed.appendChild(el); while (feed.children.length > 5) feed.firstChild.remove();
  setTimeout(() => el.classList.add('out'), 1800); setTimeout(() => el.remove(), 2400);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

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
    if (e.code === 'Escape' && running && !customizing) { paused = !paused; $('pause').classList.toggle('hidden', !paused); }
  });
  document.addEventListener('keyup', e => keys[e.code] = false);
  renderer.domElement.addEventListener('pointerdown', e => {
    if (!running || paused || customizing) return;
    if (!document.fullscreenElement) lockLandscape();
    if (!touch) { fire = true; if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock?.(); }
    else if (e.clientX > innerWidth * .42) { aimId = e.pointerId; lastX = e.clientX; lastY = e.clientY; }
  });
  document.addEventListener('pointerup', () => { if (!touch) fire = false; });
  document.addEventListener('pointercancel', () => { if (!touch) fire = false; });
  addEventListener('blur', () => { fire = false; jump = false; Object.keys(keys).forEach(k => delete keys[k]); });
  document.addEventListener('mousemove', e => {
    if (running && !paused && !customizing && !touch && document.pointerLockElement === renderer.domElement) {
      const sens = .0022 * aim.sensitivity; yaw -= e.movementX * sens; pitch = clamp(pitch - e.movementY * sens, -1.3, 1.3);
      if (aim.locked && aim.lockPoint === 'chest' && e.movementY < 0) { aim.upAccum += -e.movementY; aim.upWin = .15; }
    }
  });
  renderer.domElement.addEventListener('pointermove', e => {
    if (touch && e.pointerId === aimId && !customizing) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY; const sens = .006 * aim.sensitivity;
      yaw -= dx * sens; pitch = clamp(pitch - dy * sens, -1.2, 1.2); lastX = e.clientX; lastY = e.clientY;
      if (aim.locked && aim.lockPoint === 'chest' && dy < 0) { aim.upAccum += -dy; aim.upWin = .15; }
    }
  });
  const stopAim = e => { if (e.pointerId === aimId) aimId = null; };
  renderer.domElement.addEventListener('pointerup', stopAim); renderer.domElement.addEventListener('pointercancel', stopAim);
  
  const zone = $('joy-zone'), base = $('joy-base'), knob = $('joy-knob');
  zone.addEventListener('pointerdown', e => {
    if (!running || paused || customizing) return;
    joyId = e.pointerId; zone.setPointerCapture(e.pointerId); joystickMove(e, base, knob);
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId === joyId && !customizing) joystickMove(e, base, knob); });
  const stopJoy = e => { if (e.pointerId === joyId) { joyId = null; mx = my = 0; knob.style.transform = 'translate(0,0)'; } };
  zone.addEventListener('pointerup', stopJoy); zone.addEventListener('pointercancel', stopJoy);
  
  const fireBtn = $('fire-btn');
  fireBtn.addEventListener('pointerdown', e => { if(customizing) return; e.preventDefault(); fire = true; try { fireBtn.setPointerCapture(e.pointerId); } catch (_) {} });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => fireBtn.addEventListener(t, () => fire = false));
  
  $('jump-btn').addEventListener('pointerdown', e => { if(customizing) return; e.preventDefault(); jump = true; });
  $('reload-btn').addEventListener('pointerdown', e => { if(customizing) return; e.preventDefault(); startReload(); });
  $('dash-btn').addEventListener('pointerdown', e => { if(customizing) return; e.preventDefault(); tryDash(); });
  $('steal-btn').addEventListener('click', () => { if(!customizing) doSteal(); });
  $('treasure-btn').addEventListener('click', () => { if(!customizing) doTreasure(); });
  
  $('pause-btn').addEventListener('click', () => { paused = true; $('pause').classList.remove('hidden'); document.exitPointerLock?.(); });
  $('resume-btn').addEventListener('click', () => { paused = false; $('pause').classList.add('hidden'); if (!touch) renderer.domElement.requestPointerLock?.(); });
  
  $('customize-btn').addEventListener('click', () => {
    customizing = true; $('pause').classList.add('hidden'); $('custom-grid').classList.remove('hidden'); $('mobile').classList.remove('hidden');
  });
  $('btn-save-custom').addEventListener('click', () => {
    saveCustomLayout(); customizing = false; $('custom-grid').classList.add('hidden'); $('pause').classList.remove('hidden');
  });
  
  $('leave-match-btn').addEventListener('click', () => leaveMatch());
  $('go-lobby').addEventListener('click', () => leaveMatch());
}
function joystickMove(e, b, k) {
  const r = b.getBoundingClientRect(); let x = e.clientX - (r.left + r.width / 2); let y = e.clientY - (r.top + r.height / 2);
  const l = Math.hypot(x, y) || 1; if (l > 42) { x = x / l * 42; y = y / l * 42; } mx = x / 42; my = y / 42;
  k.style.transform = `translate(${x}px,${y}px)`;
}

/* ===== UPDATE LOOP ===== */
function update(dt, t) {
  if (!running || paused || customizing || gameOver) return;
  frameCount++; matchElapsed += dt;

  if (!practiceMode) { roundTime -= dt; if (roundTime <= 0) { roundTime = 0; endMatch(scoreBlue > scoreRed ? 'blue' : 'red'); return; } }
  playerVel.set((camera.position.x - lastPlayerPos.x) / Math.max(dt, 0.001), 0, (camera.position.z - lastPlayerPos.z) / Math.max(dt, 0.001)); lastPlayerPos.copy(camera.position);

  if (!alive) { respawnTimer -= dt; if (respawnTimer <= 0) respawn(); }

  let movedThisFrame = false;
  if (alive) {
    let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - my;
    let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + mx;
    const len = Math.hypot(f, s) || 1; f /= Math.max(1, len); s /= Math.max(1, len);
    const hitWall = (x, z) => isBlocked(x, z, .38); const px0 = camera.position.x, pz0 = camera.position.z;
    if (dashT > 0) {
      dashT -= dt; const nx = clamp(camera.position.x + dashDirX * DASH_SPEED * dt, -24, 24); const nz = clamp(camera.position.z + dashDirZ * DASH_SPEED * dt, -24, 24);
      if (!hitWall(nx, camera.position.z)) camera.position.x = nx; if (!hitWall(camera.position.x, nz)) camera.position.z = nz;
    } else {
      const nx = clamp(camera.position.x + (-Math.sin(yaw) * f + Math.cos(yaw) * s) * SPEED * dt, -24, 24);
      const nz = clamp(camera.position.z + (-Math.cos(yaw) * f - Math.sin(yaw) * s) * SPEED * dt, -24, 24);
      if (!hitWall(nx, camera.position.z)) camera.position.x = nx; if (!hitWall(camera.position.x, nz)) camera.position.z = nz;
    }
    if (dashCd > 0) dashCd -= dt; movedThisFrame = Math.hypot(camera.position.x - px0, camera.position.z - pz0) > 0.005;
    if (jump && onGround) { vy = 6.5; onGround = false; } jump = false; vy -= 18 * dt; camera.position.y += vy * dt;
    if (camera.position.y <= H) { if (!onGround && vy < -3) landingDip = 0.15; camera.position.y = H; vy = 0; onGround = true; }
  }
  if (recoil > 0) recoil = Math.max(0, recoil - dt * .4);
  if (invulnT > 0) invulnT -= dt;
  updateAimLock(dt);

  if (cameraShake > 0) { cameraShake = Math.max(0, cameraShake - dt * 1.8); shakeX = (Math.random() - .5) * cameraShake * .04; shakeY = (Math.random() - .5) * cameraShake * .04; } else { shakeX = shakeY = 0; }

  if (movedThisFrame) walkBob += dt * 12;
  const bobY = movedThisFrame ? Math.sin(walkBob) * 0.04 : 0; if (landingDip > 0) landingDip -= dt * 0.8;
  const landY = landingDip > 0 ? -landingDip * 0.4 : 0; if (dashWhoosh > 0) dashWhoosh -= dt;
  const dashZ = dashWhoosh > 0 ? dashWhoosh * 0.5 : 0;

  camera.rotation.set(pitch + recoil + shakeY, yaw + shakeX, 0, 'YXZ');
  if (gunGroup) {
    let kick = gunGroup.userData.kick || 0; if (kick > 0) { kick -= dt * 1.2; gunGroup.userData.kick = Math.max(0, kick); }
    const swayX = Math.sin(t * 8) * 0.005 * (movedThisFrame ? 1 : 0.3); const swayY = Math.cos(t * 10) * 0.003 * (movedThisFrame ? 1 : 0.3);
    gunGroup.position.x = .22 + swayX; gunGroup.position.y = -.2 + swayY + (kick * 0.15) + bobY * 0.5 + landY; gunGroup.position.z = -.45 + (kick * 0.1) + dashZ;
    gunGroup.rotation.x = -kick * 0.6;
  }
  if (muzzleFlash && muzzleFlash.material.opacity > 0) muzzleFlash.material.opacity = Math.max(0, muzzleFlash.material.opacity - dt * 20);

  updateAmbientParticles(ambientParticles, dt);
  if (flags.blue) updateFlagWave(flags.blue.mesh, t); if (flags.red) updateFlagWave(flags.red.mesh, t);

  // ===== ANIME-STYLE BATTLEFIELD ANIMATIONS =====
  // Blocks keep their exact gameplay positions and collision sizes; glow and outline pulse.
  wallMeshes.forEach((mesh, index) => {
    if (mesh.material && 'emissiveIntensity' in mesh.material) {
      mesh.material.emissiveIntensity = 0.18 + (Math.sin(t * 3.2 + index * 0.8) + 1) * 0.24;
    }
  });
  coverGlowEdges.forEach(({ mesh, material, phase }) => {
    const wave = (Math.sin(t * 3.6 + phase) + 1) * 0.5;
    material.opacity = 0.38 + wave * 0.58;
  });

  // Center battlefield rings rotate in opposite directions and breathe with light.
  centerEnergyRings.forEach(({ mesh, speed, phase }) => {
    mesh.rotation.z += dt * speed;
    const pulse = 1 + Math.sin(t * 2.7 + phase) * 0.045;
    mesh.scale.set(pulse, pulse, 1);
    mesh.material.opacity = 0.2 + (Math.sin(t * 3.4 + phase) + 1) * 0.24;
  });

  // Smooth orbiting energy sparks add motion while keeping the arena lightweight on mobile.
  battlefieldSparks.forEach(({ mesh, angle, radius, speed, phase, height }) => {
    const a = angle + t * speed;
    mesh.position.set(Math.cos(a) * radius, height + (Math.sin(t * 2.4 + phase) + 1) * 0.22, Math.sin(a) * radius);
    const pulse = 0.72 + (Math.sin(t * 4 + phase) + 1) * 0.2;
    mesh.scale.setScalar(pulse);
    mesh.material.opacity = 0.38 + (Math.sin(t * 3.5 + phase) + 1) * 0.28;
  });

  // Rotating, pulsing team energy rings.
  if (baseBlueRing && baseRedRing) {
    baseBlueRing.rotation.z += dt * 0.5;
    baseRedRing.rotation.z -= dt * 0.5;
    const pulse = 1 + Math.sin(t * 4) * 0.05;
    baseBlueRing.scale.set(pulse, pulse, pulse);
    baseRedRing.scale.set(pulse, pulse, pulse);
    baseBlueRing.material.opacity = 0.42 + (Math.sin(t * 3) + 1) * 0.12;
    baseRedRing.material.opacity = 0.42 + (Math.sin(t * 3 + Math.PI) + 1) * 0.12;
  }

  // Flowing floor-grid motion with a stronger travelling light pulse.
  if (floorGrid) {
    floorGrid.position.z = (t * 1.2) % 2;
    floorGrid.position.x = Math.sin(t * 0.32) * 0.22;
    const gridOpacity = 0.48 + (Math.sin(t * 2.2) + 1) * 0.24;
    for (const material of (Array.isArray(floorGrid.material) ? floorGrid.material : [floorGrid.material])) {
      material.transparent = true;
      material.opacity = gridOpacity;
    }
  }

  // Ambient scenery animation: floating shards, glowing armor markings and perimeter energy.
  animeDecor.forEach(({mesh,kind,phase,baseY}) => {
    if (kind === 'pylon') { mesh.rotation.y += dt * .7; mesh.rotation.x += dt * .22; }
    else if (kind === 'shard') { mesh.rotation.x += dt * .35; mesh.rotation.y += dt * .55; mesh.position.y = baseY + Math.sin(t * 1.8 + phase) * .22; }
    else if (kind === 'edge') { mesh.material.opacity = .48 + (Math.sin(t * 3.5 + phase)+1)*.24; }
    else if (kind === 'sigil') { mesh.material.opacity = .45 + (Math.sin(t * 4 + phase)+1)*.25; }
    else if (kind === 'rail') { mesh.material.opacity = .62 + (Math.sin(t * 2.4 + phase)+1)*.18; }
  });

  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]; if (e === muzzleFlash) { effects.splice(i, 1); continue; }
    if (e.isImpact) {
      e.life -= dt; const sc = 1 + (1 - e.life / e.maxLife) * 3; e.mesh.scale.setScalar(sc); e.mesh.material.opacity = e.life / e.maxLife;
      if (e.life <= 0) { scene.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); effects.splice(i, 1); }
    }
  }
  for (let i = damageNumbers.length - 1; i >= 0; i--) {
    const dn = damageNumbers[i]; dn.life -= dt; dn.sprite.position.y += dt * 1.5; dn.sprite.material.opacity = dn.life / dn.maxLife;
    if (dn.life <= 0) { scene.remove(dn.sprite); dn.tex.dispose(); dn.sprite.material.dispose(); damageNumbers.splice(i, 1); }
  }

  if (fire && alive) shoot();
  if (reloadT > 0) { reloadT -= dt; if (reloadT <= 0) { ammo = 12; updateHud(); toast('RELOADED'); } }
  
  for (const p of players.values()) {
    p.prevPos = p.prevPos || new THREE.Vector3().copy(p.group.position);
    p.group.position.lerp(p.targetPos, Math.min(1, dt * 10)); p.group.position.y = 0; p.group.rotation.y = p.yaw;
    const moved = p.group.position.distanceTo(p.prevPos) > 0.01; p.prevPos.copy(p.group.position);
    updateHumanoidAnim(p.group, dt, moved, false);
    if (frameCount % 3 === 0) {
      const wp = new THREE.Vector3(p.group.position.x, 2.3, p.group.position.z); const sp = wp.clone().project(camera);
      if (sp.z < 1) { p.label.style.left = (sp.x * .5 + .5) * innerWidth + 'px'; p.label.style.top = (-sp.y * .5 + .5) * innerHeight + 'px'; p.label.style.display = ''; } else p.label.style.display = 'none';
    }
    if (flags.blue?.carrier === p.id) flags.blue.mesh.position.set(p.group.position.x, 0, p.group.position.z);
    if (flags.red?.carrier === p.id) flags.red.mesh.position.set(p.group.position.x, 0, p.group.position.z);
  }

  if (practiceMode) {
    if (practiceVariant === 'range') {
      for (const target of targets) {
        if (!target.alive) {
          target.respawnTimer -= dt;
          if (target.respawnTimer <= 0) {
            target.alive = true; target.group.visible = true; resetHumanoidAnim(target.group);
            const angle = Math.random() * Math.PI * 2; const radius = rand(8, 15);
            target.baseX = Math.cos(angle) * radius; target.baseZ = Math.sin(angle) * radius; target.group.position.set(target.baseX, 0, target.baseZ);
          }
          continue;
        }
        target.group.position.x = target.baseX + Math.sin(t * target.speed + target.phase) * 1.5; target.group.position.z = target.baseZ + Math.cos(t * target.speed * .7 + target.phase) * 0.8; target.group.rotation.y = Math.sin(t + target.phase) * .15;
        updateHumanoidAnim(target.group, dt, true, false);
        target.fireTimer -= dt; if (target.fireTimer <= 0) { rangeTargetFire(target); target.fireTimer = rand(RANGE_FIRE_DELAY[0], RANGE_FIRE_DELAY[1]); }
      }
      updateProjectiles(dt);
    } else if (practiceVariant === 'botmatch') { updateBots(dt, t); updateProjectiles(dt); }
    for (const team of ['blue', 'red']) { if (flags[team].carrier === localId && alive) flags[team].mesh.position.set(camera.position.x, 0, camera.position.z); }
  } else {
    hostFlagLogic(dt);
    if (flags.blue?.carrier === localId && alive) flags.blue.mesh.position.set(camera.position.x, 0, camera.position.z);
    if (flags.red?.carrier === localId && alive) flags.red.mesh.position.set(camera.position.x, 0, camera.position.z);
  }

  if (!practiceMode) {
    stateBroadcastTimer += dt;
    if (stateBroadcastTimer > 1 / BROADCAST_HZ) {
      stateBroadcastTimer = 0;
      net.broadcastMatch('state', { id: localId, pos: [camera.position.x, 0, camera.position.z], yaw, pitch, hp: health, alive, hasFlag: flags.blue?.carrier === localId ? 'blue' : (flags.red?.carrier === localId ? 'red' : null) });
    }
  }
  const gap = 3 + (movedThisFrame ? 3 : 1) + recoil * 40; document.documentElement.style.setProperty('--cross-gap', gap.toFixed(1) + 'px');
  updateFlagButtons(); updateHud();
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), .04);
  if (scene && renderer && camera) { update(dt, clock.elapsedTime); renderer.render(scene, camera); }
}

/* ===== MATCH START ===== */
function enterMatch(match, allPlayers) {
  lockLandscape(); matchId = match.id; matchMode = match.mode || 'standard'; roundTime = MODES[matchMode].matchTime; scoreBlue = match.blue_score || 0; scoreRed = match.red_score || 0;
  gameOver = false; practiceMode = false; kills = deaths = captures = headshots = 0; matchElapsed = 0;
  $('lobby').classList.add('hidden'); $('room').classList.add('hidden'); $('hud').classList.remove('hidden'); if (touch) $('mobile').classList.remove('hidden');
  for (const id of Array.from(players.keys())) removePlayer(id);
  let myTeam = 'blue';
  for (const p of allPlayers) { if (p.user_id === localId) { myTeam = p.team; continue; } addPlayer(p.user_id, p.display_name, p.ir_id || '', p.team); }
  localTeam = myTeam; flags.blue.mesh.position.copy(flags.blue.basePos); flags.red.mesh.position.copy(flags.red.basePos); flags.blue.carrier = flags.red.carrier = null;
  const baseX = localTeam === 'blue' ? -20 : 20; camera.position.set(baseX, H, 0); lastPlayerPos.copy(camera.position); yaw = localTeam === 'blue' ? -Math.PI / 2 : Math.PI / 2; pitch = 0;
  health = 100; alive = true; ammo = 12; reloadT = 0; invulnT = 1;
  net.subscribeMatch(matchId, {
    onState: onMatchState, onShot: onShotFired, onHit: onHitReceived, onFlag: onFlagUpdate, onScore: onScoreUpdate, onKill: onKillFeed, onEnd: onMatchEnd,
    onJoined: () => { running = true; if (!touch) renderer.domElement.requestPointerLock?.(); },
  });
  updateHud();
}

function enterPractice(variant) {
  lockLandscape(); practiceMode = true; practiceVariant = variant; gameOver = false; running = true; paused = false; matchId = null;
  localTeam = 'blue'; scoreBlue = scoreRed = 0; lastScoreBlue = 0; lastScoreRed = 0; kills = deaths = captures = headshots = 0; matchElapsed = 0;
  $('lobby').classList.add('hidden'); $('room').classList.add('hidden'); $('hud').classList.remove('hidden'); if (touch) $('mobile').classList.remove('hidden');
  clearBotsAndProjectiles(); clearTargets();
  if (variant === 'range') { for (let i = 0; i < 6; i++) addRangeTarget(); }
  else { addBot('Blue 1', 'blue'); addBot('Blue 2', 'blue'); addBot('Red 1', 'red'); addBot('Red 2', 'red'); addBot('Red 3', 'red'); }
  flags.blue.mesh.position.copy(flags.blue.basePos); flags.red.mesh.position.copy(flags.red.basePos); flags.blue.carrier = flags.red.carrier = null;
  camera.position.set(-20, H, 0); lastPlayerPos.copy(camera.position); yaw = -Math.PI / 2; pitch = 0;
  health = 100; alive = true; ammo = 12; reloadT = 0; invulnT = 1; updateHud();
  if (!touch) renderer.domElement.requestPointerLock?.();
}

/* ===== LOBBY ===== */
function showLobby() {
  running = false; gameOver = true; paused = false; customizing = false;
  $('lobby').classList.remove('hidden'); $('hud').classList.add('hidden'); $('pause').classList.add('hidden'); $('gameover').classList.add('hidden'); $('custom-grid').classList.add('hidden');
  $('sens-slider').value = aim.sensitivity; $('sens-val').textContent = aim.sensitivity.toFixed(1);
  $('assist-slider').value = Math.round(aim.assistStrength * 100); $('assist-val').textContent = Math.round(aim.assistStrength * 100) + '%';
  $('vol-slider').value = Math.round((+(store.get('rivals-vol', 50)))); $('vol-val').textContent = $('vol-slider').value + '%';
  $('lobby-name').textContent = `${localName} · ${localIrId}`;
  document.querySelectorAll('.mode-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.mode === gameMode));
  $('mode-desc').textContent = MODES[gameMode].desc;
  $('practice-panel').classList.toggle('hidden', gameMode !== 'practice'); $('match-panel').classList.toggle('hidden', gameMode === 'practice');
  document.querySelectorAll('.swatch').forEach(b => b.classList.toggle('active', b.dataset.color === playerColorKey)); $('color-name').textContent = COLORS[playerColorKey].name;
  document.querySelectorAll('.diff-tab').forEach(b => b.classList.toggle('active', b.dataset.diff === practiceDifficulty));
  if (!lobbyPreview) { lobbyPreview = new LobbyPreview($('lobby-canvas')); lobbyPreview.setColor(COLORS[playerColorKey].hex); requestAnimationFrame(() => lobbyPreview.resize()); }
  else { lobbyPreview.setColor(COLORS[playerColorKey].hex); lobbyPreview.resize(); }
}

function bindLobby() {
  $('lobby').addEventListener('pointerdown', () => { lockLandscape(); }, { once: true });
  document.querySelectorAll('.mode-tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      gameMode = btn.dataset.mode; document.querySelectorAll('.mode-tabs .tab').forEach(b => b.classList.remove('active')); btn.classList.add('active');
      $('mode-desc').textContent = MODES[gameMode].desc; $('practice-panel').classList.toggle('hidden', gameMode !== 'practice'); $('match-panel').classList.toggle('hidden', gameMode === 'practice');
    });
  });
  document.querySelectorAll('.diff-tab').forEach(btn => {
    btn.addEventListener('click', () => { practiceDifficulty = btn.dataset.diff; document.querySelectorAll('.diff-tab').forEach(b => b.classList.remove('active')); btn.classList.add('active'); });
  });
  document.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      playerColorKey = btn.dataset.color; store.set('rivals-color', playerColorKey);
      document.querySelectorAll('.swatch').forEach(b => b.classList.remove('active')); btn.classList.add('active');
      $('color-name').textContent = COLORS[playerColorKey].name; if (lobbyPreview) lobbyPreview.setColor(COLORS[playerColorKey].hex);
    });
  });
  $('sens-slider').addEventListener('input', e => { aim.sensitivity = +e.target.value; store.set('rivals-sens', aim.sensitivity); $('sens-val').textContent = aim.sensitivity.toFixed(1); });
  $('assist-slider').addEventListener('input', e => { aim.assistStrength = +e.target.value / 100; store.set('rivals-assist', aim.assistStrength); $('assist-val').textContent = e.target.value + '%'; });
  $('vol-slider').addEventListener('input', e => { store.set('rivals-vol', e.target.value); $('vol-val').textContent = e.target.value + '%'; });
  let teamSize = 3;
  document.querySelectorAll('.size-tab').forEach(t => { t.addEventListener('click', () => { teamSize = +t.dataset.size; document.querySelectorAll('.size-tab').forEach(x => x.classList.remove('active')); t.classList.add('active'); }); });
  
  $('btn-range').addEventListener('click', () => enterPractice('range'));
  $('btn-botmatch').addEventListener('click', () => enterPractice('botmatch'));
  $('btn-create').addEventListener('click', async () => { const r = await net.createRoom(teamSize, gameMode); if (!r.ok) return toast('Could not create room'); showRoomUI(); });
  $('btn-find').addEventListener('click', async () => { const r = await net.findMatch(teamSize, gameMode); if (!r.ok) return toast('No match available'); showRoomUI(); });
  $('btn-join').addEventListener('click', () => $('join-row').classList.toggle('hidden'));
  $('btn-join-go').addEventListener('click', async () => {
    const code = $('join-code').value.trim().toUpperCase(); if (!code) return;
    const r = await net.joinRoom(code); if (!r.ok) return toast(r.reason === 'not_found' ? 'Room not found' : 'Could not join'); showRoomUI();
  });
  $('btn-leave').addEventListener('click', async () => { await net.leaveRoom(); $('room').classList.add('hidden'); $('lobby').classList.remove('hidden'); });
  $('btn-ready').addEventListener('click', async () => {
    const me = (await net.client.from('room_players').select('*').eq('room_id', net.room.id).eq('user_id', localId).maybeSingle()).data; await net.setReady(!me?.ready);
  });
  $('btn-start').addEventListener('click', async () => {
    const playersList = (await net.client.from('room_players').select('*').eq('room_id', net.room.id)).data || [];
    const blueCount = playersList.filter(p => p.team === 'blue').length; const redCount = playersList.filter(p => p.team === 'red').length;
    if (blueCount === 0 || redCount === 0) { toast('Need at least 1 player on each team'); return; }
    const r = await net.startMatch(); if (!r.ok) toast('Could not start'); else enterMatch(r.match, r.players);
  });
  $('btn-logout').addEventListener('click', async () => { await net.logout(); location.reload(); });
}

function showRoomUI() {
  $('lobby').classList.add('hidden'); $('room').classList.remove('hidden'); $('room-code-display').textContent = net.room.code;
  net.subscribeRoom({ onPlayers: renderRoomPlayers, onStart: data => enterMatch(data.match, data.players), onRoomClosed: () => { toast('Room closed'); $('room').classList.add('hidden'); $('lobby').classList.remove('hidden'); } });
}

function renderRoomPlayers(list) {
  const cap = net.room.team_size; const blue = list.filter(p => p.team === 'blue'); const red = list.filter(p => p.team === 'red');
  const row = p => `<li class="${p.ready ? 'ready' : ''}"><div><div>${escapeHtml(p.display_name)}</div><div style="font-size:10px;opacity:.6">${escapeHtml(p.ir_id || '')}</div></div>${p.ready ? '<span class="badge">READY</span>' : ''}</li>`;
  $('room-players').innerHTML = `
    <div class="team-col blue"><h3>BLUE (${blue.length}/${cap})</h3><ul>${blue.map(row).join('') || '<li>—</li>'}</ul></div>
    <div class="team-col red"><h3>RED (${red.length}/${cap})</h3><ul>${red.map(row).join('') || '<li>—</li>'}</ul></div>`;
  const me = list.find(p => p.user_id === localId); $('btn-ready').textContent = me?.ready ? 'UNREADY' : 'READY';
  if (net.isHost) {
    $('btn-start').classList.remove('hidden'); const hasBothTeams = blue.length > 0 && red.length > 0;
    $('btn-start').disabled = !hasBothTeams; $('btn-start').textContent = hasBothTeams ? 'START MATCH' : 'NEED 1+ PER TEAM';
  } else { $('btn-start').classList.add('hidden'); }
}

/* ===== BOOT WITH TIMEOUT ===== */
async function boot() {
  try {
    const msgEl = $('auth-msg');
    if (msgEl) msgEl.textContent = 'Connecting to Supabase...';

    // ✅ 8 SECOND TIMEOUT FIX
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Connection timed out. Is your Supabase project paused?")), 8000)
    );

    const initRes = await Promise.race([net.init(), timeoutPromise]);
    
    if (!initRes.ok) { 
      $('auth-gate').classList.remove('hidden'); 
      $('auth-msg').textContent = '❌ ' + initRes.reason; 
      $('auth-msg').style.color = 'red';
      return; 
    }
    
    localId = net.user.id; localName = net.displayName; localIrId = net.irId; 
    $('auth-gate').classList.add('hidden');
    
    initWorld(); bindInput(); bindLobby(); loop(); showLobby();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  } catch (err) {
    $('auth-gate').classList.remove('hidden');
    $('auth-msg').textContent = '❌ Error: ' + err.message;
    $('auth-msg').style.color = 'red';
    console.error('BOOT ERROR:', err);
  }
}
boot();
