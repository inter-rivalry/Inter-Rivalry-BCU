import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/* ==========================================
   INTER RIVALRY: RIVALS
   Phase 1 — FP / SP Stickman Prototype
   ========================================== */

const $ = (id) => document.getElementById(id);

const root = $("game-root");
const startScreen = $("start");
const pauseScreen = $("pause");
const hud = $("hud");
const mobileControls = $("mobile");

let running = false;
let paused = false;
let started = false;
let viewMode = "FP";

let health = 100;
let score = 0;
let ammo = 12;
const magazineSize = 12;

let yaw = 0;
let pitch = 0;
let verticalVelocity = 0;
let onGround = true;

let moveX = 0;
let moveY = 0;
let joyPointer = null;
let aimPointer = null;
let lastAimX = 0;
let lastAimY = 0;
let firing = false;

const clock = new THREE.Clock();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101b32);
scene.fog = new THREE.Fog(0x101b32, 35, 100);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  150
);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance"
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.style.touchAction = "none";
root.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xc8e4ff, 0x222c48, 2));

const sunlight = new THREE.DirectionalLight(0xffffff, 2.1);
sunlight.position.set(-10, 25, 12);
scene.add(sunlight);

const arenaMaterials = {
  floor: new THREE.MeshStandardMaterial({
    color: 0x202b43,
    roughness: 0.85
  }),
  wall: new THREE.MeshStandardMaterial({
    color: 0x34435f,
    roughness: 0.8
  }),
  blue: new THREE.MeshStandardMaterial({
    color: 0x21a9ff,
    roughness: 0.65
  }),
  red: new THREE.MeshStandardMaterial({
    color: 0xff405f,
    roughness: 0.65
  }),
  white: new THREE.MeshStandardMaterial({
    color: 0xeaf3ff,
    roughness: 0.7
  }),
  dark: new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.8
  }),
  gold: new THREE.MeshStandardMaterial({
    color: 0xffd166,
    roughness: 0.55
  })
};

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const sphereGeometry = new THREE.SphereGeometry(1, 12, 10);
const cylinderGeometry = new THREE.CylinderGeometry(
  0.08,
  0.1,
  1,
  8
);

const wallMeshes = [];
const targetMeshes = [];
const targets = [];

function makeBox(name, x, y, z, sx, sy, sz, material, isWall = false) {
  const mesh = new THREE.Mesh(boxGeometry, material);

  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  scene.add(mesh);

  if (isWall) {
    wallMeshes.push(mesh);
  }

  return mesh;
}

/* Arena floor */

makeBox(
  "arena-floor",
  0,
  -0.5,
  0,
  44,
  1,
  44,
  arenaMaterials.floor
);

/* Outer walls */

makeBox("north-wall", 0, 2, -22, 44, 4, 1, arenaMaterials.wall, true);
makeBox("south-wall", 0, 2, 22, 44, 4, 1, arenaMaterials.wall, true);
makeBox("west-wall", -22, 2, 0, 1, 4, 44, arenaMaterials.wall, true);
makeBox("east-wall", 22, 2, 0, 1, 4, 44, arenaMaterials.wall, true);

/* Internal cover walls */

makeBox("cover-1", -7, 1.5, -6, 8, 3, 1, arenaMaterials.blue, true);
makeBox("cover-2", 7, 1.5, 5, 8, 3, 1, arenaMaterials.red, true);
makeBox("cover-3", 0, 1, -13, 5, 2, 1, arenaMaterials.wall, true);
makeBox("cover-4", -13, 1, 9, 1, 2, 7, arenaMaterials.wall, true);
makeBox("cover-5", 13, 1, -9, 1, 2, 7, arenaMaterials.wall, true);
makeBox("cover-6", 0, 1, 13, 7, 2, 1, arenaMaterials.wall, true);

/* Floor markings */

for (let i = -18; i <= 18; i += 6) {
  makeBox(
    "floor-mark",
    i,
    0.015,
    0,
    0.045,
    0.02,
    40,
    new THREE.MeshBasicMaterial({
      color: 0x42506c
    })
  );
}

makeBox(
  "centre-mark",
  0,
  0.025,
  0,
  12,
  0.025,
  0.12,
  arenaMaterials.gold
);

/* ==========================================
   STICKMAN PLAYER
   ========================================== */

const player = new THREE.Group();
scene.add(player);

const body = new THREE.Group();
player.add(body);

function makePart(geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  body.add(mesh);
  return mesh;
}

const playerHead = makePart(
  sphereGeometry,
  arenaMaterials.white,
  0,
  1.65,
  0,
  0.23,
  0.23,
  0.23
);

const playerTorso = makePart(
  cylinderGeometry,
  arenaMaterials.blue,
  0,
  1.15,
  0,
  0.65,
  0.55,
  0.65
);

const playerArmLeft = makePart(
  cylinderGeometry,
  arenaMaterials.white,
  -0.29,
  1.17,
  -0.04,
  0.22,
  0.52,
  0.22
);

const playerArmRight = makePart(
  cylinderGeometry,
  arenaMaterials.white,
  0.29,
  1.17,
  -0.04,
  0.22,
  0.52,
  0.22
);

const playerLegLeft = makePart(
  cylinderGeometry,
  arenaMaterials.dark,
  -0.13,
  0.48,
  0,
  0.25,
  0.58,
  0.25
);

const playerLegRight = makePart(
  cylinderGeometry,
  arenaMaterials.dark,
  0.13,
  0.48,
  0,
  0.25,
  0.58,
  0.25
);

/* Simple weapon held in front of the body */

const weapon = makePart(
  boxGeometry,
  arenaMaterials.dark,
  0.27,
  1.12,
  -0.43,
  0.16,
  0.16,
  0.75
);

player.position.set(0, 0, 15);

/* First-person camera should not show the player's head. */

function setPlayerVisible(visible) {
  body.visible = visible;
}

/* ==========================================
   TARGETS
   ========================================== */

function createTarget(index) {
  const group = new THREE.Group();

  const color = index % 2 === 0
    ? arenaMaterials.red
    : arenaMaterials.gold;

  const targetBody = new THREE.Mesh(
    cylinderGeometry,
    color
  );

  targetBody.scale.set(0.7, 1.1, 0.7);
  targetBody.position.y = 0.85;
  group.add(targetBody);

  const targetHead = new THREE.Mesh(
    sphereGeometry,
    arenaMaterials.white
  );

  targetHead.scale.set(0.24, 0.24, 0.24);
  targetHead.position.y = 1.65;
  group.add(targetHead);

  const target = {
    group,
    baseX: 0,
    baseZ: 0,
    phase: Math.random() * Math.PI * 2,
    speed: 0.7 + Math.random() * 0.7,
    radius: 0.8,
    alive: true
  };

  group.userData.target = target;

  group.traverse((object) => {
    if (object.isMesh) {
      object.userData.target = target;
      targetMeshes.push(object);
    }
  });

  scene.add(group);
  targets.push(target);

  respawnTarget(target);

  return target;
}

function respawnTarget(target) {
  const spots = [
    [-16, -16],
    [-11, 15],
    [15, -15],
    [16, 15],
    [0, -17],
    [-17, 0],
    [17, 0],
    [0, 17],
    [-12, -13],
    [12, 13]
  ];

  let spot = spots[Math.floor(Math.random() * spots.length)];

  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = spots[Math.floor(Math.random() * spots.length)];

    const dx = candidate[0] - player.position.x;
    const dz = candidate[1] - player.position.z;

    if (Math.hypot(dx, dz) > 7) {
      spot = candidate;
      break;
    }
  }

  target.baseX = spot[0];
  target.baseZ = spot[1];

  target.group.position.set(
    target.baseX,
    0,
    target.baseZ
  );

  target.alive = true;
  target.group.visible = true;
}

for (let i = 0; i < 8; i++) {
  createTarget(i);
}

/* ==========================================
   CAMERA
   ========================================== */

const cameraOffset = new THREE.Vector3();
const lookDirection = new THREE.Vector3();
const playerEye = new THREE.Vector3();

function updateCamera() {
  const direction = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  );

  lookDirection.copy(direction);

  playerEye.set(
    player.position.x,
    player.position.y + 1.55,
    player.position.z
  );

  if (viewMode === "FP") {
    camera.position.copy(playerEye);
    camera.lookAt(
      playerEye.x + direction.x * 10,
      playerEye.y + direction.y * 10,
      playerEye.z + direction.z * 10
    );

    setPlayerVisible(false);
  } else {
    const back = new THREE.Vector3(
      -Math.sin(yaw) * 4.5,
      2.3,
      Math.cos(yaw) * 4.5
    );

    cameraOffset.copy(player.position).add(back);

    camera.position.lerp(cameraOffset, 0.25);
    camera.lookAt(
      player.position.x,
      player.position.y + 1.25,
      player.position.z
    );

    setPlayerVisible(true);
  }
}

function switchView() {
  viewMode = viewMode === "FP" ? "SP" : "FP";
  $("view-btn").textContent = viewMode;
  updateCamera();
  showToast(
    viewMode === "FP"
      ? "FIRST PERSON"
      : "THIRD PERSON"
  );
}

$("view-btn").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  switchView();
});

/* ==========================================
   HUD
   ========================================== */

function updateHUD() {
  $("health").textContent = Math.max(0, Math.ceil(health));
  $("healthbar").style.width = `${Math.max(0, health)}%`;
  $("ammo").innerHTML = `${ammo} <em>/ ${magazineSize}</em>`;
  $("score").textContent = score;
  $("count").textContent = targets.filter(t => t.alive).length;
  $("pause-score").textContent = score;
}

let toastTimer;

function showToast(message) {
  $("toast").textContent = message;

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    $("toast").textContent = "";
  }, 1200);
}

function showHit() {
  const hit = $("hit");
  hit.classList.add("show");

  setTimeout(() => {
    hit.classList.remove("show");
  }, 120);
}

/* ==========================================
   MOVEMENT
   ========================================== */

const moveVector = new THREE.Vector3();

function movePlayer(delta) {
  const forward = new THREE.Vector3(
    Math.sin(yaw),
    0,
    -Math.cos(yaw)
  );

  const right = new THREE.Vector3(
    Math.cos(yaw),
    0,
    Math.sin(yaw)
  );

  moveVector.set(0, 0, 0);

  moveVector.addScaledVector(forward, -moveY);
  moveVector.addScaledVector(right, moveX);

  if (moveVector.lengthSq() > 1) {
    moveVector.normalize();
  }

  const speed = 6 * delta;

  const oldX = player.position.x;
  const oldZ = player.position.z;

  player.position.x += moveVector.x * speed;
  player.position.z += moveVector.z * speed;

  player.position.x = THREE.MathUtils.clamp(
    player.position.x,
    -20,
    20
  );

  player.position.z = THREE.MathUtils.clamp(
    player.position.z,
    -20,
    20
  );

  /* Simple player collision against walls. */

  const playerBox = new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(
      player.position.x,
      0.9,
      player.position.z
    ),
    new THREE.Vector3(0.7, 1.8, 0.7)
  );

  for (const wall of wallMeshes) {
    const wallBox = new THREE.Box3().setFromObject(wall);

    if (playerBox.intersectsBox(wallBox)) {
      player.position.x = oldX;
      player.position.z = oldZ;
      break;
    }
  }

  const moving = moveVector.lengthSq() > 0.01;

  if (moving) {
    const animation = performance.now() * 0.012;

    playerLegLeft.rotation.x = Math.sin(animation) * 0.65;
    playerLegRight.rotation.x = -Math.sin(animation) * 0.65;

    playerArmLeft.rotation.x = -Math.sin(animation) * 0.45;
    playerArmRight.rotation.x = Math.sin(animation) * 0.45;
  } else {
    playerLegLeft.rotation.x *= 0.8;
    playerLegRight.rotation.x *= 0.8;
    playerArmLeft.rotation.x *= 0.8;
    playerArmRight.rotation.x *= 0.8;
  }

  if (verticalVelocity !== 0 || !onGround) {
    player.position.y += verticalVelocity * delta;
    verticalVelocity -= 18 * delta;

    if (player.position.y <= 0) {
      player.position.y = 0;
      verticalVelocity = 0;
      onGround = true;
    }
  }
}

function jump() {
  if (!onGround || !running || paused) return;

  verticalVelocity = 7.5;
  onGround = false;
}

/* ==========================================
   SHOOTING AND WALL BLOCKING
   ========================================== */

const raycaster = new THREE.Raycaster();

function shoot() {
  if (!running || paused) return;

  if (ammo <= 0) {
    showToast("OUT OF AMMO — RELOAD");
    return;
  }

  ammo--;
  updateHUD();

  raycaster.setFromCamera(
    new THREE.Vector2(0, 0),
    camera
  );

  const targetHits = raycaster.intersectObjects(
    targetMeshes.filter(mesh => {
      const target = mesh.userData.target;
      return target && target.alive && target.group.visible;
    }),
    false
  );

  const wallHits = raycaster.intersectObjects(
    wallMeshes,
    false
  );

  const nearestTarget = targetHits[0];
  const nearestWall = wallHits[0];

  /* A wall in front of the target blocks the shot. */

  if (
    nearestTarget &&
    (
      !nearestWall ||
      nearestTarget.distance < nearestWall.distance
    )
  ) {
    const target = nearestTarget.object.userData.target;

    if (target && target.alive) {
      target.alive = false;
      target.group.visible = false;

      score++;
      showHit();

      setTimeout(() => {
        respawnTarget(target);
        updateHUD();
      }, 1200);
    }
  }

  updateHUD();
}

let reloadTimeout = null;

function reload() {
  if (!running || paused) return;

  if (ammo === magazineSize) {
    showToast("AMMO FULL");
    return;
  }

  if (reloadTimeout) return;

  showToast("RELOADING...");

  reloadTimeout = setTimeout(() => {
    ammo = magazineSize;
    reloadTimeout = null;

    updateHUD();
    showToast("RELOADED");
  }, 1000);
}

/* ==========================================
   KEYBOARD
   ========================================== */

const keys = new Set();

window.addEventListener("keydown", (event) => {
  keys.add(event.code);

  if (
    ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)
  ) {
    event.preventDefault();
  }

  if (event.code === "KeyR") reload();
  if (event.code === "Space") jump();

  if (event.code === "Escape" && running) {
    pauseGame();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

renderer.domElement.addEventListener("click", () => {
  if (!running || paused) return;

  if (viewMode === "FP" && !isTouchDevice()) {
    renderer.domElement.requestPointerLock?.();
  }

  if (document.pointerLockElement === renderer.domElement) {
    shoot();
  }
});

document.addEventListener("mousemove", (event) => {
  if (!running || paused) return;

  if (document.pointerLockElement === renderer.domElement) {
    yaw -= event.movementX * 0.0025;
    pitch -= event.movementY * 0.0025;

    pitch = THREE.MathUtils.clamp(
      pitch,
      -1.15,
      1.15
    );
  }
});

/* ==========================================
   MOBILE JOYSTICK
   ========================================== */

function isTouchDevice() {
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0
  );
}

const joyZone = $("joy-zone");
const joyBase = $("joy-base");
const joyKnob = $("joy-knob");

joyZone.addEventListener("pointerdown", (event) => {
  if (!running || paused) return;

  joyPointer = event.pointerId;

  joyZone.setPointerCapture?.(event.pointerId);
  updateJoystick(event);
});

joyZone.addEventListener("pointermove", (event) => {
  if (event.pointerId !== joyPointer) return;
  updateJoystick(event);
});

function updateJoystick(event) {
  const rect = joyBase.getBoundingClientRect();

  const centreX = rect.left + rect.width / 2;
  const centreY = rect.top + rect.height / 2;

  const dx = event.clientX - centreX;
  const dy = event.clientY - centreY;

  const maxDistance = rect.width * 0.36;
  const distance = Math.hypot(dx, dy);
  const scale = distance > maxDistance
    ? maxDistance / distance
    : 1;

  const clampedX = dx * scale;
  const clampedY = dy * scale;

  joyKnob.style.transform =
    `translate(${clampedX}px, ${clampedY}px)`;

  moveX = clampedX / maxDistance;
  moveY = clampedY / maxDistance;
}

function releaseJoystick(event) {
  if (event.pointerId !== joyPointer) return;

  joyPointer = null;
  moveX = 0;
  moveY = 0;
  joyKnob.style.transform = "translate(0,0)";
}

joyZone.addEventListener("pointerup", releaseJoystick);
joyZone.addEventListener("pointercancel", releaseJoystick);

/* ==========================================
   MOBILE AIM
   ========================================== */

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (!running || paused || !isTouchDevice()) return;

  if (event.clientX < window.innerWidth * 0.45) return;

  aimPointer = event.pointerId;
  lastAimX = event.clientX;
  lastAimY = event.clientY;
});

renderer.domElement.addEventListener("pointermove", (event) => {
  if (event.pointerId !== aimPointer) return;

  const dx = event.clientX - lastAimX;
  const dy = event.clientY - lastAimY;

  yaw -= dx * 0.006;
  pitch -= dy * 0.006;

  pitch = THREE.MathUtils.clamp(
    pitch,
    -1.15,
    1.15
  );

  lastAimX = event.clientX;
  lastAimY = event.clientY;
});

function releaseAim(event) {
  if (event.pointerId === aimPointer) {
    aimPointer = null;
  }
}

renderer.domElement.addEventListener("pointerup", releaseAim);
renderer.domElement.addEventListener("pointercancel", releaseAim);

/* ==========================================
   MOBILE ACTION BUTTONS
   ========================================== */

function addHoldButton(button, action) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!running || paused) return;

    action();
  });
}

addHoldButton($("fire-btn"), shoot);
addHoldButton($("jump-btn"), jump);
addHoldButton($("reload-btn"), reload);

/* ==========================================
   GAME FLOW
   ========================================== */

async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
    }
  } catch (_) {
    /* Fullscreen isn't available in every browser. */
  }

  try {
    await screen.orientation?.lock?.("landscape");
  } catch (_) {
    /* Some mobile browsers only permit manual rotation. */
  }
}

function startGame() {
  started = true;
  running = true;
  paused = false;

  health = 100;
  score = 0;
  ammo = magazineSize;
  yaw = 0;
  pitch = 0;

  player.position.set(0, 0, 15);

  targets.forEach(respawnTarget);

  startScreen.classList.add("hidden");
  pauseScreen.classList.add("hidden");
  hud.classList.remove("hidden");

  mobileControls.classList.toggle(
    "hidden",
    !isTouchDevice()
  );

  enterFullscreen();
  updateCamera();
  updateHUD();

  clock.getDelta();
}

function pauseGame() {
  if (!running) return;

  paused = true;
  pauseScreen.classList.remove("hidden");
  $("pause-score").textContent = score;

  document.exitPointerLock?.();
}

function resumeGame() {
  paused = false;
  pauseScreen.classList.add("hidden");
  clock.getDelta();
}

function restartGame() {
  if (reloadTimeout) {
    clearTimeout(reloadTimeout);
    reloadTimeout = null;
  }

  startGame();
}

$("start-btn").addEventListener("click", startGame);
$("pause-btn").addEventListener("click", pauseGame);
$("resume-btn").addEventListener("click", resumeGame);
$("restart-btn").addEventListener("click", restartGame);

/* ==========================================
   RESIZE AND RENDER
   ========================================== */

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
}

window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => {
  setTimeout(resize, 250);
});

function updateTargets(delta, elapsed) {
  for (const target of targets) {
    if (!target.alive) continue;

    target.group.position.x =
      target.baseX + Math.sin(elapsed * target.speed + target.phase) * 1.1;

    target.group.position.z =
      target.baseZ + Math.cos(elapsed * target.speed * 0.7 + target.phase) * 0.7;

    target.group.rotation.y =
      Math.sin(elapsed * target.speed) * 0.15;
  }
}

function updateKeyboardMovement() {
  moveX = 0;
  moveY = 0;

  if (keys.has("KeyA") || keys.has("ArrowLeft")) moveX -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) moveX += 1;

  if (keys.has("KeyW") || keys.has("ArrowUp")) moveY -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) moveY += 1;
}

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  if (running && !paused) {
    if (!isTouchDevice()) {
      updateKeyboardMovement();
    }

    movePlayer(delta);
    updateTargets(delta, elapsed);
    updateCamera();
  }

  renderer.render(scene, camera);
}

updateHUD();
resize();
updateCamera();
animate();
