import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const $ = id => document.getElementById(id);
const touch = matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: .8 });

let scene, camera, renderer, clock, raycaster;
let started = false, running = false;
let health = 100, ammo = 12, score = 0;
let reload = 0, toastTime = 0, hitTime = 0;
let yaw = 0, pitch = 0, vy = 0, onGround = true;
let mx = 0, my = 0, joyId = null, aimId = null;
let lastX = 0, lastY = 0, fire = false, lastShot = 0, jump = false;
let epoch = 0;

const keys = {}, targets = [], covers = [], wallMeshes = [];
const H = 1.7;

/* ---------- helpers ---------- */
function box(w, h, d, m, x, y, z) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  scene.add(o);
  return o;
}

function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
    }
  });
}

/* ---------- humanoid target builder ---------- */
function buildHumanoid(color) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: .05 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x141d32, roughness: .9 });
  const bullseye = new THREE.MeshStandardMaterial({
    color: 0xffe38b, emissive: 0xffe38b, emissiveIntensity: 0.6, roughness: .5
  });
  const hitParts = [];

  const part = (geo, m, x, y, z) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    hitParts.push(mesh);
    return mesh;
  };

  // Head + neck
  part(new THREE.SphereGeometry(0.18, 14, 12), skin, 0, 1.76, 0);
  part(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8), skin, 0, 1.54, 0);
  // Torso
  part(new THREE.BoxGeometry(0.48, 0.60, 0.24), skin, 0, 1.20, 0);
  // Chest bullseye (decorative disc on the chest, still hittable)
  const disc = part(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 16), bullseye, 0, 1.22, 0.13);
  disc.rotation.x = Math.PI / 2;
  // Hips
  part(new THREE.BoxGeometry(0.42, 0.15, 0.22), skin, 0, 0.825, 0);

  // Arms (upper, lower, hand)
  for (const side of [-1, 1]) {
    part(new THREE.BoxGeometry(0.12, 0.36, 0.12), skin, side * 0.30, 1.32, 0);
    part(new THREE.BoxGeometry(0.10, 0.34, 0.10), skin, side * 0.30, 0.97, 0);
    part(new THREE.BoxGeometry(0.10, 0.10, 0.10), skin, side * 0.30, 0.75, 0);
  }

  // Legs (upper, lower, foot)
  for (const side of [-1, 1]) {
    part(new THREE.BoxGeometry(0.15, 0.40, 0.15), skin, side * 0.11, 0.55, 0);
    part(new THREE.BoxGeometry(0.13, 0.35, 0.13), skin, side * 0.11, 0.175, 0);
    part(new THREE.BoxGeometry(0.15, 0.08, 0.22), skin, side * 0.11, 0.04, 0.04);
  }

  // Wireframe box frame (decorative — not raycastable)
  const frameGeo = new THREE.BoxGeometry(1.10, 2.10, 0.70);
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(frameGeo),
    new THREE.LineBasicMaterial({ color: 0x44d7ff, transparent: true, opacity: 0.55 })
  );
  frame.position.y = 1.05;
  frame.raycast = () => {};
  g.add(frame);
  frameGeo.dispose();

  // Base pedestal (decorative)
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.50, 0.08, 20),
    new THREE.MeshStandardMaterial({ color: 0x0e1a2e, roughness: .9, metalness: .3 })
  );
  base.position.y = 0.04;
  base.castShadow = true;
  base.receiveShadow = true;
  base.raycast = () => {};
  g.add(base);

  return { group: g, hitParts };
}

/* ---------- spawn helpers ---------- */
function findFreeSpot() {
  for (let i = 0; i < 60; i++) {
    const x = (Math.random() - .5) * 29;
    const z = (Math.random() - .5) * 24;
    const blocked = covers.some(c =>
      Math.abs(x - c.x) < c.w / 2 + 1.8 && Math.abs(z - c.z) < c.d / 2 + 1.8
    );
    const nearStart = Math.hypot(x, z - 13) < 5;
    if (!blocked && !nearStart) return { x, z };
  }
  return { x: 0, z: -8 };
}

function newTarget() {
  const { group: g, hitParts } = buildHumanoid(Math.random() < 0.5 ? 0xff3e69 : 0xff7aa0);
  const { x, z } = findFreeSpot();
  g.position.set(x, 0, z);
  g.userData = {
    x, z,
    p: Math.random() * 6.28,
    r: 0.5 + Math.random() * 0.7,
    s: 0.7 + Math.random(),
    alive: true,
    isTarget: true,
    hitParts,
  };
  scene.add(g);
  return g;
}

function spawnTarget() { targets.push(newTarget()); }

/* ---------- world ---------- */
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

  // Shadows only on desktop (mobile GPU cost)
  if (!touch) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const d = 25;
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 80 });
    sun.shadow.bias = -0.0005;
  }

  // Ground + grid
  box(42, .5, 42, mat(0x263653), 0, -.25, 0);
  const grid = new THREE.GridHelper(42, 42, 0x48c9e8, 0x435b7a);
  grid.position.y = .01;
  scene.add(grid);

  // Outer walls
  const blue = mat(0x168bd3), red = mat(0xd93258), wall = mat(0x19243d);
  box(42, .7, .7, blue, 0, .35, -21);
  box(42, .7, .7, red, 0, .35, 21);
  box(.7, 2, 42, wall, -21, 1, 0);
  box(.7, 2, 42, wall, 21, 1, 0);

  // Interior cover (also blocks shots)
  [[-8, -5], [8, -5], [-8, 5], [8, 5], [0, -8], [0, 8], [-14, 0], [14, 0]].forEach((p, i) => {
    const w = i % 2 ? 2.8 : 2.2;
    const d = i % 2 ? 2.2 : 2.8;
    const h = i % 3 ? 1.7 : 2.5;
    const m = box(w, h, d, i % 2 ? blue : red, p[0], h / 2, p[1]);
    covers.push({ x: p[0], z: p[1], w, d });
    wallMeshes.push(m);
  });

  // Corner towers
  for (const [x, z, color] of [[-18, -15, 0x2d8ab9], [18, -15, 0x9b3f67], [-18, 15, 0x9b3f67], [18, 15, 0x2d8ab9]]) {
    wallMeshes.push(box(3, 4, 3, mat(color), x, 2, z));
    box(3.4, .2, 3.4, mat(0xf1f7ff), x, 4.1, z);
  }

  // Border markers
  for (let x = -18; x <= 18; x += 6) {
    box(.14, .08, .14, mat(0xeaf5ff), x, .08, -18);
    box(.14, .08, .14, mat(0xeaf5ff), x, .08, 18);
  }

  for (let i = 0; i < 8; i++) spawnTarget();

  bind();
  addEventListener('resize', resize);
}

/* ---------- input binding ---------- */
function bind() {
  $('start-btn').onclick = start;
  $('pause-btn').onclick = pause;
  $('resume-btn').onclick = resume;
  $('restart-btn').onclick = restart;

  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyR') doReload();
    if (e.code === 'Escape' && started) running ? pause() : resume();
    if (e.code === 'Space' && !e.repeat) jump = true;
  });
  document.addEventListener('keyup', e => keys[e.code] = false);

  // Pointer-lock loss → pause (so game doesn't run blind)
  document.addEventListener('pointerlockchange', () => {
    if (!touch && running && !document.pointerLockElement) pause();
  });

  // Desktop: click = fire + lock.  Mobile: right-side drag = aim
  renderer.domElement.addEventListener('pointerdown', e => {
    if (!running) return;
    if (!touch) {
      fire = true;
      if (document.pointerLockElement !== renderer.domElement)
        renderer.domElement.requestPointerLock?.();
    } else if (e.clientX > innerWidth * .42) {
      aimId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });

  document.addEventListener('pointerup', () => { if (!touch) fire = false; });
  document.addEventListener('pointercancel', () => { if (!touch) fire = false; });
  addEventListener('blur', () => {
    fire = false; jump = false;
    Object.keys(keys).forEach(k => delete keys[k]);
  });

  // Mouse look
  document.addEventListener('mousemove', e => {
    if (running && !touch && document.pointerLockElement === renderer.domElement) {
      yaw -= e.movementX * .0022;
      pitch = clamp(pitch - e.movementY * .0022, -1.3, 1.3);
    }
  });

  // Touch aim
  renderer.domElement.addEventListener('pointermove', e => {
    if (touch && e.pointerId === aimId) {
      yaw -= (e.clientX - lastX) * .006;
      pitch = clamp(pitch - (e.clientY - lastY) * .006, -1.2, 1.2);
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  const stopAim = e => { if (e.pointerId === aimId) aimId = null; };
  renderer.domElement.addEventListener('pointerup', stopAim);
  renderer.domElement.addEventListener('pointercancel', stopAim);

  // Joystick
  const zone = $('joy-zone'), base = $('joy-base'), knob = $('joy-knob');
  zone.addEventListener('pointerdown', e => {
    if (!running) return;
    joyId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    joy(e, base, knob);
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId === joyId) joy(e, base, knob);
  });
  const stopJoy = e => {
    if (e.pointerId === joyId) {
      joyId = null;
      mx = my = 0;
      knob.style.transform = 'translate(0,0)';
    }
  };
  zone.addEventListener('pointerup', stopJoy);
  zone.addEventListener('pointercancel', stopJoy);

  // Fire / jump / reload buttons (mobile)
  const fireBtn = $('fire-btn');
  fireBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    fire = true;
    try { fireBtn.setPointerCapture(e.pointerId); } catch (_) {}
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t =>
    fireBtn.addEventListener(t, () => fire = false)
  );

  const jumpBtn = $('jump-btn');
  jumpBtn.addEventListener('pointerdown', e => { e.preventDefault(); jump = true; });

  $('reload-btn')?.addEventListener('pointerdown', e => { e.preventDefault(); doReload(); });
}

/* ---------- joystick math ---------- */
function joy(e, b, k) {
  const r = b.getBoundingClientRect();
  let x = e.clientX - (r.left + r.width / 2);
  let y = e.clientY - (r.top + r.height / 2);
  const l = Math.hypot(x, y) || 1;
  if (l > 42) { x = x / l * 42; y = y / l * 42; }
  mx = x / 42;
  my = y / 42;
  k.style.transform = `translate(${x}px,${y}px)`;
}

/* ---------- state transitions ---------- */
function start() {
  started = running = true;
  $('start').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (touch) $('mobile').classList.remove('hidden');
  else renderer.domElement.requestPointerLock?.();
}

function pause() {
  if (!started) return;
  running = false;
  fire = false;
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
  for (let i = 0; i < 8; i++) spawnTarget();
  score = 0; health = 100; ammo = 12; reload = 0;
  yaw = pitch = vy = 0;
  camera.position.set(0, H, 13);
  onGround = true;
  hud();
  start();
}

/* ---------- actions ---------- */
function doReload() {
  if (!running || reload > 0 || ammo === 12) return;
  reload = 1.15;
  toast('RELOADING...');
}

function shoot() {
  if (!running) return;
  const now = performance.now();
  if (now - lastShot < 180 || reload > 0) return;
  lastShot = now;

  if (ammo <= 0) { doReload(); return; }
  ammo--;
  hud();

  // Crosshair flash
  const ch = $('crosshair');
  ch.classList.add('fired');
  setTimeout(() => ch.classList.remove('fired'), 80);

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  // Hittables = wall meshes (block shots) + live target parts
  const hittables = [...wallMeshes];
  targets.forEach(t => {
    if (t.userData.alive) t.userData.hitParts.forEach(m => hittables.push(m));
  });

  const hits = raycaster.intersectObjects(hittables, false);
  if (hits.length) {
    // Walk up to see if we hit a target root (walls have no isTarget)
    let node = hits[0].object;
    while (node && !node.userData.isTarget) node = node.parent;

    if (node && node.userData.alive) {
      node.userData.alive = false;
      disposeGroup(node);
      scene.remove(node);

      const idx = targets.indexOf(node);
      score++;
      hud();
      $('hit').classList.add('show');
      hitTime = 0.18;
      toast('TARGET DOWN +1');

      // Respawn after 800ms (guarded by epoch to survive restart)
      const myEpoch = epoch;
      setTimeout(() => {
        if (started && myEpoch === epoch && idx >= 0) {
          targets[idx] = newTarget();
          hud();
        }
      }, 800);
    }
  }

  if (ammo === 0) doReload();
}

function hud() {
  $('health').textContent = health;
  $('healthbar').style.width = health + '%';
  $('ammo').innerHTML = ammo + ' <em>/ 12</em>';
  $('score').textContent = score;
  $('count').textContent = targets.filter(t => t.userData.alive).length;
}

function toast(s) {
  $('toast').textContent = s;
  toastTime = 1;
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.2 : 1.6));
}

/* ---------- per-frame update ---------- */
function update(dt, t) {
  let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - my;
  let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + mx;
  const l = Math.hypot(f, s) || 1;
  f /= Math.max(1, l);
  s /= Math.max(1, l);

  const nx = clamp(camera.position.x + (-Math.sin(yaw) * f + Math.cos(yaw) * s) * 7.5 * dt, -19.5, 19.5);
  const nz = clamp(camera.position.z + (-Math.cos(yaw) * f - Math.sin(yaw) * s) * 7.5 * dt, -19.5, 19.5);

  // Axis-separated collision → wall sliding
  const hitWall = (x, z) => covers.some(c =>
    Math.abs(x - c.x) < c.w / 2 + 0.38 && Math.abs(z - c.z) < c.d / 2 + 0.38
  );
  if (!hitWall(nx, camera.position.z)) camera.position.x = nx;
  if (!hitWall(camera.position.x, nz)) camera.position.z = nz;

  if (jump && onGround) { vy = 6.5; onGround = false; }
  jump = false;
  vy -= 18 * dt;
  camera.position.y += vy * dt;
  if (camera.position.y <= H) {
    camera.position.y = H;
    vy = 0;
    onGround = true;
  }

  camera.rotation.set(pitch, yaw, 0, 'YXZ');

  // Sway the humanoids gently
  targets.forEach(g => {
    if (g.userData.alive) {
      const d = g.userData;
      g.position.x = d.x + Math.sin(t * d.s + d.p) * d.r;
      g.position.z = d.z + Math.cos(t * d.s * .7 + d.p) * d.r * .4;
      g.rotation.y = Math.sin(t + d.p) * .15;
    }
  });

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

/* ---------- boot ---------- */
init();
hud();
loop();

document.getElementById('start-btn')?.addEventListener('click', async () => {
  try {
    if (screen.orientation && screen.orientation.lock)
      await screen.orientation.lock('landscape');
  } catch (_) {}
});
