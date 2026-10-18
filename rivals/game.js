import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const $ = id => document.getElementById(id),
  touch = matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window);

let scene, camera, renderer, clock, raycaster,
  started = false, running = false,
  health = 100, ammo = 12, score = 0, reload = 0,
  toastTime = 0, hitTime = 0,
  yaw = 0, pitch = 0, vy = 0, onGround = true,
  mx = 0, my = 0, joyId = null, aimId = null, lastX = 0, lastY = 0,
  fire = false, lastShot = 0, jump = false;

const keys = {}, targets = [], covers = [], H = 1.7,
  clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: .8 });

function box(w, h, d, m, x, y, z) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  scene.add(o);
  return o;
}

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

  box(42, .5, 42, mat(0x263653), 0, -.25, 0);
  const grid = new THREE.GridHelper(42, 42, 0x48c9e8, 0x435b7a);
  grid.position.y = .01;
  scene.add(grid);

  const blue = mat(0x168bd3), red = mat(0xd93258), wall = mat(0x19243d);
  box(42, .7, .7, blue, 0, .35, -21);
  box(42, .7, .7, red, 0, .35, 21);
  box(.7, 2, 42, wall, -21, 1, 0);
  box(.7, 2, 42, wall, 21, 1, 0);

  [[-8, -5], [8, -5], [-8, 5], [8, 5], [0, -8], [0, 8], [-14, 0], [14, 0]].forEach((p, i) => {
    let w = i % 2 ? 2.8 : 2.2, d = i % 2 ? 2.2 : 2.8, h = i % 3 ? 1.7 : 2.5;
    box(w, h, d, i % 2 ? blue : red, p[0], h / 2, p[1]);
    covers.push({ x: p[0], z: p[1], w, d });
  });

  for (let x = -18; x <= 18; x += 6) {
    box(.14, .08, .14, mat(0xeaf5ff), x, .08, -18);
    box(.14, .08, .14, mat(0xeaf5ff), x, .08, 18);
  }

  for (const [x, z, c] of [[-18, -15, 0x2d8ab9], [18, -15, 0x9b3f67], [-18, 15, 0x9b3f67], [18, 15, 0x2d8ab9]]) {
    box(3, 4, 3, mat(c), x, 2, z);
    box(3.4, .2, 3.4, mat(0xf1f7ff), x, 4.1, z);
  }

  for (let i = 0; i < 8; i++) spawnTarget();
  bind();
  addEventListener('resize', resize);
}

function newTarget() {
  const g = new THREE.Group(),
    parts = [
      [new THREE.BoxGeometry(.78, 1.15, .45), mat(0xff3e69), .82],
      [new THREE.BoxGeometry(.56, .56, .5), mat(0xffd5de), 1.68],
      [new THREE.BoxGeometry(.25, .08, .04), new THREE.MeshBasicMaterial({ color: 0xff8fa7 }), 1.72],
      [new THREE.BoxGeometry(.95, .18, .75), mat(0x141d32), .09]
    ];

  parts.forEach(([geo, m, y], i) => {
    const o = new THREE.Mesh(geo, m);
    o.position.y = y;
    if (i === 2) o.position.z = -.27;
    g.add(o);
  });

  const x = (Math.random() - .5) * 29, z = (Math.random() - .5) * 24;
  g.position.set(x, 0, z);
  g.userData = { x, z, p: Math.random() * 6, r: 1.2 + Math.random() * 1.5, s: .7 + Math.random(), alive: true };
  scene.add(g);
  return g;
}

function spawnTarget() { targets.push(newTarget()); }

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
    if (e.code === 'Space') jump = true;
  });
  document.addEventListener('keyup', e => keys[e.code] = false);

  renderer.domElement.addEventListener('click', () => {
    if (running && !touch && document.pointerLockElement !== renderer.domElement)
      renderer.domElement.requestPointerLock?.();
  });

  document.addEventListener('mousemove', e => {
    if (running && !touch && document.pointerLockElement === renderer.domElement) {
      yaw -= e.movementX * .0022;
      pitch = clamp(pitch - e.movementY * .0022, -1.3, 1.3);
    }
  });

  renderer.domElement.addEventListener('pointerdown', e => {
    if (running && touch && e.clientX > innerWidth * .42) {
      aimId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });

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

  const zone = $('joy-zone'), base = $('joy-base'), knob = $('joy-knob');

  zone.addEventListener('pointerdown', e => {
    if (!running) return;
    joyId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    joy(e, base, knob);
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId === joyId) joy(e, base, knob); });

  const stopJoy = e => {
    if (e.pointerId === joyId) {
      joyId = null;
      mx = my = 0;
      knob.style.transform = 'translate(0,0)';
    }
  };
  zone.addEventListener('pointerup', stopJoy);
  zone.addEventListener('pointercancel', stopJoy);

  $('fire-btn').addEventListener('pointerdown', e => { e.preventDefault(); fire = true; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t =>
    $('fire-btn').addEventListener(t, () => fire = false));

  $('jump-btn').addEventListener('pointerdown', e => { e.preventDefault(); jump = true; });
}

function joy(e, b, k) {
  const r = b.getBoundingClientRect();
  let x = e.clientX - (r.left + r.width / 2),
    y = e.clientY - (r.top + r.height / 2),
    l = Math.hypot(x, y) || 1;
  if (l > 42) { x = x / l * 42; y = y / l * 42; }
  mx = x / 42;
  my = y / 42;
  k.style.transform = `translate(${x}px,${y}px)`;
}

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
  targets.forEach(t => scene.remove(t));
  targets.length = 0;
  for (let i = 0; i < 8; i++) spawnTarget();
  score = 0;
  health = 100;
  ammo = 12;
  reload = 0;
  yaw = pitch = vy = 0;
  camera.position.set(0, H, 13);
  onGround = true;
  hud();
  start();
}

function doReload() {
  if (!running || reload > 0 || ammo === 12) return;
  reload = 1.15;
  toast('RELOADING...');
}

function shoot() {
  const now = performance.now();
  if (now - lastShot < 180 || reload > 0) return;
  lastShot = now;
  if (ammo <= 0) { toast('PRESS R TO RELOAD'); return; }
  ammo--;
  hud();

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const meshes = [];
  targets.forEach(t => {
    if (t.userData.alive) t.traverse(o => { if (o.isMesh) meshes.push(o); });
  });

  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length) {
    let g = hits[0].object;
    while (g.parent && g.parent !== scene) g = g.parent;
    if (g.userData.alive) {
      g.userData.alive = false;
      scene.remove(g);
      const idx = targets.indexOf(g);
      score++;
      hud();
      $('hit').classList.add('show');
      hitTime = .18;
      toast('TARGET DOWN +1');
      setTimeout(() => {
        if (started && idx >= 0) {
          const fresh = newTarget();
          targets[idx] = fresh;
        }
      }, 800);
    }
  }
}

function hud() {
  $('health').textContent = health;
  $('healthbar').style.width = health + '%';
  $('ammo').innerHTML = ammo + ' <em>/ 12</em>';
  $('score').textContent = score;
  $('count').textContent = targets.length;
}

function toast(s) { $('toast').textContent = s; toastTime = 1; }

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.2 : 1.6));
}

function update(dt, t) {
  let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - my,
    s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + mx,
    l = Math.hypot(f, s) || 1;
  f /= Math.max(1, l);
  s /= Math.max(1, l);

  const nx = clamp(camera.position.x + (-Math.sin(yaw) * f + Math.cos(yaw) * s) * 7.5 * dt, -19.5, 19.5),
    nz = clamp(camera.position.z + (-Math.cos(yaw) * f - Math.sin(yaw) * s) * 7.5 * dt, -19.5, 19.5);
  const blocked = covers.some(c =>
    nx > c.x - c.w / 2 - .38 && nx < c.x + c.w / 2 + .38 &&
    nz > c.z - c.d / 2 - .38 && nz < c.z + c.d / 2 + .38);
  if (!blocked) { camera.position.x = nx; camera.position.z = nz; }

  if (jump && onGround) { vy = 6.5; onGround = false; }
  jump = false;
  vy -= 18 * dt;
  camera.position.y += vy * dt;
  if (camera.position.y <= H) { camera.position.y = H; vy = 0; onGround = true; }

  camera.rotation.set(pitch, yaw, 0, 'YXZ');

  targets.forEach(g => {
    if (g.userData.alive) {
      const d = g.userData;
      g.position.x = d.x + Math.sin(t * d.s + d.p) * d.r;
      g.position.z = d.z + Math.cos(t * d.s * .7 + d.p) * d.r * .4;
      g.rotation.y = Math.sin(t + d.p) * .15;
    }
  });

  if (fire) shoot();
  if (reload > 0 && ((reload -= dt) <= 0)) { ammo = 12; hud(); toast('RELOADED'); }
  if (toastTime > 0 && ((toastTime -= dt) <= 0)) $('toast').textContent = '';
  if (hitTime > 0 && ((hitTime -= dt) <= 0)) $('hit').classList.remove('show');
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), .04);
  if (running) update(dt, clock.elapsedTime);
  renderer.render(scene, camera);
}

init();
hud();
loop();


// Request landscape mode when supported by the browser.
document.getElementById('start-btn')?.addEventListener('click', async () => {
  try {
    if (screen.orientation && screen.orientation.lock)
      await screen.orientation.lock('landscape');
  } catch (_) {
    /* Some browsers only allow landscape after installing as an app. */
  }
});
