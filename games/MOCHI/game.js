import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import * as Net from './network.js';

/* ============ SETTINGS (persisted) ============ */
const DEFAULTS = {
  sound: true,
  shake: true,
  sensitivity: 10,
  cameraDistance: 9,
  keys: {
    up: 'w',
    down: 's',
    left: 'a',
    right: 'd',
    jump: ' '
  }
};
const SETTINGS_KEY = 'mochi_settings_v1';
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw);
    return { ...structuredClone(DEFAULTS), ...saved, keys: { ...DEFAULTS.keys, ...(saved.keys || {}) } };
  } catch { return structuredClone(DEFAULTS); }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}
const settings = loadSettings();

/* ============ CHARACTERS ============ */
const CHARACTERS = [
  { id: 'pink',   name: 'PINK',   body: '#ff8cc8', accent: '#a99aff', emoji: '🌸' },
  { id: 'mint',   name: 'MINT',   body: '#78e9d2', accent: '#ffe277', emoji: '🌿' },
  { id: 'yellow', name: 'LEMON',  body: '#ffe277', accent: '#ff8cc8', emoji: '🍋' },
  { id: 'purple', name: 'PLUM',   body: '#a99aff', accent: '#78e9d2', emoji: '🍇' }
];
let myCharacter = CHARACTERS[0];

/* ============ DOM ============ */
const root = document.querySelector('#play-root');
const canvas = document.querySelector('#game');
const loading = document.querySelector('#loading');

const screens = {
  mainMenu:        document.querySelector('#mainMenu'),
  characterScreen: document.querySelector('#characterScreen'),
  createScreen:    document.querySelector('#createScreen'),
  joinScreen:      document.querySelector('#joinScreen'),
  roomScreen:      document.querySelector('#roomScreen'),
  settingsScreen:  document.querySelector('#settingsScreen'),
  helpMenuScreen:  document.querySelector('#helpMenuScreen')
};

const nameInput       = document.querySelector('#nameInput');
const codeInput       = document.querySelector('#codeInput');
const playBtn         = document.querySelector('#playBtn');
const joinMenuBtn     = document.querySelector('#joinMenuBtn');
const settingsBtn     = document.querySelector('#settingsBtn');
const helpMenuBtn     = document.querySelector('#helpMenuBtn');
const charContinueBtn = document.querySelector('#charContinueBtn');
const charGrid        = document.querySelector('#charGrid');
const charError       = document.querySelector('#charError');
const createBtn       = document.querySelector('#createBtn');
const createError     = document.querySelector('#createError');
const createStatus    = document.querySelector('#createStatus');
const joinBtn         = document.querySelector('#joinBtn');
const joinError       = document.querySelector('#joinError');
const joinStatus      = document.querySelector('#joinStatus');

const roomCodeText   = document.querySelector('#roomCodeText');
const copyCodeBtn    = document.querySelector('#copyCodeBtn');
const leaveRoomBtn   = document.querySelector('#leaveRoomBtn');
const readyBtn       = document.querySelector('#readyBtn');
const startBtn       = document.querySelector('#startBtn');
const roomHint       = document.querySelector('#roomHint');
const roomSettingsBtn= document.querySelector('#roomSettingsBtn');
const settingsBackBtn= document.querySelector('#settingsBackBtn');

const soundToggle    = document.querySelector('#soundToggle');
const shakeToggle    = document.querySelector('#shakeToggle');
const sensSlider     = document.querySelector('#sensSlider');
const sensVal        = document.querySelector('#sensVal');
const distSlider     = document.querySelector('#distSlider');
const distVal        = document.querySelector('#distVal');
const controlList    = document.querySelector('#controlList');
const resetControlsBtn = document.querySelector('#resetControlsBtn');

const countdownOverlay = document.querySelector('#countdownOverlay');
const countdownNumber  = document.querySelector('#countdownNumber');

const gameTopbar    = document.querySelector('#gameTopbar');
const gameBottomHud = document.querySelector('#gameBottomHud');
const scoreName0    = document.querySelector('#scoreName0');
const scoreName1    = document.querySelector('#scoreName1');
const scoreVal0     = document.querySelector('#scoreVal0');
const scoreVal1     = document.querySelector('#scoreVal1');
const hudEmoji      = document.querySelector('#hudEmoji');
const hudLabel      = document.querySelector('#hudLabel');
const hudCount      = document.querySelector('#hudCount');

const slotEls = [
  { el: document.querySelector('#slot0'), avatar: document.querySelector('#slotAvatar0'), name: document.querySelector('#slotName0'), ready: document.querySelector('#slotReady0') },
  { el: document.querySelector('#slot1'), avatar: document.querySelector('#slotAvatar1'), name: document.querySelector('#slotName1'), ready: document.querySelector('#slotReady1') }
];

/* ============ SCREEN NAV ============ */
let currentScreen = 'mainMenu';
function showScreen(id) {
  for (const [key, el] of Object.entries(screens)) {
    if (key === id) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }
  currentScreen = id;
}
document.querySelectorAll('[data-back]').forEach(btn => {
  btn.onclick = () => showScreen(btn.dataset.back);
});

playBtn.onclick     = () => showScreen('characterScreen');
joinMenuBtn.onclick = () => showScreen('joinScreen');
settingsBtn.onclick = () => { openSettings(); showScreen('settingsScreen'); };
helpMenuBtn.onclick = () => showScreen('helpMenuScreen');

/* ============ CHARACTER SELECT ============ */
function buildCharGrid() {
  charGrid.innerHTML = '';
  for (const ch of CHARACTERS) {
    const tile = document.createElement('div');
    tile.className = 'char-tile' + (ch.id === myCharacter.id ? ' selected' : '');
    tile.innerHTML = `
      <div class="char-preview" style="background:linear-gradient(135deg,${ch.body},${ch.accent})"></div>
      <div class="char-name">${ch.name}</div>
    `;
    tile.onclick = () => {
      myCharacter = ch;
      document.querySelectorAll('.char-tile').forEach(t => t.classList.remove('selected'));
      tile.classList.add('selected');
    };
    charGrid.appendChild(tile);
  }
}
buildCharGrid();

charContinueBtn.onclick = () => {
  const name = (nameInput.value || '').trim();
  if (name.length < 1) {
    charError.textContent = 'Enter a name first.';
    charError.classList.remove('hidden');
    return;
  }
  charError.classList.add('hidden');
  selfName = name;
  showScreen('createScreen');
};

/* ============ SETTINGS ============ */
const KEY_LABELS = {
  up: 'Move up',
  down: 'Move down',
  left: 'Move left',
  right: 'Move right',
  jump: 'Jump'
};
let listeningFor = null;

function renderControls() {
  controlList.innerHTML = '';
  for (const action of Object.keys(KEY_LABELS)) {
    const row = document.createElement('div');
    row.className = 'control-row';
    const label = document.createElement('span');
    label.className = 'control-label';
    label.textContent = KEY_LABELS[action];
    const keyBtn = document.createElement('button');
    keyBtn.className = 'control-key';
    keyBtn.dataset.action = action;
    keyBtn.textContent = prettyKey(settings.keys[action]);
    keyBtn.onclick = () => {
      if (listeningFor) return;
      listeningFor = action;
      keyBtn.classList.add('listening');
      keyBtn.textContent = '...';
    };
    row.appendChild(label);
    row.appendChild(keyBtn);
    controlList.appendChild(row);
  }
}
function prettyKey(k) {
  if (k === ' ') return 'SPACE';
  if (k === 'arrowup') return '↑';
  if (k === 'arrowdown') return '↓';
  if (k === 'arrowleft') return '←';
  if (k === 'arrowright') return '→';
  return k.toUpperCase();
}

window.addEventListener('keydown', e => {
  if (!listeningFor) return;
  e.preventDefault();
  e.stopPropagation();
  let key = e.key.toLowerCase();
  if (e.code === 'Space') key = ' ';
  // prevent using a key already assigned elsewhere
  const conflict = Object.entries(settings.keys).find(([a, k]) => a !== listeningFor && k === key);
  if (conflict) {
    toast(`Already used for ${KEY_LABELS[conflict[0]]}`);
    return;
  }
  settings.keys[listeningFor] = key;
  saveSettings();
  const action = listeningFor;
  listeningFor = null;
  document.querySelectorAll('.control-key').forEach(b => {
    b.classList.remove('listening');
    if (b.dataset.action === action) b.textContent = prettyKey(settings.keys[action]);
  });
});

soundToggle.checked = settings.sound;
shakeToggle.checked = settings.shake;
sensSlider.value = settings.sensitivity;
sensVal.textContent = settings.sensitivity;
distSlider.value = settings.cameraDistance;
distVal.textContent = settings.cameraDistance;

soundToggle.onchange = () => { settings.sound = soundToggle.checked; saveSettings(); };
shakeToggle.onchange = () => { settings.shake = shakeToggle.checked; saveSettings(); };
sensSlider.oninput = () => {
  settings.sensitivity = Number(sensSlider.value);
  sensVal.textContent = settings.sensitivity;
  saveSettings();
};
distSlider.oninput = () => {
  settings.cameraDistance = Number(distSlider.value);
  distVal.textContent = settings.cameraDistance;
  saveSettings();
};
resetControlsBtn.onclick = () => {
  settings.keys = structuredClone(DEFAULTS.keys);
  saveSettings();
  renderControls();
  toast('Controls reset');
};

function openSettings() {
  soundToggle.checked = settings.sound;
  shakeToggle.checked = settings.shake;
  sensSlider.value = settings.sensitivity;
  sensVal.textContent = settings.sensitivity;
  distSlider.value = settings.cameraDistance;
  distVal.textContent = settings.cameraDistance;
  renderControls();
}
settingsBackBtn.onclick = () => {
  // Return to previous screen — if we came from room, go to room; else main menu
  if (roomCode && !inMatch) showScreen('roomScreen');
  else showScreen('mainMenu');
};
roomSettingsBtn.onclick = () => { openSettings(); showScreen('settingsScreen'); };

/* ============ THREE SCENE ============ */
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9edfff');
scene.fog = new THREE.Fog('#9edfff', 22, 65);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 120);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

function resize() {
  const w = root.clientWidth || window.innerWidth;
  const h = root.clientHeight || window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setSize(w, h, false);
}
resize();
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(root);
window.addEventListener('resize', resize);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8e78bb, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-8, 15, 9); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
scene.add(sun);

const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72 });
const floor = new THREE.Mesh(new THREE.BoxGeometry(28, 0.5, 28), mat('#f7f0ff'));
floor.position.y = -0.3; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(28, 28, '#c1b4f4', '#d8d0ef');
grid.position.y = -0.035; grid.material.transparent = true; grid.material.opacity = 0.4;
scene.add(grid);

function box(w,h,d,c,x,y,z){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(c));
  m.position.set(x,y,z); m.castShadow = m.receiveShadow = true;
  scene.add(m); return m;
}
box(28,.65,.65,'#ff85bd',0,.15,-14);
box(28,.65,.65,'#78e9d2',0,.15,14);
box(.65,.65,28,'#a99aff',-14,.15,0);
box(.65,.65,28,'#ffe277',14,.15,0);
box(7,.18,5,'#ffd8ec',0,.02,0);
box(3.2,.5,3.2,'#ff7db7',0,.3,0);
box(2.1,.22,2.1,'#ffe66d',0,.66,0);
for (const [x,y,z,w,h,d,c] of [
  [-6,.7,-5,2.1,1.4,1.6,'#ff8cc8'],[6,.7,-5,2.1,1.4,1.6,'#8e83ff'],
  [-6,.7,5,2.1,1.4,1.6,'#72e6ce'],[6,.7,5,2.1,1.4,1.6,'#ffd76f'],
  [0,.55,-8,3,1.1,1.2,'#ffa66b'],[0,.55,8,3,1.1,1.2,'#8bd8ff'],
  [-9,.45,0,1.2,.9,3,'#b9a5ff'],[9,.45,0,1.2,.9,3,'#ff9acb']
]) box(w,h,d,c,x,y,z);
for (let i = 0; i < 12; i++) {
  const a = i*Math.PI/6, x = Math.cos(a)*11.2, z = Math.sin(a)*11.2;
  const p = new THREE.Mesh(new THREE.CylinderGeometry(.25,.38,1.35,8), mat(['#ff8cc8','#8e83ff','#78e9d2','#ffe277'][i%4]));
  p.position.set(x,.55,z); p.castShadow = true; scene.add(p);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(.28,16,12), mat(['#fff1a8','#ffc8e3','#b7fff0'][i%3]));
  orb.position.set(x,1.45,z); orb.castShadow = true; scene.add(orb);
}
for (const [x,z,c] of [[-10,-10,'#ff8cc8'],[10,-10,'#78e9d2'],[-10,10,'#ffe66d'],[10,10,'#a99aff']]) {
  const r = new THREE.Mesh(new THREE.TorusGeometry(1.05,.12,8,28), mat(c));
  r.position.set(x,2.5,z); r.rotation.x = Math.PI/2.8; scene.add(r);
}
for (const [x,y,z,s] of [[-18,9,-12,1.5],[18,10,-15,1.8],[-18,8,12,1.2],[19,9,12,1.5]]) {
  const g = new THREE.Group();
  for (const [ox,oy,oz,r] of [[0,0,0,.85],[.8,.1,0,.65],[-.7,.08,.1,.58],[.25,.35,.05,.62]]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r,12,10), mat('#fff'));
    m.position.set(ox,oy,oz); g.add(m);
  }
  g.position.set(x,y,z); g.scale.setScalar(s); scene.add(g);
}

/* ============ CHARACTER MESHES ============ */
function makePlayer(bodyColor, accentColor, x, z) {
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.SphereGeometry(.72,24,18), mat(bodyColor));
  body.scale.set(.85,1,.72); body.position.y = .92; body.castShadow = true;
  g.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(.45,20,14), mat('#fff1e9'));
  belly.scale.set(.9,.78,.22); belly.position.set(0,.8,.48);
  g.add(belly);

  const faceMat = mat('#30274b');
  for (const ex of [-.22,.22]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.065,12,10), faceMat);
    eye.position.set(ex,1.05,.63); g.add(eye);
  }
  for (const bx of [-.39,.39]) {
    const blush = new THREE.Mesh(new THREE.SphereGeometry(.1,12,8), mat('#ff9cbd'));
    blush.position.set(bx,.85,.61); blush.scale.set(1,.6,.3); g.add(blush);
  }

  const cap = new THREE.Mesh(new THREE.SphereGeometry(.28,16,12), mat(accentColor));
  cap.scale.set(1,.42,1); cap.position.set(0,1.58,0); g.add(cap);

  const pom = new THREE.Mesh(new THREE.SphereGeometry(.12,12,10), mat('#fff1a8'));
  pom.position.set(0,1.75,0); g.add(pom);

  g.position.set(x,0,z); scene.add(g);
  return { group: g, body, bobBase: 0.92 };
}

const localPlayer  = makePlayer('#ff8cc8','#a99aff', -3,  3);
const remotePlayer = makePlayer('#78e9d2','#ffe277',  3, -3);
remotePlayer.group.visible = false;

/* sparkles */
const sparkles = new THREE.Group(); scene.add(sparkles);
for (let i = 0; i < 30; i++) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(.045,6,6), mat(i%2?'#fff1a8':'#fff'));
  s.position.set((Math.random()-.5)*24, .5+Math.random()*4, (Math.random()-.5)*24);
  sparkles.add(s);
}

/* ============ STATE ============ */
const local  = { x: -3, y: 0, z: 3, ry: 0, vy: 0, grounded: true };
let remote   = { x: 3, y: 0, z: -3, ry: Math.PI, vy: 0, grounded: true };
let remoteTarget = { x: 3, y: 0, z: -3, ry: Math.PI };
let remoteVisible = false;
let remoteName = '';
let remoteChar = CHARACTERS[1];

let channel = null;
let selfId  = null;
let selfName = '';
let roomCode = '';
let isHost = false;
let peerReady = false;
let meReady = false;
let inMatch = false;
let lastMoveSent = 0;

/* ============ INPUT ============ */
const keys = new Set();
let yaw = 0, pitch = 0.26, dragging = false, lastX = 0, lastY = 0;
const moveVec = new THREE.Vector3();
const clock = new THREE.Clock();

function jump() {
  if (!inMatch) return;
  if (local.grounded) { local.vy = 7.2; local.grounded = false; }
}
window.addEventListener('keydown', e => {
  if (listeningFor) return; // rebinding
  const k = e.code === 'Space' ? ' ' : e.key.toLowerCase();
  if ([settings.keys.up, settings.keys.down, settings.keys.left, settings.keys.right, ' '].includes(k)) {
    e.preventDefault();
  }
  keys.add(k);
  if (k === settings.keys.jump) jump();
});
window.addEventListener('keyup', e => {
  const k = e.code === 'Space' ? ' ' : e.key.toLowerCase();
  keys.delete(k);
});
document.querySelector('#jumpBtn').addEventListener('pointerdown', e => { e.preventDefault(); jump(); });

canvas.addEventListener('pointerdown', e => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const sens = 0.006 * (settings.sensitivity / 10);
  yaw   -= (e.clientX - lastX) * sens;
  pitch  = THREE.MathUtils.clamp(pitch + (e.clientY - lastY) * 0.003 * (settings.sensitivity / 10), -0.1, 0.8);
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointerup',   () => dragging = false);
canvas.addEventListener('pointercancel', () => dragging = false);

/* ============ MOBILE JOYSTICK ============ */
let touchId = null, touchOrigin = null, touchDelta = { x: 0, y: 0 };
const pad = document.createElement('div');
pad.className = 'touch-pad';
pad.innerHTML = '<span class="touch-knob"></span>';
root.appendChild(pad);
const knob = pad.querySelector('.touch-knob');

function moveTouch(e) {
  if (touchId !== e.pointerId) return;
  const dx = e.clientX - touchOrigin.x, dy = e.clientY - touchOrigin.y;
  const len = Math.max(1, Math.hypot(dx,dy)), scale = Math.min(1, len/45);
  touchDelta = { x: dx/len*scale, y: dy/len*scale };
  knob.style.transform = `translate(${touchDelta.x*30}px,${touchDelta.y*30}px)`;
}
pad.addEventListener('pointerdown', e => {
  e.preventDefault(); touchId = e.pointerId;
  touchOrigin = { x:e.clientX, y:e.clientY };
  pad.setPointerCapture(e.pointerId);
  pad.classList.add('active'); moveTouch(e);
});
pad.addEventListener('pointermove', moveTouch);
function endTouch(e) {
  if (touchId === e.pointerId) {
    touchId = null; touchDelta = { x:0,y:0 };
    pad.classList.remove('active');
    knob.style.transform = 'translate(0,0)';
  }
}
pad.addEventListener('pointerup', endTouch);
pad.addEventListener('pointercancel', endTouch);

/* ============ TOAST ============ */
function toast(msg) {
  const el = document.querySelector('#toast');
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 1400);
}

/* ============ HELP MODAL ============ */
const helpModal = document.querySelector('#helpModal');
document.querySelector('#helpBtn').onclick  = () => helpModal.classList.remove('hidden');
document.querySelector('#closeHelp').onclick = () => helpModal.classList.add('hidden');
document.querySelector('#gotIt').onclick     = () => helpModal.classList.add('hidden');

/* ============ LANDSCAPE LOCK ============ */
let orientationRequested = false;
async function requestLandscape() {
  if (orientationRequested) return;
  orientationRequested = true;
  try {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        try { await document.documentElement.requestFullscreen(); } catch (_) {}
      }
      await screen.orientation.lock('landscape');
    }
  } catch (_) {}
}
window.addEventListener('pointerdown', requestLandscape, { once: true });
window.addEventListener('keydown',     requestLandscape, { once: true });

/* ============ UPDATE LOCAL ============ */
function updateLocalPlayer(dt) {
  let f = 0, s = 0;
  if (keys.has(settings.keys.up))    f += 1;
  if (keys.has(settings.keys.down))  f -= 1;
  if (keys.has(settings.keys.right)) s += 1;
  if (keys.has(settings.keys.left))  s -= 1;
  f -= touchDelta.y;
  s += touchDelta.x;

  const len = Math.hypot(f,s);
  if (len > 1) { f /= len; s /= len; }

  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right   = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw));
  moveVec.set(0,0,0).addScaledVector(forward, f).addScaledVector(right, s);

  if (inMatch && moveVec.lengthSq() > 0.001) {
    local.x += moveVec.x * 5.4 * dt;
    local.z += moveVec.z * 5.4 * dt;
    local.ry = Math.atan2(moveVec.x, moveVec.z);
  }
  local.x = THREE.MathUtils.clamp(local.x, -12.3, 12.3);
  local.z = THREE.MathUtils.clamp(local.z, -12.3, 12.3);

  local.vy -= 18 * dt;
  local.y  += local.vy * dt;
  if (local.y <= 0) { local.y = 0; local.vy = 0; local.grounded = true; }

  localPlayer.group.position.set(local.x, local.y, local.z);
  localPlayer.group.rotation.y = local.ry;

  const moving = moveVec.lengthSq() > 0.001;
  const bob = moving
    ? Math.sin(performance.now() * 0.015) * 0.045
    : Math.sin(performance.now() * 0.002) * 0.018;
  localPlayer.body.position.y = localPlayer.bobBase + bob;

  const now = performance.now();
  if (inMatch && channel && now - lastMoveSent > 50) {
    lastMoveSent = now;
    channel.send('move', {
      x: local.x, y: local.y, z: local.z,
      ry: local.ry, vy: local.vy, grounded: local.grounded
    });
  }

  hudCount.textContent = remoteVisible ? '2P' : '1P';
  document.querySelector('.meter i').style.width = '100%';
}

/* ============ UPDATE REMOTE ============ */
function updateRemotePlayer(dt) {
  if (!remoteVisible) { remotePlayer.group.visible = false; return; }
  remotePlayer.group.visible = true;

  const k = 1 - Math.exp(-dt * 12);
  remote.x += (remoteTarget.x - remote.x) * k;
  remote.y += (remoteTarget.y - remote.y) * k;
  remote.z += (remoteTarget.z - remote.z) * k;

  let d = remoteTarget.ry - remote.ry;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  remote.ry += d * k;

  remotePlayer.group.position.set(remote.x, remote.y, remote.z);
  remotePlayer.group.rotation.y = remote.ry;
}

/* ============ CAMERA ============ */
function cameraFollow(dt) {
  const camDist = settings.cameraDistance;
  const target = new THREE.Vector3(local.x, local.y + 1.1, local.z);
  const h = Math.cos(pitch) * camDist;
  const off = new THREE.Vector3(
    Math.sin(yaw) * h,
    Math.sin(pitch) * camDist + 2,
    Math.cos(yaw) * h
  );
  camera.position.lerp(target.clone().add(off), 1 - Math.exp(-dt * 5));
  camera.lookAt(target);
}

/* ============ LOBBY UI ============ */
function setStatus(el, text, state) {
  el.textContent = text;
  el.className = 'conn-status' + (state ? ' ' + state : '');
}

function renderRoom() {
  roomCodeText.textContent = roomCode || '-----';

  const mySlot = slotEls[0];
  const peerSlot = slotEls[1];

  mySlot.avatar.textContent = myCharacter.emoji;
  mySlot.name.textContent = selfName || 'You';
  mySlot.ready.textContent = meReady ? 'READY' : 'not ready';
  mySlot.el.classList.add('you');
  mySlot.el.classList.toggle('ready', meReady);

  if (remoteVisible) {
    peerSlot.avatar.textContent = remoteChar.emoji;
    peerSlot.name.textContent = remoteName || 'Peer';
    peerSlot.ready.textContent = peerReady ? 'READY' : 'not ready';
    peerSlot.el.classList.toggle('ready', peerReady);
    peerSlot.el.style.opacity = 1;
  } else {
    peerSlot.avatar.textContent = '🍡';
    peerSlot.name.textContent = '—';
    peerSlot.ready.textContent = 'waiting…';
    peerSlot.el.classList.remove('ready');
    peerSlot.el.style.opacity = .6;
  }

  const both = remoteVisible && meReady && peerReady;
  startBtn.classList.toggle('hidden', !isHost || !both);
  readyBtn.classList.toggle('hidden', inMatch);
  readyBtn.textContent = meReady ? 'NOT READY' : 'READY';

  roomHint.textContent = inMatch
    ? 'Match in progress'
    : remoteVisible
      ? (both ? (isHost ? 'Press START MATCH.' : 'Waiting for host…') : 'Both players must be ready.')
      : 'Share the code with a friend.';
}

function applyMyCharacter() {
  // Rebuild local character mesh with selected colors
  scene.remove(localPlayer.group);
  const c = myCharacter;
  const newPlayer = makePlayer(c.body, c.accent, local.x, local.z);
  newPlayer.group.position.copy(localPlayer.group.position);
  newPlayer.group.rotation.copy(localPlayer.group.rotation);
  // Replace reference
  Object.assign(localPlayer, newPlayer);
}

function applyRemoteCharacter() {
  scene.remove(remotePlayer.group);
  const c = remoteChar;
  const newPlayer = makePlayer(c.body, c.accent, remote.x, remote.z);
  Object.assign(remotePlayer, newPlayer);
  remotePlayer.group.visible = remoteVisible;
}

/* ============ ATTACH CHANNEL ============ */
async function attachChannel(code, name) {
  channel = new Net.RoomChannel(code, selfId, name);

  channel.on('hello', () => {
    channel.send('peer', { name: selfName, char: myCharacter.id });
  });
  channel.on('peer', ({ name, char }) => {
    remoteName = name || 'Peer';
    remoteChar = CHARACTERS.find(c => c.id === char) || CHARACTERS[1];
    remoteVisible = true;
    applyRemoteCharacter();
    renderRoom();
  });
  channel.on('ready', ({ ready }) => {
    peerReady = !!ready;
    renderRoom();
  });
  channel.on('start', () => {
    startCountdownThenMatch();
  });
  channel.on('move', ({ x, y, z, ry }) => {
    remoteTarget.x = Number(x) || 0;
    remoteTarget.y = Number(y) || 0;
    remoteTarget.z = Number(z) || 0;
    remoteTarget.ry = Number(ry) || 0;
    remoteVisible = true;
  });
  channel.on('leave', () => {
    remoteVisible = false;
    peerReady = false;
    renderRoom();
    toast('Peer left 👋');
  });

  await channel.join();
}

/* ============ ACTIONS ============ */
async function doCreate() {
  createError.classList.add('hidden');
  setStatus(createStatus, 'Creating room…');

  const name = (nameInput.value || '').trim() || 'Player 1';
  const res = await Net.createRoom(name);
  if (!res.ok) {
    setStatus(createStatus, 'Failed', 'bad');
    createError.textContent = 'Could not create room: ' + res.error;
    createError.classList.remove('hidden');
    return;
  }

  selfId = res.hostId;
  selfName = name;
  roomCode = res.code;
  isHost = true;
  meReady = false; peerReady = false;
  remoteVisible = false; inMatch = false;

  try {
    await attachChannel(roomCode, selfName);
    applyMyCharacter();
    showScreen('roomScreen');
    renderRoom();
  } catch (e) {
    setStatus(createStatus, 'Realtime failed', 'bad');
    createError.textContent = 'Could not open realtime channel.';
    createError.classList.remove('hidden');
  }
}

async function doJoin() {
  joinError.classList.add('hidden');
  const code = (codeInput.value || '').toUpperCase().trim();
  const name = (nameInput.value || '').trim() || 'Player 2';

  if (code.length < 4) {
    joinError.textContent = 'Enter a room code.';
    joinError.classList.remove('hidden');
    return;
  }

  setStatus(joinStatus, 'Looking up room…');
  const found = await Net.findRoom(code);
  if (!found.ok) {
    setStatus(joinStatus, 'Not found', 'bad');
    joinError.textContent = found.error === 'not_found' ? 'Room not found.' : found.error;
    joinError.classList.remove('hidden');
    return;
  }

  selfId = crypto.randomUUID();
  selfName = name;
  roomCode = found.code;
  isHost = false;
  meReady = false; peerReady = false;
  remoteVisible = false; inMatch = false;

  try {
    await attachChannel(roomCode, selfName);
    applyMyCharacter();
    showScreen('roomScreen');
    renderRoom();
  } catch (e) {
    setStatus(joinStatus, 'Realtime failed', 'bad');
    joinError.textContent = 'Could not open realtime channel.';
    joinError.classList.remove('hidden');
  }
}

async function doLeave() {
  if (channel) { await channel.leave(); channel = null; }
  if (isHost && roomCode) Net.deleteRoom(roomCode);
  roomCode = ''; isHost = false;
  meReady = false; peerReady = false;
  remoteVisible = false; inMatch = false;
  gameTopbar.classList.add('hidden');
  gameBottomHud.classList.add('hidden');
  showScreen('mainMenu');
}

/* ============ COUNTDOWN + MATCH ============ */
async function startCountdownThenMatch() {
  // Hide lobby, show game
  showScreen(null);
  screens.mainMenu.classList.add('hidden');
  for (const el of Object.values(screens)) el.classList.add('hidden');

  countdownOverlay.classList.remove('hidden');

  const steps = ['3','2','1','GO!'];
  for (const n of steps) {
    countdownNumber.textContent = n;
    countdownNumber.style.animation = 'none';
    void countdownNumber.offsetWidth;
    countdownNumber.style.animation = 'countPulse .8s ease-out';
    await sleep(n === 'GO!' ? 500 : 800);
  }
  countdownOverlay.classList.add('hidden');

  beginMatch();
}

function beginMatch() {
  inMatch = true;

  local.x = -3; local.y = 0; local.z = 3; local.ry = 0;
  local.vy = 0; local.grounded = true;

  remoteTarget.x = 3; remoteTarget.y = 0; remoteTarget.z = -3; remoteTarget.ry = Math.PI;
  remote.x = 3; remote.y = 0; remote.z = -3; remote.ry = Math.PI;

  gameTopbar.classList.remove('hidden');
  gameBottomHud.classList.remove('hidden');
  scoreName0.textContent = selfName || 'P1';
  scoreName1.textContent = remoteName || 'P2';
  scoreVal0.textContent = '0';
  scoreVal1.textContent = '0';
  hudEmoji.textContent = '✨';
  hudLabel.textContent = 'LIVE';
}

/* ============ WIRE UP BUTTONS ============ */
createBtn.onclick    = doCreate;
joinBtn.onclick      = doJoin;
leaveRoomBtn.onclick = doLeave;

readyBtn.onclick = () => {
  meReady = !meReady;
  channel?.send('ready', { ready: meReady });
  renderRoom();
};

startBtn.onclick = () => {
  if (!isHost) return;
  channel?.send('start', {});
  startCountdownThenMatch();
};

copyCodeBtn.onclick = async () => {
  try { await navigator.clipboard.writeText(roomCode); toast('Code copied 📋'); }
  catch { toast(roomCode); }
};

/* ============ MAIN LOOP ============ */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.04);
  updateLocalPlayer(dt);
  updateRemotePlayer(dt);
  cameraFollow(dt);
  sparkles.rotation.y += dt * 0.03;
  renderer.render(scene, camera);
}

/* ============ INIT ============ */
loading.classList.add('gone');
setTimeout(() => loading.remove(), 500);
showScreen('mainMenu');
renderControls();
animate();
