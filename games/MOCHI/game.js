import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import * as Net from './network.js';
import { LOGIN_URL } from './config.js';

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
  resultsScreen:   document.querySelector('#resultsScreen'),
  settingsScreen:  document.querySelector('#settingsScreen'),
  helpMenuScreen:  document.querySelector('#helpMenuScreen'),
  historyScreen:   document.querySelector('#historyScreen')
};

function showScreen(id) {
  for (const [key, el] of Object.entries(screens)) {
    if (el) el.classList.toggle('hidden', key !== id);
  }
}
document.querySelectorAll('[data-back]').forEach(btn => {
  btn.onclick = () => showScreen(btn.dataset.back);
});
document.querySelector('#loginLink').href = LOGIN_URL;

let IR_USER = null;

// FIXED: Boot function with 3-second timeout
async function boot() {
  try {
    const userPromise = Net.getIRUser();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
    
    const user = await Promise.race([userPromise, timeoutPromise]);
    
    if (!user.ok) {
      if (!navigator.onLine || user.reason === 'timeout') {
        IR_USER = { ok: true, userId: 'offline_guest', irId: 'GUEST', name: 'Guest 🍡' };
        document.querySelector('#irBadge').textContent = `${IR_USER.irId} · ${IR_USER.name}`;
        showScreen('mainMenu');
        return true;
      }
      showScreen('loginScreen');
      return false;
    }
    
    IR_USER = user;
    const badge = document.querySelector('#irBadge');
    badge.textContent = `${user.irId} · ${user.name}`;
    badge.classList.add('linked');
    showScreen('mainMenu');
    return true;
  } catch (err) {
    console.log("Login timeout or error, going offline:", err);
    IR_USER = { ok: true, userId: 'offline_guest', irId: 'GUEST', name: 'Guest 🍡' };
    document.querySelector('#irBadge').textContent = `${IR_USER.irId} · ${IR_USER.name}`;
    showScreen('mainMenu');
    return true;
  }
}

const DEFAULTS = {
  sensitivity: 10, cameraDistance: 9,
  joystickX: 20, joystickY: 20, jumpX: 20, jumpY: 20,
  buttonSize: 100, buttonOpacity: 80,
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

const CHAR_BLUE = { id: 'blue', name: 'BLUE', body: '#6ec6ff', accent: '#a99aff', emoji: '💙' };
const CHAR_PINK = { id: 'pink', name: 'PINK', body: '#ff8cc8', accent: '#a99aff', emoji: '🌸' };
const CHARACTERS = [CHAR_BLUE, CHAR_PINK];

let myCharacter = CHAR_BLUE;
let chosenForHost = CHAR_BLUE;
let selectedGameMode = 'events';

const local  = { x: -3, y: 0, z: 3, ry: 0, vy: 0, grounded: true, radius: 0.6, active: true };
let remote   = { x: 3, y: 0, z: -3, ry: Math.PI, vy: 0, grounded: true, radius: 0.6 };
let remoteTarget = { x: 3, y: 0, z: -3, ry: Math.PI };
let remoteVisible = false;
let remoteName = '';
let remoteIrId = '';
let remoteChar = CHAR_PINK;

let channel = null;
let selfName = '';
let roomCode = '';
let isHost = false;
let peerReady = false;
let meReady = false;
let inMatch = false;
let lastMoveSent = 0;

let currentEvent = 'NONE';
let eventTimeLeft = 0;
let eventTimerInterval = null;
let scoreLocal = 0;
let scoreRemote = 0;
let gameMode = 'events';

let currentRound = 1;
const MAX_ROUNDS = 5;
let totalScoreLocal = 0;
let totalScoreRemote = 0;

const colliders = []; 
const sparkles = new THREE.Group(); 
const sparklesList = [];
const projectiles = [];
const ALL_EVENTS = ['MAGNETIC', 'PENGUIN', 'WOBBLY', 'INVISIBLE', 'KISS'];

// DOM REFS (Shortened for brevity, all queried correctly)
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
const layoutEditor    = document.querySelector('#layoutEditor');
const layoutStage     = document.querySelector('#layoutStage');
const editJoystick    = document.querySelector('#editJoystick');
const editJump        = document.querySelector('#editJump');
const layoutDoneBtn   = document.querySelector('#layoutDoneBtn');
const openLayoutBtn   = document.querySelector('#openLayoutBtn');
const resetLayoutBtn  = document.querySelector('#resetLayoutBtn');
const countdownOverlay= document.querySelector('#countdownOverlay');
const countdownNumber = document.querySelector('#countdownNumber');
const gameTopbar      = document.querySelector('#gameTopbar');
const gameBottomHud   = document.querySelector('#gameBottomHud');
const scoreName0      = document.querySelector('#scoreName0');
const scoreName1      = document.querySelector('#scoreName1');
const scoreVal0       = document.querySelector('#scoreVal0');
const scoreVal1       = document.querySelector('#scoreVal1');
const hudCount        = document.querySelector('#hudCount');
const eventBanner     = document.querySelector('#eventBanner');
const eventTitle      = document.querySelector('#eventTitle');
const eventDesc       = document.querySelector('#eventDesc');
const eventTimer      = document.querySelector('#eventTimer');
const resultsScreen   = document.querySelector('#resultsScreen');
const winnerAnnounce  = document.querySelector('#winnerAnnouncement');
const resName0        = document.querySelector('#resName0');
const resName1        = document.querySelector('#resName1');
const resScore0       = document.querySelector('#resScore0');
const resScore1       = document.querySelector('#resScore1');
const resAvatar0      = document.querySelector('#resAvatar0');
const resAvatar1      = document.querySelector('#resAvatar1');
const rematchBtn      = document.querySelector('#rematchBtn');
const resultsLeaveBtn = document.querySelector('#resultsLeaveBtn');
const histList        = document.querySelector('#histList');
const histEmpty       = document.querySelector('#histEmpty');
const joystickEl = document.querySelector('#joystickZone');
const joystickKnob = document.querySelector('#joystickKnob');
const jumpBtnEl = document.querySelector('#jumpBtnZone');

const shootBtnEl = document.createElement('button');
shootBtnEl.className = 'game-shoot-btn';
shootBtnEl.innerHTML = '💋 SHOOT';
shootBtnEl.style.display = 'none';
root.appendChild(shootBtnEl);

const slotEls = [
  { el: document.querySelector('#slot0'), avatar: document.querySelector('#slotAvatar0'), name: document.querySelector('#slotName0'), ready: document.querySelector('#slotReady0') },
  { el: document.querySelector('#slot1'), avatar: document.querySelector('#slotAvatar1'), name: document.querySelector('#slotName1'), ready: document.querySelector('#slotReady1') }
];

playBtn.onclick         = () => showScreen('characterScreen');
joinMenuBtn.onclick     = () => showScreen('joinScreen');
settingsBtn.onclick     = () => { openSettings(); showScreen('settingsScreen'); };
helpMenuBtn.onclick     = () => showScreen('helpMenuScreen');
historyBtn.onclick      = () => { loadHistory(); showScreen('historyScreen'); };
roomSettingsBtn.onclick = () => { openSettings(); showScreen('settingsScreen'); };
settingsBackBtn.onclick = () => showScreen(roomCode && !inMatch ? 'roomScreen' : 'mainMenu');

document.querySelectorAll('.mode-tile').forEach(tile => {
  tile.onclick = () => {
    document.querySelectorAll('.mode-tile').forEach(t => t.classList.remove('selected'));
    tile.classList.add('selected');
    selectedGameMode = tile.dataset.mode;
  };
});

function buildCharGrid() {
  charGrid.innerHTML = '';
  for (const ch of CHARACTERS) {
    const tile = document.createElement('div');
    tile.className = 'char-tile' + (ch.id === chosenForHost.id ? ' selected' : '');
    tile.innerHTML = `<div class="char-preview" style="background:linear-gradient(135deg,${ch.body},${ch.accent})"></div><div class="char-name">${ch.name}</div>`;
    tile.onclick = () => {
      chosenForHost = ch;
      document.querySelectorAll('.char-tile').forEach(t => t.classList.remove('selected'));
      tile.classList.add('selected');
    };
    charGrid.appendChild(tile);
  }
}
charContinueBtn.onclick = () => { myCharacter = chosenForHost; applyMyCharacter(); showScreen('createScreen'); };

function openSettings() {
  sensSlider.value = settings.sensitivity; sensVal.textContent = settings.sensitivity;
  distSlider.value = settings.cameraDistance; distVal.textContent = settings.cameraDistance;
  sizeSlider.value = settings.buttonSize; sizeVal.textContent = settings.buttonSize + '%';
  opacitySlider.value = settings.buttonOpacity; opacityVal.textContent = settings.buttonOpacity + '%';
}

sensSlider.oninput    = () => { settings.sensitivity = +sensSlider.value; sensVal.textContent = sensSlider.value; saveSettings(); };
distSlider.oninput    = () => { settings.cameraDistance = +distSlider.value; distVal.textContent = distSlider.value; saveSettings(); };
sizeSlider.oninput    = () => { settings.buttonSize = +sizeSlider.value; sizeVal.textContent = sizeSlider.value + '%'; saveSettings(); applyButtonLayout(); };
opacitySlider.oninput = () => { settings.buttonOpacity = +opacitySlider.value; opacityVal.textContent = opacitySlider.value + '%'; saveSettings(); applyButtonLayout(); };

function positionEditHandles() {
  editJoystick.style.left = `${settings.joystickX}%`;
  editJoystick.style.top  = `${100 - settings.joystickY}%`;
  editJoystick.style.transform = 'translate(-50%,-50%)';
  editJump.style.left = `${100 - settings.jumpX}%`;
  editJump.style.top  = `${100 - settings.jumpY}%`;
  editJump.style.transform = 'translate(-50%,-50%)';
}
openLayoutBtn.onclick  = () => { layoutEditor.classList.remove('hidden'); positionEditHandles(); };
layoutDoneBtn.onclick  = () => { layoutEditor.classList.add('hidden'); applyButtonLayout(); saveSettings(); };

let draggingEl = null, dragOffset = { x: 0, y: 0 };
function setupDrag(el, keyX, keyY) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    draggingEl = el;
    const r = el.getBoundingClientRect();
    dragOffset.x = e.clientX - (r.left + r.width / 2);
    dragOffset.y = e.clientY - (r.top + r.height / 2);
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (draggingEl !== el) return;
    e.preventDefault(); e.stopPropagation();
    const stage = layoutStage.getBoundingClientRect();
    if (!stage.width) return;
    const cx = e.clientX - dragOffset.x;
    const cy = e.clientY - dragOffset.y;
    let px = Math.max(6, Math.min(94, ((cx - stage.left) / stage.width) * 100));
    let py = Math.max(6, Math.min(94, ((cy - stage.top) / stage.height) * 100));
    el.style.left = `${px}%`;
    el.style.top  = `${py}%`;
    settings[keyX] = keyX === 'jumpX' ? (100 - px) : px;
    settings[keyY] = keyY === 'jumpY' ? (100 - py) : (100 - py);
  });
  el.addEventListener('pointerup', () => { draggingEl = null; saveSettings(); });
  el.addEventListener('pointercancel', () => { draggingEl = null; saveSettings(); });
}
setupDrag(editJoystick, 'joystickX', 'joystickY');
setupDrag(editJump, 'jumpX', 'jumpY');

function showControls() { joystickEl.style.display = 'flex'; jumpBtnEl.style.display = 'flex'; }
function hideControls() { joystickEl.style.display = 'none'; jumpBtnEl.style.display = 'none'; shootBtnEl.style.display = 'none'; }
hideControls();

function applyButtonLayout() {
  const scale = settings.buttonSize / 100;
  const op = settings.buttonOpacity / 100;
  joystickEl.style.left = `${settings.joystickX}%`;
  joystickEl.style.bottom = `${settings.joystickY}%`;
  joystickEl.style.transform = `translate(-50%, 50%) scale(${scale})`;
  joystickEl.style.opacity = op;
  jumpBtnEl.style.right = `${settings.jumpX}%`;
  jumpBtnEl.style.bottom = `${settings.jumpY}%`;
  jumpBtnEl.style.transform = `translate(50%, 50%) scale(${scale})`;
  jumpBtnEl.style.opacity = op;
  shootBtnEl.style.right = `${settings.jumpX}%`;
  shootBtnEl.style.bottom = `${settings.jumpY + 25}%`; 
  shootBtnEl.style.transform = `translate(50%, 50%) scale(${scale})`;
  shootBtnEl.style.opacity = op;
}

let touchId = null, touchOrigin = null, touchDelta = { x: 0, y: 0 };
joystickEl.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  touchId = e.pointerId;
  const r = joystickEl.getBoundingClientRect();
  touchOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  joystickEl.setPointerCapture(e.pointerId);
  joystickEl.classList.add('active');
  moveJoystick(e);
});
joystickEl.addEventListener('pointermove', e => { e.preventDefault(); e.stopPropagation(); moveJoystick(e); });
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
jumpBtnEl.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); jump(); });

shootBtnEl.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  shootKiss();
});

function shootKiss() {
  if (currentEvent !== 'KISS' || !inMatch) return;
  SFX.kiss();
  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshStandardMaterial({ color: '#ff0066', emissive: '#ff0066' }));
  heart.scale.set(1, 0.8, 0.4);
  heart.position.set(local.x, local.y + 1, local.z);
  scene.add(heart);
  const dir = new THREE.Vector3(Math.sin(local.ry), 0, Math.cos(local.ry));
  projectiles.push({ mesh: heart, x: local.x, y: local.y + 1, z: local.z, vx: dir.x * 15, vz: dir.z * 15, isLocal: true });
  channel.send('shoot', { x: local.x, y: local.y + 1, z: local.z, ry: local.ry });
}

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playTone(freq, type, dur) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + dur);
}
const SFX = {
  jump: () => playTone(400, 'sine', 0.15),
  event: () => { playTone(600, 'square', 0.1); setTimeout(() => playTone(800, 'square', 0.2), 100); },
  collect: () => playTone(1200, 'sine', 0.1),
  hit: () => playTone(150, 'sawtooth', 0.3),
  kiss: () => playTone(800, 'triangle', 0.2),
  splat: () => playTone(100, 'sawtooth', 0.4)
};

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
  m.position.set(x,y,z); m.castShadow = m.receiveShadow = true; scene.add(m);
  colliders.push({ minX: x - w/2, maxX: x + w/2, minY: y - h/2, maxY: y + h/2, minZ: z - d/2, maxZ: z + d/2 });
  return m;
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

function makePlayer(bodyColor, accentColor, x, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(.72,24,18), mat(bodyColor));
  body.scale.set(.85,1,.72); body.position.y = .92; body.castShadow = true; g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(.45,20,14), mat('#fff1e9'));
  belly.scale.set(.9,.78,.22); belly.position.set(0,.8,.48); g.add(belly);
  const faceMat = mat('#30274b');
  for (const ex of [-.22,.22]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(.065,12,10), faceMat); eye.position.set(ex,1.05,.63); g.add(eye); }
  for (const bx of [-.39,.39]) { const blush = new THREE.Mesh(new THREE.SphereGeometry(.1,12,8), mat('#ff9cbd')); blush.position.set(bx,.85,.61); blush.scale.set(1,.6,.3); g.add(blush); }
  const cap = new THREE.Mesh(new THREE.SphereGeometry(.28,16,12), mat(accentColor));
  cap.scale.set(1,.42,1); cap.position.set(0,1.58,0); g.add(cap);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(.12,12,10), mat('#fff1a8')); pom.position.set(0,1.75,0); g.add(pom);
  g.position.set(x,0,z); scene.add(g);
  return { group: g, body, bobBase: 0.92 };
}

const localPlayer  = makePlayer(CHAR_BLUE.body, CHAR_BLUE.accent, -3,  3);
const remotePlayer = makePlayer(CHAR_PINK.body, CHAR_PINK.accent,  3, -3);
remotePlayer.group.visible = false;
scene.add(sparkles);

function applyMyCharacter() {
  scene.remove(localPlayer.group);
  const p = makePlayer(myCharacter.body, myCharacter.accent, local.x, local.z);
  Object.assign(localPlayer, p);
  localPlayer.group.position.set(local.x, local.y, local.z);
}
function applyRemoteCharacter() {
  scene.remove(remotePlayer.group);
  const p = makePlayer(remoteChar.body, remoteChar.accent, remote.x, remote.z);
  Object.assign(remotePlayer, p);
  remotePlayer.group.position.set(remote.x, remote.y, remote.z);
  remotePlayer.group.visible = remoteVisible;
}

const keys = new Set();
let yaw = 0, pitch = 0.26, dragging = false, lastX = 0, lastY = 0;
const moveVec = new THREE.Vector3();
const clock = new THREE.Clock();

function jump() {
  if (!inMatch || !local.grounded) return;
  local.vy = 7.2; local.grounded = false;
  SFX.jump();
}
window.addEventListener('keydown', e => {
  const k = e.code === 'Space' ? ' ' : e.key.toLowerCase();
  if ([settings.keys.up, settings.keys.down, settings.keys.left, settings.keys.right, ' '].includes(k)) e.preventDefault();
  keys.add(k); if (k === settings.keys.jump) jump();
});
window.addEventListener('keyup', e => { keys.delete(e.code === 'Space' ? ' ' : e.key.toLowerCase()); });

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

function toast(msg) {
  const el = document.querySelector('#toast');
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 1400);
}

function startMatch() {
  currentRound = 1; totalScoreLocal = 0; totalScoreRemote = 0; updateScoreUI();
  if (isHost) triggerNextRound();
}

function triggerNextRound() {
  if (currentRound > MAX_ROUNDS) {
    channel.send('match_end', { totalLocal: totalScoreLocal, totalRemote: totalScoreRemote });
    endMatch(totalScoreLocal, totalScoreRemote);
    return;
  }
  const randomEvent = ALL_EVENTS[Math.floor(Math.random() * ALL_EVENTS.length)];
  channel.send('event_start', { event: randomEvent, mode: gameMode, round: currentRound });
  startRound(randomEvent, gameMode, currentRound);
}

function startRound(eventId, mode, roundNum) {
  inMatch = true; currentEvent = eventId; gameMode = mode; currentRound = roundNum;
  hudCount.textContent = `ROUND ${currentRound}/${MAX_ROUNDS}`;
  local.x = -3; local.y = 0; local.z = 3; local.vy = 0;
  remoteTarget.x = 3; remoteTarget.y = 0; remoteTarget.z = -3; remote.x = 3; remote.y = 0; remote.z = -3;
  gameTopbar.classList.remove('hidden'); gameBottomHud.classList.remove('hidden');
  applyButtonLayout(); showControls(); requestLandscape();
  scoreName0.textContent = selfName; scoreName1.textContent = remoteName || 'P2';
  scoreLocal = 0; scoreRemote = 0;
  
  localPlayer.body.material.emissive = new THREE.Color(0x000000);
  remotePlayer.body.material.emissive = new THREE.Color(0x000000);
  localPlayer.group.scale.set(1,1,1); remotePlayer.group.scale.set(1,1,1);
  localPlayer.group.visible = true; remotePlayer.group.visible = remoteVisible;

  let title = "", desc = "";
  if (eventId === 'MAGNETIC') { title = "MAGNETIC MODE 🧲"; desc = "You are pulled together!"; }
  if (eventId === 'PENGUIN') { title = "PENGUIN MODE 🐧"; desc = "Waddle waddle!"; }
  if (eventId === 'WOBBLY') { title = "WOBBLY LEGS 🫨"; desc = "Slippery when wet!"; }
  if (eventId === 'INVISIBLE') { title = "INVISIBLE PARTNER 👻"; desc = "Someone is hiding!"; }
  if (eventId === 'KISS') { title = "FLYING KISS ATTACK 💋"; desc = "Tap the SHOOT button!"; }
  
  eventTitle.textContent = title; eventDesc.textContent = desc;
  eventBanner.classList.remove('hidden'); eventTimer.classList.remove('hidden');
  SFX.event(); setTimeout(() => eventBanner.classList.add('hidden'), 2500);

  if (eventId === 'MAGNETIC') { localPlayer.body.material.emissive = new THREE.Color('#ff0000'); remotePlayer.body.material.emissive = new THREE.Color('#ff0000'); }
  if (eventId === 'PENGUIN') { localPlayer.group.scale.set(1, 0.6, 1); remotePlayer.group.scale.set(1, 0.6, 1); }
  if (eventId === 'INVISIBLE') { if (isHost) localPlayer.group.visible = false; else remotePlayer.group.visible = false; }
  if (eventId === 'KISS') shootBtnEl.style.display = 'flex'; else shootBtnEl.style.display = 'none';

  projectiles.forEach(p => scene.remove(p.mesh)); projectiles.length = 0;

  if (mode === 'missions') {
    sparkles.clear(); sparklesList.length = 0;
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshStandardMaterial({color: '#ff70b7', emissive: '#ff70b7'}));
      s.position.set((Math.random() - 0.5) * 20, 1, (Math.random() - 0.5) * 20);
      sparkles.add(s); sparklesList.push(s);
    }
  }

  eventTimeLeft = 30; eventTimer.textContent = eventTimeLeft; eventTimer.classList.remove('warning');
  clearInterval(eventTimerInterval);
  eventTimerInterval = setInterval(() => {
    eventTimeLeft--; eventTimer.textContent = eventTimeLeft;
    if (eventTimeLeft <= 5) eventTimer.classList.add('warning');
    if (eventTimeLeft <= 0) { clearInterval(eventTimerInterval); endRound(); }
  }, 1000);
}

function endRound() {
  clearInterval(eventTimerInterval); eventTimer.classList.add('hidden'); shootBtnEl.style.display = 'none';
  if (isHost) {
    if (scoreLocal > scoreRemote) totalScoreLocal++; else if (scoreRemote > scoreLocal) totalScoreRemote++;
    channel.send('round_end', { sLocal: scoreLocal, sRemote: scoreRemote });
    updateScoreUI();
    setTimeout(() => { currentRound++; triggerNextRound(); }, 3000);
  } else {
    toast("Round over! Waiting for host...");
  }
}

function endMatch(finalLocal, finalRemote) {
  inMatch = false; hideControls(); gameTopbar.classList.add('hidden'); gameBottomHud.classList.add('hidden');
  currentEvent = 'NONE';
  saveMatchToHistory(finalLocal, finalRemote);
  resName0.textContent = selfName; resName1.textContent = remoteName || 'P2';
  resScore0.textContent = finalLocal; resScore1.textContent = finalRemote;
  resAvatar0.textContent = myCharacter.emoji; resAvatar1.textContent = remoteChar.emoji;
  if (finalLocal > finalRemote) winnerAnnounce.textContent = `${selfName} WINS! 🏆`;
  else if (finalRemote > finalLocal) winnerAnnounce.textContent = `${remoteName || 'P2'} WINS! 🏆`;
  else winnerAnnounce.textContent = "IT'S A TIE! 💖";
  showScreen('resultsScreen');
}

async function saveMatchToHistory(finalLocal, finalRemote) {
  const matchId = 'mm_' + Date.now();
  await Net.saveMatch({
    matchId, userId: IR_USER.userId, irId: IR_USER.irId,
    playerName: selfName, characterId: myCharacter.id,
    opponentIrId: remoteIrId, opponentName: remoteName,
    scoreSelf: finalLocal, scoreOpponent: finalRemote
  });
}

function updateScoreUI() { scoreVal0.textContent = totalScoreLocal; scoreVal1.textContent = totalScoreRemote; }

function renderRoom() {
  roomCodeText.textContent = roomCode || '-----';
  const my = slotEls[0], peer = slotEls[1];
  my.avatar.textContent = myCharacter.emoji; my.name.textContent = selfName;
  my.ready.textContent = meReady ? 'READY' : 'not ready';
  my.el.classList.add('you'); my.el.classList.toggle('ready', meReady);
  if (remoteVisible) {
    peer.avatar.textContent = remoteChar.emoji; peer.name.textContent = `${remoteName}`;
    peer.ready.textContent = peerReady ? 'READY' : 'not ready';
    peer.el.classList.toggle('ready', peerReady); peer.el.style.opacity = 1;
  } else {
    peer.avatar.textContent = '🍡'; peer.name.textContent = '—';
    peer.ready.textContent = 'waiting…'; peer.el.classList.remove('ready'); peer.el.style.opacity = .6;
  }
  if (isHost) {
    startBtn.classList.remove('hidden');
    const canStart = remoteVisible;
    startBtn.disabled = !canStart;
    startBtn.style.opacity = canStart ? '1' : '0.5';
    startBtn.textContent = canStart ? 'START MATCH' : 'WAITING FOR PEER…';
  } else { startBtn.classList.add('hidden'); }
  readyBtn.classList.toggle('hidden', inMatch);
  readyBtn.textContent = meReady ? 'NOT READY' : 'READY';
  roomHint.textContent = inMatch ? 'Match in progress' : remoteVisible ? 'Press START MATCH.' : 'Waiting for friend to join…';
}

async function attachChannel(code) {
  channel = new Net.RoomChannel(code, IR_USER.userId, selfName);
  channel.on('hello', () => { channel.send('peer', { name: selfName, irId: IR_USER.irId, char: myCharacter.id, isHost }); });
  channel.on('peer', ({ name, irId, char, isHost: peerIsHost }) => {
    remoteName = name || 'Peer'; remoteIrId = irId || '';
    if (peerIsHost) {
      const hostChar = CHARACTERS.find(c => c.id === char) || CHAR_BLUE;
      myCharacter = oppositeOf(hostChar); applyMyCharacter(); remoteChar = hostChar;
    } else { remoteChar = CHARACTERS.find(c => c.id === char) || CHAR_PINK; }
    remoteVisible = true; applyRemoteCharacter(); renderRoom();
    channel.send('peer', { name: selfName, irId: IR_USER.irId, char: myCharacter.id, isHost });
  });
  channel.on('ready', ({ ready }) => { peerReady = !!ready; renderRoom(); });
  channel.on('event_start', ({ event, mode, round }) => startCountdownThenMatch(() => startRound(event, mode, round)));
  channel.on('round_end', ({ sLocal, sRemote }) => {
    if (sLocal > sRemote) totalScoreRemote++; else if (sRemote > sLocal) totalScoreLocal++;
    updateScoreUI(); toast("ROUND OVER! 🍡");
  });
  channel.on('match_end', ({ totalLocal, totalRemote }) => endMatch(totalRemote, totalLocal));
  channel.on('move', ({ x, y, z, ry }) => {
    remoteTarget.x = Number(x) || 0; remoteTarget.y = Number(y) || 0;
    remoteTarget.z = Number(z) || 0; remoteTarget.ry = Number(ry) || 0;
    if (!remoteVisible) { remoteVisible = true; remotePlayer.group.visible = true; renderRoom(); }
  });
  channel.on('shoot', ({ x, y, z, ry }) => {
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshStandardMaterial({ color: '#ff0066', emissive: '#ff0066' }));
    heart.scale.set(1, 0.8, 0.4); heart.position.set(x, y, z); scene.add(heart);
    const dir = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
    projectiles.push({ mesh: heart, x, y, z, vx: dir.x * 15, vz: dir.z * 15, isLocal: false }); SFX.kiss();
  });
  channel.on('hit', () => {
    local.vy = 5.0; local.x -= 3.0; SFX.hit(); toast("💋 SMOOCHED!");
    camera.position.x += (Math.random() - 0.5) * 1.0; camera.position.y += (Math.random() - 0.5) * 1.0;
  });
  channel.on('collect', () => { scoreRemote++; });
  await channel.join();
}

async function doCreate() {
  createError.classList.add('hidden');
  const res = await Net.createRoom(IR_USER.userId, IR_USER.irId);
  if (!res.ok) return;
  selfName = IR_USER.name; roomCode = res.code; isHost = true; gameMode = selectedGameMode;
  try { await attachChannel(roomCode); applyMyCharacter(); showScreen('roomScreen'); renderRoom(); } catch (e) { createError.textContent = 'Connection failed.'; createError.classList.remove('hidden'); }
}

async function doJoin() {
  joinError.classList.add('hidden');
  const code = (codeInput.value || '').toUpperCase().trim();
  if (code.length < 4) return;
  const found = await Net.findRoom(code);
  if (!found.ok) { joinError.textContent = 'Room not found.'; joinError.classList.remove('hidden'); return; }
  selfName = IR_USER.name; roomCode = found.code; isHost = false; 
  try { await attachChannel(roomCode); applyMyCharacter(); showScreen('roomScreen'); renderRoom(); } catch (e) { joinError.textContent = 'Connection failed.'; joinError.classList.remove('hidden'); }
}

async function startCountdownThenMatch(onComplete) {
  for (const el of Object.values(screens)) el.classList.add('hidden');
  countdownOverlay.classList.remove('hidden');
  for (const n of ['3','2','1','GO!']) {
    countdownNumber.textContent = n; countdownNumber.style.animation = 'none';
    void countdownNumber.offsetWidth; countdownNumber.style.animation = 'countPulse .8s ease-out';
    await sleep(n === 'GO!' ? 500 : 800);
  }
  countdownOverlay.classList.add('hidden');
  onComplete();
}

startBtn.onclick = () => { if (!isHost) return; startMatch(); };

function updateLocalPlayer(dt) {
  if (!inMatch) return;
  let f = 0, s = 0;
  if (keys.has(settings.keys.up)) f += 1; if (keys.has(settings.keys.down)) f -= 1;
  if (keys.has(settings.keys.right)) s += 1; if (keys.has(settings.keys.left)) s -= 1;
  f -= touchDelta.y; s += touchDelta.x;
  const len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right   = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw));
  moveVec.set(0,0,0).addScaledVector(forward, f).addScaledVector(right, s);
  let speed = 5.4;
  if (currentEvent === 'PENGUIN') speed = 3.0; if (currentEvent === 'WOBBLY') speed = 6.5;
  let moveX = moveVec.x * speed * dt; let moveZ = moveVec.z * speed * dt;
  if (currentEvent === 'MAGNETIC' && remoteVisible) {
    const dx = remote.x - local.x; const dz = remote.z - local.z;
    const dist = Math.max(0.1, Math.hypot(dx, dz));
    if (dist > 2) { const pullStrength = 8.0 * dt; moveX += (dx / dist) * pullStrength; moveZ += (dz / dist) * pullStrength; }
  }
  let nextX = THREE.MathUtils.clamp(local.x + moveX, -12.3, 12.3);
  let nextZ = THREE.MathUtils.clamp(local.z + moveZ, -12.3, 12.3);
  for (const box of colliders) {
    if (nextX + local.radius > box.minX && nextX - local.radius < box.maxX && local.y + local.radius > box.minY && local.y + 1.5 < box.maxY && local.z + local.radius > box.minZ && local.z - local.radius < box.maxZ) {
      if (moveX > 0) nextX = box.minX - local.radius; else if (moveX < 0) nextX = box.maxX + local.radius;
    }
    if (nextX + local.radius > box.minX && nextX - local.radius < box.maxX && local.y + local.radius > box.minY && local.y + 1.5 < box.maxY && nextZ + local.radius > box.minZ && nextZ - local.radius < box.maxZ) {
      if (moveZ > 0) nextZ = box.minZ - local.radius; else if (moveZ < 0) nextZ = box.maxZ + local.radius;
    }
  }
  local.x = nextX; local.z = nextZ;
  if (moveX !== 0 || moveZ !== 0) local.ry = Math.atan2(moveX, moveZ);
  local.vy -= 18 * dt; local.y += local.vy * dt;
  if (local.y <= 0) { local.y = 0; local.vy = 0; local.grounded = true; }
  localPlayer.group.position.set(local.x, local.y, local.z); localPlayer.group.rotation.y = local.ry;
  if (currentEvent === 'PENGUIN') localPlayer.group.rotation.z = Math.sin(performance.now() * 0.01) * 0.2; else localPlayer.group.rotation.z = 0;
  if (gameMode === 'missions') {
    for (let i = sparklesList.length - 1; i >= 0; i--) {
      const sp = sparklesList[i];
      if (local.x > sp.position.x - 1 && local.x < sp.position.x + 1 && local.z > sp.position.z - 1 && local.z < sp.position.z + 1) {
        sparkles.remove(sp); sparklesList.splice(i, 1); scoreLocal++;
        SFX.collect(); channel.send('collect', {}); 
      }
    }
  }
  if (channel && performance.now() - lastMoveSent > 50) { lastMoveSent = performance.now(); channel.send('move', { x: local.x, y: local.y, z: local.z, ry: local.ry }); }
}

function updateRemotePlayer(dt) {
  if (!remoteVisible) return;
  const k = 1 - Math.exp(-dt * 12);
  remote.x += (remoteTarget.x - remote.x) * k; remote.z += (remoteTarget.z - remote.z) * k;
  remotePlayer.group.position.set(remote.x, remoteTarget.y, remote.z); remotePlayer.group.rotation.y = remoteTarget.ry;
  if (currentEvent === 'PENGUIN') remotePlayer.group.rotation.z = Math.sin(performance.now() * 0.01) * 0.2; else remotePlayer.group.rotation.z = 0;
  sparkles.children.forEach(s => { s.rotation.y += dt * 3; s.rotation.x += dt * 2; });
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]; p.x += p.vx * dt; p.z += p.vz * dt;
    p.mesh.position.set(p.x, p.y, p.z); p.mesh.rotation.y += dt * 5;
    if (p.isLocal && remoteVisible) {
      const dist = Math.hypot(p.x - remote.x, p.z - remote.z);
      if (dist < 1.0) { scene.remove(p.mesh); projectiles.splice(i, 1); channel.send('hit', {}); toast("HIT! 💋"); continue; }
    }
    if (Math.abs(p.x) > 15 || Math.abs(p.z) > 15) { scene.remove(p.mesh); projectiles.splice(i, 1); }
  }
}

function cameraFollow(dt) {
  const dist = settings.cameraDistance; const target = new THREE.Vector3(local.x, local.y + 1.1, local.z);
  const h = Math.cos(pitch) * dist; const off = new THREE.Vector3(Math.sin(yaw) * h, Math.sin(pitch) * dist + 2, Math.cos(yaw) * h);
  camera.position.lerp(target.clone().add(off), 1 - Math.exp(-dt * 5)); camera.lookAt(target);
}

function animate() {
  requestAnimationFrame(animate); const dt = Math.min(clock.getDelta(), 0.04);
  updateLocalPlayer(dt); updateRemotePlayer(dt); cameraFollow(dt); renderer.render(scene, camera);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let orientationRequested = false;
async function requestLandscape() {
  if (orientationRequested) return; orientationRequested = true;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    if (screen.orientation && typeof screen.orientation.lock === 'function') await screen.orientation.lock('landscape');
  } catch (err) {}
}
window.addEventListener('pointerdown', requestLandscape, { once: true });

function checkRespawn() {
  if (local.y < -5) { local.x = -3; local.y = 0; local.z = 3; local.vy = 0; SFX.splat(); toast("Whoops! Respawned! 🍡"); }
}

async function loadHistory() {
  histList.innerHTML = ''; histEmpty.classList.add('hidden');
  const res = await Net.loadMatchHistory(IR_USER.irId, 10);
  if (!res.ok || !res.matches.length) { histEmpty.classList.remove('hidden'); return; }
  for (const m of res.matches) {
    const item = document.createElement('div');
    item.className = 'hist-item ' + (m.won ? 'won' : 'lost');
    const date = new Date(m.played_at).toLocaleDateString();
    item.innerHTML = `<div class="hist-icon">${m.won ? '🏆' : '💔'}</div><div class="hist-info"><div class="hist-name">vs ${m.opponent_name || 'Player'}</div><div class="hist-score"><b>${m.score_self}</b> – <b>${m.score_opponent}</b> · ${date}</div></div>`;
    histList.appendChild(item);
  }
}

createBtn.onclick = doCreate;
joinBtn.onclick = doJoin;
leaveRoomBtn.onclick = async () => {
  if (channel) { await channel.leave(); channel = null; }
  if (isHost && roomCode) Net.deleteRoom(roomCode);
  roomCode = ''; isHost = false; inMatch = false; hideControls(); showScreen('mainMenu');
};
readyBtn.onclick = () => { meReady = !meReady; channel?.send('ready', { ready: meReady }); renderRoom(); };
copyCodeBtn.onclick = async () => { try { await navigator.clipboard.writeText(roomCode); toast('Copied!'); } catch { toast(roomCode); } };
rematchBtn.onclick = () => { if (isHost) startMatch(); else toast("Waiting for host to rematch..."); };
resultsLeaveBtn.onclick = () => { showScreen('roomScreen'); meReady = false; peerReady = false; renderRoom(); };

(async function main() {
  const loggedIn = await boot();
  if (loggedIn && IR_USER) {
    SETTINGS_KEY = 'mochi_settings_' + IR_USER.irId;
    settings = loadSettings(); buildCharGrid(); applyMyCharacter(); applyButtonLayout();
  }
  animate();
  setInterval(checkRespawn, 500); 
  setTimeout(() => {
    loading.classList.add('gone');
    setTimeout(() => loading.remove(), 400);
  }, 500);
})();
