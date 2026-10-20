import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import * as Net from './network.js';
import { LOGIN_URL } from './config.js';

/* ============================================================
   DOM ROOT
   ============================================================ */
const root    = document.querySelector('#play-root');
const canvas  = document.querySelector('#game');
const loading = document.querySelector('#loading');

const screens = {
  loginScreen:     document.querySelector('#loginScreen'),
  mainMenu:        document.querySelector('#mainMenu'),
  characterScreen: document.querySelector('#characterScreen'),
  createScreen:    document.querySelector('#createScreen'),
  joinScreen:      document.querySelector('#joinScreen'),
  roomScreen:      document.querySelector('#roomScreen'),
  settingsScreen:  document.querySelector('#settingsScreen'),
  helpMenuScreen:  document.querySelector('#helpMenuScreen'),
  historyScreen:   document.querySelector('#historyScreen')
};

function showScreen(id) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('hidden', key !== id);
  }
}
document.querySelectorAll('[data-back]').forEach(btn => {
  btn.onclick = () => showScreen(btn.dataset.back);
});
document.querySelector('#loginLink').href = LOGIN_URL;

/* ============================================================
   AUTH BOOT
   ============================================================ */
let IR_USER = null;

async function boot() {
  const user = await Net.getIRUser();
  if (!user.ok) {
    showScreen('loginScreen');
    loading.classList.add('gone');
    setTimeout(() => loading.remove(), 400);
    return;
  }
  IR_USER = user;
  const badge = document.querySelector('#irBadge');
  badge.textContent = `${user.irId} · ${user.name}`;
  badge.classList.add('linked');
  showScreen('mainMenu');
  loading.classList.add('gone');
  setTimeout(() => loading.remove(), 400);
}

/* ============================================================
   SETTINGS
   ============================================================ */
const DEFAULTS = {
  sensitivity: 10, cameraDistance: 9,
  joystickX: 15, joystickY: 78,
  jumpX: 85, jumpY: 78,
  buttonSize: 100, buttonOpacity: 70,
  keys: { up: 'w', down: 's', left: 'a', right: 'd', jump: ' ' }
};
let settings = structuredClone(DEFAULTS);
let SETTINGS_KEY = 'mochi_settings_guest';

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return { ...DEFAULTS, ...saved, keys: { ...DEFAULTS.keys, ...(saved.keys || {}) } };
  } catch { return structuredClone(DEFAULTS); }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

/* ============================================================
   CHARACTERS
   ============================================================ */
const CHARACTERS = [
  { id: 'blue',   name: 'BLUE',   body: '#6ec6ff', accent: '#a99aff', emoji: '💙' },
  { id: 'pink',   name: 'PINK',   body: '#ff8cc8', accent: '#a99aff', emoji: '🌸' },
  { id: 'purple', name: 'PLUM',   body: '#a99aff', accent: '#78e9d2', emoji: '🍇' },
  { id: 'mint',   name: 'MINT',   body: '#78e9d2', accent: '#ffe277', emoji: '🌿' }
];
let myCharacter = CHARACTERS[0];

/* ============================================================
   STATE
   ============================================================ */
const local  = { x: -3, y: 0, z: 3, ry: 0, vy: 0, grounded: true };
let remote   = { x: 3, y: 0, z: -3, ry: Math.PI, vy: 0, grounded: true };
let remoteTarget = { x: 3, y: 0, z: -3, ry: Math.PI };
let remoteVisible = false;
let remoteName = '';
let remoteIrId = '';
let remoteChar = CHARACTERS[1];

let channel = null;
let selfName = '';
let roomCode = '';
let isHost = false;
let peerReady = false;
let meReady = false;
let inMatch = false;
let lastMoveSent = 0;
let currentMatchId = null;

/* ============================================================
   DOM REFS
   ============================================================ */
const playBtn         = document.querySelector('#playBtn');
const joinMenuBtn     = document.querySelector('#joinMenuBtn');
const settingsBtn     = document.querySelector('#settingsBtn');
const helpMenuBtn     = document.querySelector('#helpMenuBtn');
const historyBtn      = document.querySelector('#historyBtn');
const createBtn       = document.querySelector('#createBtn');
const joinBtn         = document.querySelector('#joinBtn');
const codeInput       = document.querySelector('#codeInput');
const createError     = document.querySelector('#createError');
const createStatus    = document.querySelector('#createStatus');
const joinError       = document.querySelector('#joinError');
const joinStatus      = document.querySelector('#joinStatus');
const charGrid        = document.querySelector('#charGrid');
const charContinueBtn = document.querySelector('#charContinueBtn');
const roomCodeText    = document.querySelector('#roomCodeText');
const copyCodeBtn     = document.querySelector('#copyCodeBtn');
const leaveRoomBtn    = document.querySelector('#leaveRoomBtn');
const readyBtn        = document.querySelector('#readyBtn');
const startBtn        = document.querySelector('#startBtn');
const roomHint        = document.querySelector('#roomHint');
const roomSettingsBtn = document.querySelector('#roomSettingsBtn');
const settingsBackBtn = document.querySelector('#settingsBackBtn');
const sensSlider      = document.querySelector('#sensSlider');
const sensVal         = document.querySelector('#sensVal');
const distSlider      = document.querySelector('#distSlider');
const distVal         = document.querySelector('#distVal');
const sizeSlider      = document.querySelector('#sizeSlider');
const sizeVal         = document.querySelector('#sizeVal');
const opacitySlider   = document.querySelector('#opacitySlider');
const opacityVal      = document.querySelector('#opacityVal');
const controlList     = document.querySelector('#controlList');
const resetControlsBtn= document.querySelector('#resetControlsBtn');
const openLayoutBtn   = document.querySelector('#openLayoutBtn');
const resetLayoutBtn  = document.querySelector('#resetLayoutBtn');
const layoutEditor    = document.querySelector('#layoutEditor');
const layoutStage     = document.querySelector('#layoutStage');
const editJoystick    = document.querySelector('#editJoystick');
const editJump        = document.querySelector('#editJump');
const layoutDoneBtn   = document.querySelector('#layoutDoneBtn');
const countdownOverlay= document.querySelector('#countdownOverlay');
const countdownNumber = document.querySelector('#countdownNumber');
const gameTopbar      = document.querySelector('#gameTopbar');
const gameBottomHud   = document.querySelector('#gameBottomHud');
const scoreName0      = document.querySelector('#scoreName0');
const scoreName1      = document.querySelector('#scoreName1');
const scoreVal0       = document.querySelector('#scoreVal0');
const scoreVal1       = document.querySelector('#scoreVal1');
const hudEmoji        = document.querySelector('#hudEmoji');
const hudLabel        = document.querySelector('#hudLabel');
const hudCount        = document.querySelector('#hudCount');
const histList        = document.querySelector('#histList');
const histEmpty       = document.querySelector('#histEmpty');

const slotEls = [
  { el: document.querySelector('#slot0'), avatar: document.querySelector('#slotAvatar0'), name: document.querySelector('#slotName0'), ready: document.querySelector('#slotReady0') },
  { el: document.querySelector('#slot1'), avatar: document.querySelector('#slotAvatar1'), name: document.querySelector('#slotName1'), ready: document.querySelector('#slotReady1') }
];

/* ============================================================
   NAV
   ============================================================ */
playBtn.onclick         = () => showScreen('characterScreen');
joinMenuBtn.onclick     = () => showScreen('joinScreen');
settingsBtn.onclick     = () => { openSettings(); showScreen('settingsScreen'); };
helpMenuBtn.onclick     = () => showScreen('helpMenuScreen');
historyBtn.onclick      = () => { loadHistory(); showScreen('historyScreen'); };
roomSettingsBtn.onclick = () => { openSettings(); showScreen('settingsScreen'); };
settingsBackBtn.onclick = () => showScreen(roomCode && !inMatch ? 'roomScreen' : 'mainMenu');

/* ============================================================
   CHARACTER SELECT
   ============================================================ */
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
      applyMyCharacter();
    };
    charGrid.appendChild(tile);
  }
}
charContinueBtn.onclick = () => showScreen('createScreen');

/* ============================================================
   SETTINGS UI
   ============================================================ */
const KEY_LABELS = { up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right', jump: 'Jump' };
let listeningFor = null;

function prettyKey(k) {
  if (k === ' ') return 'SPACE';
  if (k === 'arrowup') return '↑';
  if (k === 'arrowdown') return '↓';
  if (k === 'arrowleft') return '←';
  if (k === 'arrowright') return '→';
  return k.toUpperCase();
}

function renderControls() {
  controlList.innerHTML = '';
  for (const action of Object.keys(KEY_LABELS)) {
    const row = document.createElement('div');
    row.className = 'control-row';
    row.innerHTML = `<span class="control-label">${KEY_LABELS[action]}</span>`;
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
    row.appendChild(keyBtn);
    controlList.appendChild(row);
  }
}

window.addEventListener('keydown', e => {
  if (!listeningFor) return;
  e.preventDefault(); e.stopPropagation();
  let key = e.key.toLowerCase();
  if (e.code === 'Space') key = ' ';
  const conflict = Object.entries(settings.keys).find(([a, k]) => a !== listeningFor && k === key);
  if (conflict) { toast(`Already used for ${KEY_LABELS[conflict[0]]}`); return; }
  settings.keys[listeningFor] = key;
  saveSettings();
  const action = listeningFor;
  listeningFor = null;
  document.querySelectorAll('.control-key').forEach(b => {
    b.classList.remove('listening');
    if (b.dataset.action === action) b.textContent = prettyKey(settings.keys[action]);
  });
});

function openSettings() {
  sensSlider.value = settings.sensitivity; sensVal.textContent = settings.sensitivity;
  distSlider.value = settings.cameraDistance; distVal.textContent = settings.cameraDistance;
  sizeSlider.value = settings.buttonSize; sizeVal.textContent = settings.buttonSize + '%';
  opacitySlider.value = settings.buttonOpacity; opacityVal.textContent = settings.buttonOpacity + '%';
  renderControls();
}

sensSlider.oninput    = () => { settings.sensitivity = +sensSlider.value; sensVal.textContent = sensSlider.value; saveSettings(); };
distSlider.oninput    = () => { settings.cameraDistance = +distSlider.value; distVal.textContent = distSlider.value; saveSettings(); };
sizeSlider.oninput    = () => { settings.buttonSize = +sizeSlider.value; sizeVal.textContent = sizeSlider.value + '%'; saveSettings(); applyButtonLayout(); };
opacitySlider.oninput = () => { settings.buttonOpacity = +opacitySlider.value; opacityVal.textContent = opacitySlider.value + '%'; saveSettings(); applyButtonLayout(); };
resetControlsBtn.onclick = () => { settings.keys = structuredClone(DEFAULTS.keys); saveSettings(); renderControls(); toast('Keys reset'); };

/* ============================================================
   LAYOUT EDITOR
   ============================================================ */
function openLayoutEditor() { layoutEditor.classList.remove('hidden'); positionEditHandles(); }
function closeLayoutEditor() { layoutEditor.classList.add('hidden'); applyButtonLayout(); saveSettings(); }
openLayoutBtn.onclick  = openLayoutEditor;
layoutDoneBtn.onclick  = closeLayoutEditor;
resetLayoutBtn.onclick = () => {
  settings.joystickX = DEFAULTS.joystickX; settings.joystickY = DEFAULTS.joystickY;
  settings.jumpX = DEFAULTS.jumpX; settings.jumpY = DEFAULTS.jumpY;
  saveSettings(); applyButtonLayout();
  if (!layoutEditor.classList.contains('hidden')) positionEditHandles();
  toast('Layout reset');
};

function positionEditHandles() {
  editJoystick.style.left = `${settings.joystickX}%`;
  editJoystick.style.top  = `${settings.joystickY}%`;
  editJoystick.style.transform = 'translate(-50%,-50%)';
  editJump.style.left = `${settings.jumpX}%`;
  editJump.style.top  = `${settings.jumpY}%`;
  editJump.style.transform = 'translate(-50%,-50%)';
}

let draggingEl = null, dragOffset = { x: 0, y: 0 };
function setupDrag(el, keyX, keyY) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    draggingEl = el;
    const r = el.getBoundingClientRect();
    dragOffset.x = e.clientX - (r.left + r.width / 2);
    dragOffset.y = e.clientY - (r.top + r.height / 2);
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (draggingEl !== el) return;
    const stage = layoutStage.getBoundingClientRect();
    if (!stage.width) return;
    const cx = e.clientX - dragOffset.x;
    const cy = e.clientY - dragOffset.y;
    let px = ((cx - stage.left) / stage.width) * 100;
    let py = ((cy - stage.top) / stage.height) * 100;
    px = Math.max(6, Math.min(94, px));
    py = Math.max(6, Math.min(94, py));
    el.style.left = `${px}%`;
    el.style.top  = `${py}%`;
    settings[keyX] = px;
    settings[keyY] = py;
  });
  el.addEventListener('pointerup', () => { draggingEl = null; saveSettings(); });
  el.addEventListener('pointercancel', () => { draggingEl = null; saveSettings(); });
}
setupDrag(editJoystick, 'joystickX', 'joystickY');
setupDrag(editJump, 'jumpX', 'jumpY');

/* ============================================================
   ON-SCREEN CONTROLS — created ONCE at boot, always available
   ============================================================ */
const joystickEl = document.createElement('div');
joystickEl.className = 'game-joystick';
joystickEl.id = 'gameJoystick';
joystickEl.innerHTML = '<div class="game-joystick-knob"></div>';
root.appendChild(joystickEl);
const joystickKnob = joystickEl.querySelector('.game-joystick-knob');

const jumpBtnEl = document.createElement('button');
jumpBtnEl.className = 'game-jump-btn';
jumpBtnEl.id = 'gameJumpBtn';
jumpBtnEl.type = 'button';
jumpBtnEl.innerHTML = '<span class="jump-arrow">⬆</span><span class="jump-text">JUMP</span>';
root.appendChild(jumpBtnEl);

function showControls() {
  joystickEl.style.display = 'flex';
  jumpBtnEl.style.display = 'flex';
}
function hideControls() {
  joystickEl.style.display = 'none';
  jumpBtnEl.style.display = 'none';
}
// Start hidden — will be shown when match begins
hideControls();

function applyButtonLayout() {
  const scale = settings.buttonSize / 100;
  const op = settings.buttonOpacity / 100;
  joystickEl.style.left = `${settings.joystickX}%`;
  joystickEl.style.top  = `${settings.joystickY}%`;
  joystickEl.style.transform = `translate(-50%,-50%) scale(${scale})`;
  joystickEl.style.opacity = op;
  jumpBtnEl.style.left = `${settings.jumpX}%`;
  jumpBtnEl.style.top  = `${settings.jumpY}%`;
  jumpBtnEl.style.transform = `translate(-50%,-50%) scale(${scale})`;
  jumpBtnEl.style.opacity = op;
}

let touchId = null, touchOrigin = null, touchDelta = { x: 0, y: 0 };
joystickEl.addEventListener('pointerdown', e => {
  e.preventDefault();
  touchId = e.pointerId;
  const r = joystickEl.getBoundingClientRect();
  touchOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  joystickEl.setPointerCapture(e.pointerId);
  joystickEl.classList.add('active');
  moveJoystick(e);
});
joystickEl.addEventListener('pointermove', moveJoystick);
function moveJoystick(e) {
  if (touchId !== e.pointerId) return;
  const dx = e.clientX - touchOrigin.x, dy = e.clientY - touchOrigin.y;
  const len = Math.max(1, Math.hypot(dx, dy)), scale = Math.min(1, len / 45);
  touchDelta = { x: dx / len * scale, y: dy / len * scale };
  joystickKnob.style.transform = `translate(${touchDelta.x * 30}px,${touchDelta.y * 30}px)`;
}
function endJoystick(e) {
  if (touchId === e.pointerId) {
    touchId = null; touchDelta = { x: 0, y: 0 };
    joystickEl.classList.remove('active');
    joystickKnob.style.transform = 'translate(0,0)';
  }
}
joystickEl.addEventListener('pointerup', endJoystick);
joystickEl.addEventListener('pointercancel', endJoystick);
jumpBtnEl.addEventListener('pointerdown', e => { e.preventDefault(); jump(); });

/* ============================================================
   THREE SCENE
   ============================================================ */
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
grid.position.y = -0.035; grid.material.transparent = true; grid.material.opacity = 0.4; scene.add(grid);

function box(w,h,d,c,x,y,z){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(c));
  m.position.set(x,y,z); m.castShadow = m.receiveShadow = true; scene.add(m); return m;
}
box(28,.65,.65,'#ff85bd',0,.15,-14); box(28,.65,.65,'#78e9d2',0,.15,14);
box(.65,.65,28,'#a99aff',-14,.15,0); box(.65,.65,28,'#ffe277',14,.15,0);
box(7,.18,5,'#ffd8ec',0,.02,0); box(3.2,.5,3.2,'#ff7db7',0,.3,0); box(2.1,.22,2.1,'#ffe66d',0,.66,0);
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
    const m = new THREE.Mesh(new THREE.SphereGeometry(r,12,10), mat('#fff')); m.position.set(ox,oy,oz); g.add(m);
  } g.position.set(x,y,z); g.scale.setScalar(s); scene.add(g);
}

/* ============================================================
   CHARACTER MESH
   ============================================================ */
function makePlayer(bodyColor, accentColor, x, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(.72,24,18), mat(bodyColor));
  body.scale.set(.85,1,.72); body.position.y = .92; body.castShadow = true; g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(.45,20,14), mat('#fff1e9'));
  belly.scale.set(.9,.78,.22); belly.position.set(0,.8,.48); g.add(belly);
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

const localPlayer  = makePlayer('#6ec6ff','#a99aff', -3,  3);
const remotePlayer = makePlayer('#ff8cc8','#a99aff',  3, -3);
remotePlayer.group.visible = false;

const sparkles = new THREE.Group(); scene.add(sparkles);
for (let i = 0; i < 30; i++) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(.045,6,6), mat(i%2?'#fff1a8':'#fff'));
  s.position.set((Math.random()-.5)*24, .5+Math.random()*4, (Math.random()-.5)*24);
  sparkles.add(s);
}

function applyMyCharacter() {
  if (!myCharacter) return;
  scene.remove(localPlayer.group);
  const p = makePlayer(myCharacter.body, myCharacter.accent, local.x, local.z);
  Object.assign(localPlayer, p);
}
function applyRemoteCharacter() {
  scene.remove(remotePlayer.group);
  const p = makePlayer(remoteChar.body, remoteChar.accent, remote.x, remote.z);
  Object.assign(remotePlayer, p);
  remotePlayer.group.visible = remoteVisible;
}

/* ============================================================
   INPUT
   ============================================================ */
const keys = new Set();
let yaw = 0, pitch = 0.26, dragging = false, lastX = 0, lastY = 0;
const moveVec = new THREE.Vector3();
const clock = new THREE.Clock();

function jump() {
  if (!inMatch || !local.grounded) return;
  local.vy = 7.2; local.grounded = false;
}
window.addEventListener('keydown', e => {
  if (listeningFor) return;
  const k = e.code === 'Space' ? ' ' : e.key.toLowerCase();
  if ([settings.keys.up, settings.keys.down, settings.keys.left, settings.keys.right, ' '].includes(k)) e.preventDefault();
  keys.add(k);
  if (k === settings.keys.jump) jump();
});
window.addEventListener('keyup', e => {
  const k = e.code === 'Space' ? ' ' : e.key.toLowerCase();
  keys.delete(k);
});

canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture?.(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const sens = 0.006 * (settings.sensitivity / 10);
  yaw -= (e.clientX - lastX) * sens;
  pitch = THREE.MathUtils.clamp(pitch + (e.clientY - lastY) * 0.003 * (settings.sensitivity / 10), -0.1, 0.8);
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointerup', () => dragging = false);
canvas.addEventListener('pointercancel', () => dragging = false);

/* ============================================================
   TOAST
   ============================================================ */
function toast(msg) {
  const el = document.querySelector('#toast');
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 1400);
}

/* ============================================================
   ROOM UI
   ============================================================ */
function setStatus(el, text, state) {
  el.textContent = text;
  el.className = 'conn-status' + (state ? ' ' + state : '');
}

function renderRoom() {
  roomCodeText.textContent = roomCode || '-----';
  const my = slotEls[0], peer = slotEls[1];

  my.avatar.textContent = myCharacter.emoji;
  my.name.textContent = selfName;
  my.ready.textContent = meReady ? 'READY' : 'not ready';
  my.el.classList.add('you');
  my.el.classList.toggle('ready', meReady);

  if (remoteVisible) {
    peer.avatar.textContent = remoteChar.emoji;
    peer.name.textContent = `${remoteName}${remoteIrId ? ' · ' + remoteIrId : ''}`;
    peer.ready.textContent = peerReady ? 'READY' : 'not ready';
    peer.el.classList.toggle('ready', peerReady);
    peer.el.style.opacity = 1;
  } else {
    peer.avatar.textContent = '🍡';
    peer.name.textContent = '—';
    peer.ready.textContent = 'waiting…';
    peer.el.classList.remove('ready');
    peer.el.style.opacity = .6;
  }

  if (isHost) {
    startBtn.classList.remove('hidden');
    const canStart = remoteVisible;
    startBtn.disabled = !canStart;
    startBtn.style.opacity = canStart ? '1' : '0.5';
    startBtn.style.pointerEvents = canStart ? 'auto' : 'none';
    startBtn.textContent = canStart ? 'START MATCH' : 'WAITING FOR PEER…';
  } else {
    startBtn.classList.add('hidden');
  }

  readyBtn.classList.toggle('hidden', inMatch);
  readyBtn.textContent = meReady ? 'NOT READY' : 'READY';

  roomHint.textContent = inMatch ? 'Match in progress'
    : remoteVisible
      ? (meReady && peerReady ? (isHost ? 'Press START MATCH.' : 'Waiting for host…') : 'Both players must be ready.')
      : 'Waiting for friend to join…';
}

/* ============================================================
   CHANNEL ATTACH
   ============================================================ */
async function attachChannel(code) {
  channel = new Net.RoomChannel(code, IR_USER.userId, selfName);

  channel.on('hello', () => {
    channel.send('peer', { name: selfName, irId: IR_USER.irId, char: myCharacter.id });
  });

  channel.on('peer', ({ name, irId, char }) => {
    remoteName = name || 'Peer';
    remoteIrId = irId || '';
    remoteChar = CHARACTERS.find(c => c.id === char) || CHARACTERS[1];
    remoteVisible = true;
    applyRemoteCharacter();
    remotePlayer.group.visible = true;
    renderRoom();
    channel.send('peer', { name: selfName, irId: IR_USER.irId, char: myCharacter.id });
  });

  channel.on('ready', ({ ready }) => { peerReady = !!ready; renderRoom(); });
  channel.on('start', () => startCountdownThenMatch());

  channel.on('move', ({ x, y, z, ry }) => {
    remoteTarget.x = Number(x) || 0;
    remoteTarget.y = Number(y) || 0;
    remoteTarget.z = Number(z) || 0;
    remoteTarget.ry = Number(ry) || 0;
    if (!remoteVisible) {
      remoteVisible = true;
      remotePlayer.group.visible = true;
      renderRoom();
    }
  });

  channel.on('leave', () => {
    remoteVisible = false; peerReady = false; renderRoom();
    toast('Peer left 👋');
  });

  await channel.join();
}

/* ============================================================
   CREATE / JOIN / LEAVE
   ============================================================ */
async function doCreate() {
  createError.classList.add('hidden');
  setStatus(createStatus, 'Creating room…');
  const res = await Net.createRoom(IR_USER.userId, IR_USER.irId);
  if (!res.ok) {
    setStatus(createStatus, 'Failed', 'bad');
    createError.textContent = 'Could not create room: ' + res.error;
    createError.classList.remove('hidden');
    return;
  }
  selfName = IR_USER.name;
  roomCode = res.code;
  isHost = true;
  meReady = false; peerReady = false; remoteVisible = false; inMatch = false;
  currentMatchId = null;

  try {
    await attachChannel(roomCode);
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
  if (code.length < 4) { joinError.textContent = 'Enter a room code.'; joinError.classList.remove('hidden'); return; }
  setStatus(joinStatus, 'Looking up room…');
  const found = await Net.findRoom(code);
  if (!found.ok) {
    setStatus(joinStatus, 'Not found', 'bad');
    joinError.textContent = found.error === 'not_found' ? 'Room not found.' : found.error;
    joinError.classList.remove('hidden');
    return;
  }
  selfName = IR_USER.name;
  roomCode = found.code;
  isHost = false;
  meReady = false; peerReady = false; remoteVisible = false; inMatch = false;
  currentMatchId = null;

  try {
    await attachChannel(roomCode);
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
  hideControls();
  showScreen('mainMenu');
}

/* ============================================================
   COUNTDOWN + MATCH
   ============================================================ */
async function startCountdownThenMatch() {
  for (const el of Object.values(screens)) el.classList.add('hidden');
  countdownOverlay.classList.remove('hidden');
  for (const n of ['3','2','1','GO!']) {
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

  local.x = -3; local.y = 0; local.z = 3; local.ry = 0; local.vy = 0; local.grounded = true;

  if (remoteVisible) {
    remoteTarget.x = 3; remoteTarget.y = 0; remoteTarget.z = -3; remoteTarget.ry = Math.PI;
    remote.x = 3; remote.y = 0; remote.z = -3; remote.ry = Math.PI;
    remotePlayer.group.position.set(3, 0, -3);
    remotePlayer.group.visible = true;
  }

  currentMatchId = 'mm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

  gameTopbar.classList.remove('hidden');
  gameBottomHud.classList.remove('hidden');

  // SHOW controls — this is the fix
  applyButtonLayout();
  showControls();

  scoreName0.textContent = selfName;
  scoreName1.textContent = remoteName || 'P2';
  scoreVal0.textContent = '0';
  scoreVal1.textContent = '0';
  hudEmoji.textContent = '✨';
  hudLabel.textContent = 'LIVE';
}

/* ============================================================
   MATCH HISTORY
   ============================================================ */
async function loadHistory() {
  histList.innerHTML = '';
  histEmpty.classList.add('hidden');
  const res = await Net.loadMatchHistory(IR_USER.irId, 10);
  if (!res.ok || !res.matches.length) { histEmpty.classList.remove('hidden'); return; }
  for (const m of res.matches) {
    const item = document.createElement('div');
    item.className = 'hist-item ' + (m.won ? 'won' : 'lost');
    const date = new Date(m.played_at).toLocaleDateString();
    item.innerHTML = `
      <div class="hist-icon">${m.won ? '🏆' : '💔'}</div>
      <div class="hist-info">
        <div class="hist-name">vs ${m.opponent_name || 'Player'}${m.opponent_ir_id ? ' · ' + m.opponent_ir_id : ''}</div>
        <div class="hist-score"><b>${m.score_self}</b> – <b>${m.score_opponent}</b> · ${date}</div>
      </div>
    `;
    histList.appendChild(item);
  }
}

/* ============================================================
   UPDATE LOOP
   ============================================================ */
function updateLocalPlayer(dt) {
  if (!inMatch) {
    localPlayer.group.position.set(local.x, local.y, local.z);
    localPlayer.group.rotation.y = local.ry;
    return;
  }

  let f = 0, s = 0;
  if (keys.has(settings.keys.up))    f += 1;
  if (keys.has(settings.keys.down))  f -= 1;
  if (keys.has(settings.keys.right)) s += 1;
  if (keys.has(settings.keys.left))  s -= 1;
  f -= touchDelta.y;
  s += touchDelta.x;
  const len = Math.hypot(f, s);
  if (len > 1) { f /= len; s /= len; }

  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right   = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw));
  moveVec.set(0,0,0).addScaledVector(forward, f).addScaledVector(right, s);
  if (moveVec.lengthSq() > 0.001) {
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
  if (channel && now - lastMoveSent > 50) {
    lastMoveSent = now;
    channel.send('move', { x: local.x, y: local.y, z: local.z, ry: local.ry });
  }
  hudCount.textContent = remoteVisible ? '2P' : '1P';
  const meter = document.querySelector('.meter i');
  if (meter) meter.style.width = '100%';
}

function updateRemotePlayer(dt) {
  if (!remoteVisible) { remotePlayer.group.visible = false; return; }
  remotePlayer.group.visible = true;
  const k = 1 - Math.exp(-dt * 12);
  remote.x += (remoteTarget.x - remote.x) * k;
  remote.y += (remoteTarget.y - remote.y) * k;
  remote.z += (remoteTarget.z - remote.z) * k;
  let d = remoteTarget.ry - remote.ry;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  remote.ry += d * k;
  remotePlayer.group.position.set(remote.x, remote.y, remote.z);
  remotePlayer.group.rotation.y = remote.ry;
}

function cameraFollow(dt) {
  const dist = settings.cameraDistance;
  const target = new THREE.Vector3(local.x, local.y + 1.1, local.z);
  const h = Math.cos(pitch) * dist;
  const off = new THREE.Vector3(Math.sin(yaw) * h, Math.sin(pitch) * dist + 2, Math.cos(yaw) * h);
  camera.position.lerp(target.clone().add(off), 1 - Math.exp(-dt * 5));
  camera.lookAt(target);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.04);
  updateLocalPlayer(dt);
  updateRemotePlayer(dt);
  cameraFollow(dt);
  sparkles.rotation.y += dt * 0.03;
  renderer.render(scene, camera);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ============================================================
   BUTTON WIRING
   ============================================================ */
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
  if (!remoteVisible) { toast('Waiting for peer…'); return; }
  channel?.send('start', {});
  startCountdownThenMatch();
};

copyCodeBtn.onclick = async () => {
  try { await navigator.clipboard.writeText(roomCode); toast('Code copied 📋'); }
  catch { toast(roomCode); }
};

document.querySelector('#helpBtn').onclick   = () => document.querySelector('#helpModal').classList.remove('hidden');
document.querySelector('#closeHelp').onclick = () => document.querySelector('#helpModal').classList.add('hidden');
document.querySelector('#gotIt').onclick     = () => document.querySelector('#helpModal').classList.add('hidden');

/* ============================================================
   LANDSCAPE LOCK
   ============================================================ */
let orientationRequested = false;
async function requestLandscape() {
  if (orientationRequested) return; orientationRequested = true;
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

/* ============================================================
   BOOT
   ============================================================ */
(async function main() {
  await boot();
  if (IR_USER) {
    SETTINGS_KEY = 'mochi_settings_' + IR_USER.irId;
    settings = loadSettings();
    buildCharGrid();
    applyMyCharacter();
    applyButtonLayout();
  }
  animate();
})();
