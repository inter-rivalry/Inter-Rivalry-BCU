import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/* =========================================================
   INTER RIVALRY: RIVALS
   Browser FPS prototype
   ========================================================= */

const $ = (id) => document.getElementById(id);

const gameRoot = $("game-root");
const startScreen = $("start");
const startButton = $("start-btn");
const pauseScreen = $("pause");
const resumeButton = $("resume-btn");
const restartButton = $("restart-btn");

const healthText = $("health");
const healthBar = $("healthbar");
const ammoText = $("ammo");
const scoreText = $("score");
const countText = $("count");

const viewButton = $("view-btn");
const pauseButton = $("pause-btn");
const crosshair = $("crosshair");
const hitIndicator = $("hit");
const toast = $("toast");

const mobileControls = $("mobile");
const joyZone = $("joy-zone");
const joyBase = $("joy-base");
const joyKnob = $("joy-knob");
const fireButton = $("fire-btn");
const jumpButton = $("jump-btn");
const reloadButton = $("reload-btn");

if (!gameRoot) {
    throw new Error("INTER RIVALRY RIVALS: #game-root was not found.");
}

/* =========================================================
   RENDERER
   ========================================================= */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10172b);
scene.fog = new THREE.Fog(0x10172b, 32, 95);

const camera = new THREE.PerspectiveCamera(
    75,
    gameRoot.clientWidth / Math.max(gameRoot.clientHeight, 1),
    0.1,
    150
);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance"
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(gameRoot.clientWidth, gameRoot.clientHeight);
renderer.shadowMap.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;

gameRoot.appendChild(renderer.domElement);

renderer.domElement.style.position = "absolute";
renderer.domElement.style.inset = "0";
renderer.domElement.style.width = "100%";
renderer.domElement.style.height = "100%";
renderer.domElement.style.touchAction = "none";

/* =========================================================
   LIGHTING
   ========================================================= */

scene.add(new THREE.HemisphereLight(0xc9ddff, 0x263047, 2.1));

const mainLight = new THREE.DirectionalLight(0xffffff, 2.2);
mainLight.position.set(12, 22, 8);
scene.add(mainLight);

const blueLight = new THREE.PointLight(0x176bff, 28, 32);
blueLight.position.set(-12, 6, -10);
scene.add(blueLight);

const redLight = new THREE.PointLight(0xff193d, 28, 32);
redLight.position.set(12, 6, 10);
scene.add(redLight);

/* =========================================================
   MATERIALS
   ========================================================= */

const materials = {
    floor: new THREE.MeshStandardMaterial({
        color: 0x202b40,
        roughness: 0.85
    }),

    wallBlue: new THREE.MeshStandardMaterial({
        color: 0x075cff,
        roughness: 0.65,
        emissive: 0x031c61,
        emissiveIntensity: 0.45
    }),

    wallRed: new THREE.MeshStandardMaterial({
        color: 0xf01c42,
        roughness: 0.65,
        emissive: 0x5b0718,
        emissiveIntensity: 0.45
    }),

    wallDark: new THREE.MeshStandardMaterial({
        color: 0x37445d,
        roughness: 0.8
    }),

    trimBlue: new THREE.MeshStandardMaterial({
        color: 0x24a9ff,
        emissive: 0x0879ff,
        emissiveIntensity: 1
    }),

    trimRed: new THREE.MeshStandardMaterial({
        color: 0xff4660,
        emissive: 0xff102f,
        emissiveIntensity: 1
    }),

    playerBody: new THREE.MeshStandardMaterial({
        color: 0x178cff,
        roughness: 0.55
    }),

    playerDark: new THREE.MeshStandardMaterial({
        color: 0x17283e,
        roughness: 0.7
    }),

    enemyBody: new THREE.MeshStandardMaterial({
        color: 0xff263f,
        roughness: 0.55,
        emissive: 0x51000c,
        emissiveIntensity: 0.25
    }),

    enemyDark: new THREE.MeshStandardMaterial({
        color: 0x401c2b,
        roughness: 0.75
    }),

    skin: new THREE.MeshStandardMaterial({
        color: 0xc7d2e1,
        roughness: 0.7
    }),

    gun: new THREE.MeshStandardMaterial({
        color: 0x111722,
        metalness: 0.5,
        roughness: 0.45
    }),

    grid: new THREE.LineBasicMaterial({
        color: 0x4d6388,
        transparent: true,
        opacity: 0.35
    })
};

/* =========================================================
   ARENA
   ========================================================= */

const arenaSize = 44;
const halfArena = arenaSize / 2;

const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(arenaSize, arenaSize),
    materials.floor
);

floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
scene.add(floor);

// Floor grid.
const grid = new THREE.GridHelper(arenaSize, 44, 0x28558e, 0x35445f);
grid.position.y = 0.015;
scene.add(grid);

// Decorative glowing floor lines.
function addFloorLine(x1, z1, x2, z2, color) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x1, 0.035, z1),
        new THREE.Vector3(x2, 0.035, z2)
    ]);

    const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.9
        })
    );

    scene.add(line);
}

addFloorLine(-20, -20, 20, -20, 0x087dff);
addFloorLine(-20, 20, 20, 20, 0xff2145);
addFloorLine(-20, -20, -20, 20, 0x087dff);
addFloorLine(20, -20, 20, 20, 0xff2145);

const wallMeshes = [];
const wallBoxes = [];
const arenaDecorations = [];

function addWall(x, z, width, depth, height, material) {
    const wall = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        material
    );

    wall.position.set(x, height / 2, z);
    wall.userData.isArenaWall = true;

    scene.add(wall);

    wallMeshes.push(wall);
    wallBoxes.push(new THREE.Box3());

    return wall;
}

function addTrim(x, z, width, depth, color) {
    const trim = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.13, depth),
        color
    );

    trim.position.set(x, 0.12, z);
    scene.add(trim);
    arenaDecorations.push(trim);
}

// Outer walls.
addWall(0, -halfArena, arenaSize, 0.8, 3.4, materials.wallBlue);
addWall(0, halfArena, arenaSize, 0.8, 3.4, materials.wallRed);
addWall(-halfArena, 0, 0.8, arenaSize, 3.4, materials.wallBlue);
addWall(halfArena, 0, 0.8, arenaSize, 3.4, materials.wallRed);

// Arena colour strips.
addTrim(0, -halfArena + 0.5, arenaSize - 1, 0.15, materials.trimBlue);
addTrim(0, halfArena - 0.5, arenaSize - 1, 0.15, materials.trimRed);
addTrim(-halfArena + 0.5, 0, 0.15, arenaSize - 1, materials.trimBlue);
addTrim(halfArena - 0.5, 0, 0.15, arenaSize - 1, materials.trimRed);

// Main cover walls.
addWall(-11, -9, 8, 1.1, 2.8, materials.wallBlue);
addWall(10, -9, 8, 1.1, 2.8, materials.wallRed);

addWall(-10, 8, 1.1, 9, 2.8, materials.wallBlue);
addWall(10, 8, 1.1, 9, 2.8, materials.wallRed);

addWall(0, -12, 9, 1.1, 2.6, materials.wallRed);
addWall(0, 12, 9, 1.1, 2.6, materials.wallBlue);

// Middle cover.
addWall(-5, -1, 4.5, 1.0, 2.5, materials.wallRed);
addWall(5, 1, 4.5, 1.0, 2.5, materials.wallBlue);

addWall(-1, -5, 1.0, 4.2, 2.5, materials.wallBlue);
addWall(1, 5, 1.0, 4.2, 2.5, materials.wallRed);

// Small cover blocks.
addWall(-15, 1, 3.0, 2.4, 1.8, materials.wallDark);
addWall(15, -1, 3.0, 2.4, 1.8, materials.wallDark);

addWall(-14, -15, 3.0, 2.0, 2.0, materials.wallRed);
addWall(14, 15, 3.0, 2.0, 2.0, materials.wallBlue);

addWall(-6, 16, 4.0, 2.0, 1.8, materials.wallBlue);
addWall(6, -16, 4.0, 2.0, 1.8, materials.wallRed);

// Decorative towers that do not block the central fighting lanes.
function addTower(x, z, material) {
    const tower = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 4.5, 1.2),
        material
    );

    tower.position.set(x, 2.25, z);
    scene.add(tower);

    const cap = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.18, 1.6),
        material === materials.wallBlue
            ? materials.trimBlue
            : materials.trimRed
    );

    cap.position.set(x, 4.55, z);
    scene.add(cap);

    arenaDecorations.push(tower, cap);
}

addTower(-19, -19, materials.wallBlue);
addTower(19, -19, materials.wallRed);
addTower(-19, 19, materials.wallBlue);
addTower(19, 19, materials.wallRed);

/* =========================================================
   PLAYER
   ========================================================= */

const player = {
    position: new THREE.Vector3(0, 0, 17),
    radius: 0.48,
    height: 1.85,
    speed: 6.5,
    health: 100,
    ammo: 30,
    maxAmmo: 30,
    yaw: Math.PI,
    pitch: 0,
    velocityY: 0,
    grounded: true
};

let started = false;
let paused = false;
let gameOver = false;
let viewMode = "FP";

let score = 0;
let shotsFired = 0;
let hits = 0;
let reloading = false;
let reloadTimer = 0;
let fireCooldown = 0;
let damageCooldown = 0;

const gravity = 18;
const jumpPower = 7.1;

const moveInput = {
    forward: 0,
    right: 0
};

const keys = Object.create(null);

const playerGroup = new THREE.Group();
scene.add(playerGroup);

// Boxy human-like player character.
function createHumanoid(isEnemy = false) {
    const group = new THREE.Group();

    const bodyMaterial = isEnemy ? materials.enemyBody : materials.playerBody;
    const darkMaterial = isEnemy ? materials.enemyDark : materials.playerDark;

    function box(w, h, d, material, x, y, z) {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            material
        );

        mesh.position.set(x, y, z);
        group.add(mesh);
        return mesh;
    }

    // Head.
    const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.38, 0.38),
        materials.skin
    );

    head.position.set(0, 1.62, 0);
    group.add(head);

    // Neck.
    box(0.16, 0.12, 0.16, darkMaterial, 0, 1.40, 0);

    // Wide torso.
    box(0.64, 0.65, 0.34, bodyMaterial, 0, 1.00, 0);

    // Shoulder plates.
    box(0.78, 0.19, 0.39, darkMaterial, 0, 1.25, 0);

    // Arms.
    const leftArm = box(
        0.19, 0.53, 0.23,
        darkMaterial, -0.43, 0.94, 0
    );

    const rightArm = box(
        0.19, 0.53, 0.23,
        darkMaterial, 0.43, 0.94, 0
    );

    leftArm.rotation.z = -0.08;
    rightArm.rotation.z = 0.08;

    // Legs.
    box(0.25, 0.56, 0.28, darkMaterial, -0.18, 0.40, 0);
    box(0.25, 0.56, 0.28, darkMaterial, 0.18, 0.40, 0);

    // Boots.
    box(0.29, 0.15, 0.40, materials.gun, -0.18, 0.10, -0.04);
    box(0.29, 0.15, 0.40, materials.gun, 0.18, 0.10, -0.04);

    // Weapon on the front-right side.
    const weapon = box(
        0.13, 0.15, 0.70,
        materials.gun, 0.30, 1.03, -0.36
    );

    weapon.rotation.x = -0.04;

    // Bright team marking.
    const stripeMaterial = isEnemy
        ? materials.trimRed
        : materials.trimBlue;

    box(0.67, 0.09, 0.37, stripeMaterial, 0, 1.12, -0.01);

    group.userData.hitMeshes = [];
    group.traverse((object) => {
        if (object.isMesh) {
            object.userData.humanoid = group;
            group.userData.hitMeshes.push(object);
        }
    });

    return group;
}

const playerModel = createHumanoid(false);
playerModel.position.set(0, 0, 0);
playerGroup.add(playerModel);

/* =========================================================
   ENEMIES
   ========================================================= */

const enemies = [];
const enemyHitMeshes = [];

const enemySpawns = [
    [-16, -15],
    [-7, -16],
    [7, -15],
    [16, -14],
    [-16, 5],
    [16, 6],
    [-7, 16],
    [7, 16]
];

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function createEnemy(index) {
    const model = createHumanoid(true);
    const spawn = enemySpawns[index % enemySpawns.length];

    model.position.set(spawn[0], 0, spawn[1]);
    scene.add(model);

    const enemy = {
        model,
        health: 100,
        alive: true,
        speed: randomBetween(0.45, 0.9),
        directionTimer: randomBetween(1.5, 4),
        direction: new THREE.Vector3(
            randomBetween(-1, 1),
            0,
            randomBetween(-1, 1)
        ),
        fireTimer: randomBetween(1.5, 3.2),
        spawnX: spawn[0],
        spawnZ: spawn[1],
        phase: Math.random() * Math.PI * 2
    };

    enemy.direction.normalize();

    model.userData.enemy = enemy;

    for (const mesh of model.userData.hitMeshes) {
        mesh.userData.enemy = enemy;
        enemyHitMeshes.push(mesh);
    }

    enemies.push(enemy);
}

for (let i = 0; i < 8; i++) {
    createEnemy(i);
}

/* =========================================================
   HUD AND AIM LOCK CIRCLE
   ========================================================= */

// Create the lock circle automatically so HTML changes are unnecessary.
const lockCircle = document.createElement("div");
lockCircle.id = "lock-circle";

Object.assign(lockCircle.style, {
    position: "absolute",
    width: "54px",
    height: "54px",
    border: "3px solid #ff1738",
    borderRadius: "50%",
    boxSizing: "border-box",
    pointerEvents: "none",
    display: "none",
    zIndex: "25",
    transform: "translate(-50%, -50%)",
    boxShadow: "0 0 8px #ff1738, inset 0 0 8px #ff1738"
});

const lockDot = document.createElement("div");

Object.assign(lockDot.style, {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: "#ff1738",
    transform: "translate(-50%, -50%)"
});

lockCircle.appendChild(lockDot);

gameRoot.appendChild(lockCircle);

const lockLabel = document.createElement("div");

Object.assign(lockLabel.style, {
    position: "absolute",
    left: "50%",
    top: "-18px",
    transform: "translateX(-50%)",
    color: "#ff304c",
    fontFamily: "Arial, sans-serif",
    fontSize: "10px",
    fontWeight: "900",
    whiteSpace: "nowrap",
    textShadow: "0 0 5px #000"
});

lockLabel.textContent = "TARGET LOCK";
lockCircle.appendChild(lockLabel);

// Small aiming reticle.
if (crosshair) {
    crosshair.style.pointerEvents = "none";
}

let lockedEnemy = null;

const raycaster = new THREE.Raycaster();
raycaster.far = 80;

const centerPoint = new THREE.Vector2(0, 0);

function getCameraForward() {
    const direction = new THREE.Vector3();

    camera.getWorldDirection(direction);

    return direction.normalize();
}

function getEnemyAimPoint(enemy) {
    return new THREE.Vector3(
        enemy.model.position.x,
        1.35,
        enemy.model.position.z
    );
}

function isEnemyVisible(enemy) {
    if (!enemy || !enemy.alive) return false;

    const origin = camera.position.clone();
    const target = getEnemyAimPoint(enemy);
    const difference = target.clone().sub(origin);
    const distance = difference.length();

    if (distance <= 0.1) return false;

    const direction = difference.normalize();

    raycaster.set(origin, direction);
    raycaster.far = distance;

    const wallHits = raycaster.intersectObjects(wallMeshes, false);

    if (wallHits.length > 0 && wallHits[0].distance < distance - 0.15) {
        return false;
    }

    return true;
}

function acquireTarget() {
    const forward = getCameraForward();

    let bestEnemy = null;
    let bestAngle = Infinity;

    // Retain the current target if it is still visible and nearby.
    if (lockedEnemy && lockedEnemy.alive && isEnemyVisible(lockedEnemy)) {
        const targetPoint = getEnemyAimPoint(lockedEnemy);
        const direction = targetPoint.sub(camera.position).normalize();
        const angle = forward.angleTo(direction);

        if (angle < THREE.MathUtils.degToRad(16)) {
            bestEnemy = lockedEnemy;
            bestAngle = angle;
        }
    }

    for (const enemy of enemies) {
        if (!enemy.alive) continue;
        if (!isEnemyVisible(enemy)) continue;

        const targetPoint = getEnemyAimPoint(enemy);
        const direction = targetPoint.sub(camera.position).normalize();
        const angle = forward.angleTo(direction);

        // Aim-assist acquisition cone.
        if (angle > THREE.MathUtils.degToRad(12)) continue;

        if (angle < bestAngle) {
            bestAngle = angle;
            bestEnemy = enemy;
        }
    }

    lockedEnemy = bestEnemy;

    return lockedEnemy;
}

function updateLockCircle() {
    const target = acquireTarget();

    if (!target) {
        lockCircle.style.display = "none";
        return;
    }

    const point = getEnemyAimPoint(target);
    const projected = point.clone().project(camera);

    if (
        projected.z < -1 ||
        projected.z > 1 ||
        Math.abs(projected.x) > 1.15 ||
        Math.abs(projected.y) > 1.15
    ) {
        lockCircle.style.display = "none";
        return;
    }

    const rect = renderer.domElement.getBoundingClientRect();

    const x = (projected.x * 0.5 + 0.5) * rect.width;
    const y = (-projected.y * 0.5 + 0.5) * rect.height;

    lockCircle.style.left = `${x}px`;
    lockCircle.style.top = `${y}px`;
    lockCircle.style.display = "block";
}

/* =========================================================
   COLLISION
   ========================================================= */

const playerBox = new THREE.Box3();
const tempBox = new THREE.Box3();

function refreshWallBoxes() {
    for (let i = 0; i < wallMeshes.length; i++) {
        wallBoxes[i].setFromObject(wallMeshes[i]);
    }
}

refreshWallBoxes();

function playerCollidesAt(x, z) {
    const radius = player.radius;
    const minY = 0.05;
    const maxY = player.height;

    playerBox.min.set(x - radius, minY, z - radius);
    playerBox.max.set(x + radius, maxY, z + radius);

    for (let i = 0; i < wallBoxes.length; i++) {
        const box = wallBoxes[i];

        if (playerBox.intersectsBox(box)) {
            return true;
        }
    }

    return false;
}

function movePlayerWithCollision(dx, dz) {
    const nextX = player.position.x + dx;
    const nextZ = player.position.z + dz;

    // Resolve each axis separately so the player can slide along walls.
    if (!playerCollidesAt(nextX, player.position.z)) {
        player.position.x = nextX;
    }

    if (!playerCollidesAt(player.position.x, nextZ)) {
        player.position.z = nextZ;
    }

    player.position.x = THREE.MathUtils.clamp(
        player.position.x,
        -halfArena + 1.0,
        halfArena - 1.0
    );

    player.position.z = THREE.MathUtils.clamp(
        player.position.z,
        -halfArena + 1.0,
        halfArena - 1.0
    );
}

function enemyCollidesAt(x, z, radius = 0.42) {
    tempBox.min.set(x - radius, 0.05, z - radius);
    tempBox.max.set(x + radius, 1.85, z + radius);

    for (const box of wallBoxes) {
        if (tempBox.intersectsBox(box)) {
            return true;
        }
    }

    return false;
}

/* =========================================================
   CAMERA
   ========================================================= */

function updateCamera() {
    const eyeHeight = 1.58;

    const forward = new THREE.Vector3(
        -Math.sin(player.yaw) * Math.cos(player.pitch),
        Math.sin(player.pitch),
        -Math.cos(player.yaw) * Math.cos(player.pitch)
    ).normalize();

    if (viewMode === "FP") {
        camera.position.set(
            player.position.x,
            player.position.y + eyeHeight,
            player.position.z
        );

        camera.lookAt(
            camera.position.clone().add(forward)
        );
    } else {
        const behind = new THREE.Vector3(
            Math.sin(player.yaw) * 4.3,
            2.6,
            Math.cos(player.yaw) * 4.3
        );

        camera.position.set(
            player.position.x + behind.x,
            player.position.y + behind.y,
            player.position.z + behind.z
        );

        const lookTarget = new THREE.Vector3(
            player.position.x + forward.x * 3,
            player.position.y + 1.25 + forward.y * 2,
            player.position.z + forward.z * 3
        );

        camera.lookAt(lookTarget);
    }
}

function updatePlayerModel() {
    playerGroup.position.set(
        player.position.x,
        player.position.y,
        player.position.z
    );

    playerModel.rotation.y = player.yaw;

    // Hide the player's body in first-person view.
    playerModel.visible = viewMode === "SP";
}

function switchView() {
    viewMode = viewMode === "FP" ? "SP" : "FP";

    if (viewButton) {
        viewButton.textContent = viewMode === "FP" ? "FP / SP" : "SP / FP";
    }

    updateCamera();
    updatePlayerModel();

    showToast(viewMode === "FP" ? "FIRST PERSON" : "THIRD PERSON");
}

/* =========================================================
   SHOOTING AND AIM ASSIST
   ========================================================= */

function showHit() {
    if (!hitIndicator) return;

    hitIndicator.style.display = "block";
    hitIndicator.style.opacity = "1";

    setTimeout(() => {
        hitIndicator.style.opacity = "0";
    }, 100);

    setTimeout(() => {
        hitIndicator.style.display = "none";
    }, 200);
}

function showToast(message) {
    if (!toast) return;

    toast.textContent = message;
    toast.style.display = "block";
    toast.style.opacity = "1";

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(() => {
        toast.style.opacity = "0";

        setTimeout(() => {
            toast.style.display = "none";
        }, 200);
    }, 900);
}

function updateHUD() {
    if (healthText) {
        healthText.textContent = Math.max(0, Math.ceil(player.health));
    }

    if (healthBar) {
        healthBar.style.width = `${Math.max(0, player.health)}%`;
    }

    if (ammoText) {
        ammoText.textContent = reloading
            ? "RELOADING"
            : `${player.ammo} / ${player.maxAmmo}`;
    }

    if (scoreText) {
        scoreText.textContent = String(score);
    }

    if (countText) {
        const remaining = enemies.filter((enemy) => enemy.alive).length;
        countText.textContent = String(remaining);
    }
}

function damageEnemy(enemy, amount = 35) {
    if (!enemy || !enemy.alive) return;

    enemy.health -= amount;

    showHit();

    // Briefly flash the enemy red.
    enemy.model.traverse((object) => {
        if (!object.isMesh) return;

        object.material.emissive = new THREE.Color(0xff001d);
        object.material.emissiveIntensity = 0.7;
    });

    setTimeout(() => {
        if (!enemy.alive) return;

        enemy.model.traverse((object) => {
            if (!object.isMesh) return;

            if (object.material === materials.enemyBody) {
                object.material.emissiveIntensity = 0.25;
            } else {
                object.material.emissiveIntensity = 0;
            }
        });
    }, 90);

    if (enemy.health <= 0) {
        enemy.alive = false;
        enemy.model.visible = false;
        score += 100;

        if (lockedEnemy === enemy) {
            lockedEnemy = null;
        }

        showToast("+100  ENEMY ELIMINATED");

        setTimeout(() => {
            if (gameOver) return;

            enemy.health = 100;
            enemy.alive = true;
            enemy.model.visible = true;

            const spawn = enemySpawns[
                Math.floor(Math.random() * enemySpawns.length)
            ];

            enemy.model.position.set(spawn[0], 0, spawn[1]);
            enemy.spawnX = spawn[0];
            enemy.spawnZ = spawn[1];

            enemy.directionTimer = 2;
        }, 1600);
    }

    updateHUD();
}

function getAimDirection() {
    const target = acquireTarget();

    if (target && isEnemyVisible(target)) {
        // Direct the shot at the selected visible target.
        return getEnemyAimPoint(target)
            .sub(camera.position)
            .normalize();
    }

    return getCameraForward();
}

function shoot() {
    if (!started || paused || gameOver) return;
    if (fireCooldown > 0 || reloading) return;

    if (player.ammo <= 0) {
        showToast("OUT OF AMMO — RELOAD");
        return;
    }

    player.ammo--;
    shotsFired++;

    fireCooldown = 0.19;

    const direction = getAimDirection();

    raycaster.set(camera.position, direction);
    raycaster.far = 80;

    // Check walls and enemies together, sorted by distance.
    const wallHits = raycaster.intersectObjects(wallMeshes, false);

    const visibleEnemies = enemies.filter(
        (enemy) => enemy.alive
    );

    const visibleHitMeshes = [];

    for (const enemy of visibleEnemies) {
        visibleHitMeshes.push(...enemy.model.userData.hitMeshes);
    }

    const enemyHits = raycaster.intersectObjects(visibleHitMeshes, false);

    const firstWallDistance = wallHits.length
        ? wallHits[0].distance
        : Infinity;

    const firstEnemyHit = enemyHits.find((hit) => {
        const enemy = hit.object.userData.enemy;
        return enemy && enemy.alive;
    });

    if (
        firstEnemyHit &&
        firstEnemyHit.distance < firstWallDistance
    ) {
        const enemy = firstEnemyHit.object.userData.enemy;

        if (isEnemyVisible(enemy)) {
            damageEnemy(enemy, 35);
            hits++;
        }
    } else if (wallHits.length) {
        // A wall absorbed the shot.
        showToast("COVER HIT");
    }

    updateHUD();
}

function reload() {
    if (!started || paused || gameOver) return;
    if (reloading || player.ammo === player.maxAmmo) return;

    reloading = true;
    reloadTimer = 1.25;

    showToast("RELOADING...");
    updateHUD();
}

function finishReload() {
    player.ammo = player.maxAmmo;
    reloading = false;
    reloadTimer = 0;

    updateHUD();
    showToast("RELOADED");
}

/* =========================================================
   AIMING
   ========================================================= */

// Sensitivity deliberately reduced compared with the previous version.
const TOUCH_SENSITIVITY = 0.0025;
const MOUSE_SENSITIVITY = 0.0018;

function rotateAim(dx, dy, sensitivity) {
    player.yaw -= dx * sensitivity;
    player.pitch -= dy * sensitivity;

    player.pitch = THREE.MathUtils.clamp(
        player.pitch,
        -1.05,
        1.05
    );
}

let mouseDown = false;
let lastPointerX = 0;
let lastPointerY = 0;
let activeAimPointer = null;

renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!started || paused) return;

    // Ignore aim input originating on UI controls.
    if (event.target !== renderer.domElement) return;

    if (event.pointerType === "mouse") {
        if (event.button !== 0) return;

        mouseDown = true;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        return;
    }

    const rect = renderer.domElement.getBoundingClientRect();

    // Left side belongs to movement controls on mobile.
    if (event.clientX < rect.left + rect.width * 0.40) return;

    activeAimPointer = event.pointerId;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;

    renderer.domElement.setPointerCapture?.(event.pointerId);
});

renderer.domElement.addEventListener("pointermove", (event) => {
    if (!started || paused) return;

    if (event.pointerType === "mouse" && mouseDown) {
        const dx = event.clientX - lastPointerX;
        const dy = event.clientY - lastPointerY;

        rotateAim(dx, dy, MOUSE_SENSITIVITY);

        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        return;
    }

    if (activeAimPointer !== event.pointerId) return;

    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;

    rotateAim(dx, dy, TOUCH_SENSITIVITY);

    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
});

function releasePointer(event) {
    if (event.pointerType === "mouse") {
        mouseDown = false;
    }

    if (activeAimPointer === event.pointerId) {
        activeAimPointer = null;
    }
}

renderer.domElement.addEventListener("pointerup", releasePointer);
renderer.domElement.addEventListener("pointercancel", releasePointer);

/* =========================================================
   MOBILE JOYSTICK
   ========================================================= */

let joystickPointer = null;
let joystickCenterX = 0;
let joystickCenterY = 0;

function resetJoystick() {
    joystickPointer = null;
    moveInput.forward = 0;
    moveInput.right = 0;

    if (joyKnob) {
        joyKnob.style.transform = "translate(0px, 0px)";
    }
}

if (joyZone) {
    joyZone.style.touchAction = "none";

    joyZone.addEventListener("pointerdown", (event) => {
        if (!started || paused) return;

        event.preventDefault();

        joystickPointer = event.pointerId;

        const rect = joyZone.getBoundingClientRect();

        joystickCenterX = rect.left + rect.width / 2;
        joystickCenterY = rect.top + rect.height / 2;

        joyZone.setPointerCapture?.(event.pointerId);

        updateJoystick(event);
    });

    joyZone.addEventListener("pointermove", (event) => {
        if (event.pointerId !== joystickPointer) return;

        event.preventDefault();
        updateJoystick(event);
    });

    joyZone.addEventListener("pointerup", (event) => {
        if (event.pointerId === joystickPointer) {
            resetJoystick();
        }
    });

    joyZone.addEventListener("pointercancel", resetJoystick);
}

function updateJoystick(event) {
    const maxDistance = 42;

    let dx = event.clientX - joystickCenterX;
    let dy = event.clientY - joystickCenterY;

    const length = Math.hypot(dx, dy);

    if (length > maxDistance) {
        dx = (dx / length) * maxDistance;
        dy = (dy / length) * maxDistance;
    }

    moveInput.right = dx / maxDistance;
    moveInput.forward = -dy / maxDistance;

    if (joyKnob) {
        joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
}

/* =========================================================
   KEYBOARD
   ========================================================= */

window.addEventListener("keydown", (event) => {
    keys[event.code] = true;

    if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
            event.code
        )
    ) {
        event.preventDefault();
    }

    if (event.repeat) return;

    if (event.code === "Space") {
        jump();
    }

    if (event.code === "KeyR") {
        reload();
    }

    if (event.code === "KeyV") {
        switchView();
    }

    if (event.code === "Escape") {
        togglePause();
    }

    if (event.code === "Enter" && !started) {
        startGame();
    }
});

window.addEventListener("keyup", (event) => {
    keys[event.code] = false;
});

function readKeyboardMovement() {
    let forward = 0;
    let right = 0;

    if (keys.KeyW || keys.ArrowUp) forward += 1;
    if (keys.KeyS || keys.ArrowDown) forward -= 1;
    if (keys.KeyD || keys.ArrowRight) right += 1;
    if (keys.KeyA || keys.ArrowLeft) right -= 1;

    if (forward !== 0 || right !== 0) {
        const length = Math.hypot(forward, right) || 1;

        moveInput.forward = forward / length;
        moveInput.right = right / length;
    } else if (!joystickPointer) {
        moveInput.forward = 0;
        moveInput.right = 0;
    }
}

/* =========================================================
   MOBILE BUTTONS
   ========================================================= */

if (fireButton) {
    fireButton.style.touchAction = "none";

    fireButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        shoot();
    });
}

if (reloadButton) {
    reloadButton.style.touchAction = "none";

    reloadButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        reload();
    });
}

if (jumpButton) {
    jumpButton.style.touchAction = "none";

    jumpButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        jump();
    });
}

if (viewButton) {
    viewButton.addEventListener("click", switchView);
}

if (pauseButton) {
    pauseButton.addEventListener("click", togglePause);
}

function jump() {
    if (!started || paused || gameOver) return;

    if (player.grounded) {
        player.velocityY = jumpPower;
        player.grounded = false;
    }
}

/* =========================================================
   ENEMY MOVEMENT AND ATTACKS
   ========================================================= */

function enemyHasLineOfSight(enemy) {
    const origin = enemy.model.position.clone();
    origin.y = 1.25;

    const target = camera.position.clone();
    const delta = target.clone().sub(origin);
    const distance = delta.length();

    if (distance > 24) return false;

    const direction = delta.normalize();

    raycaster.set(origin, direction);
    raycaster.far = distance;

    const walls = raycaster.intersectObjects(wallMeshes, false);

    return walls.length === 0 || walls[0].distance >= distance - 0.15;
}

function damagePlayer(amount) {
    if (damageCooldown > 0 || gameOver) return;

    damageCooldown = 0.5;
    player.health -= amount;

    if (player.health <= 0) {
        player.health = 0;
        gameOver = true;
        paused = true;

        if (pauseScreen) {
            pauseScreen.style.display = "flex";

            const title = pauseScreen.querySelector("h1, h2");

            if (title) {
                title.textContent = "YOU WERE ELIMINATED";
            }
        }

        if (pauseButton) {
            pauseButton.textContent = "GAME OVER";
        }
    }

    updateHUD();
}

function updateEnemies(delta) {
    for (const enemy of enemies) {
        if (!enemy.alive) continue;

        enemy.directionTimer -= delta;
        enemy.fireTimer -= delta;

        if (enemy.directionTimer <= 0) {
            enemy.directionTimer = randomBetween(1.2, 3.8);

            enemy.direction.set(
                randomBetween(-1, 1),
                0,
                randomBetween(-1, 1)
            );

            enemy.direction.normalize();
        }

        const oldX = enemy.model.position.x;
        const oldZ = enemy.model.position.z;

        const nextX = oldX + enemy.direction.x * enemy.speed * delta;
        const nextZ = oldZ + enemy.direction.z * enemy.speed * delta;

        const nearPlayer = enemy.model.position.distanceTo(
            player.position
        ) < 7;

        // Move around the arena without passing through cover.
        if (!enemyCollidesAt(nextX, nextZ)) {
            enemy.model.position.x = THREE.MathUtils.clamp(
                nextX,
                -halfArena + 1.2,
                halfArena - 1.2
            );

            enemy.model.position.z = THREE.MathUtils.clamp(
                nextZ,
                -halfArena + 1.2,
                halfArena - 1.2
            );
        } else {
            enemy.direction.multiplyScalar(-1);
            enemy.directionTimer = 0.8;
        }

        // Face the player.
        const dx = player.position.x - enemy.model.position.x;
        const dz = player.position.z - enemy.model.position.z;

        enemy.model.rotation.y = Math.atan2(-dx, -dz);

        // Enemies can only attack when they have a clear path.
        if (
            enemy.fireTimer <= 0 &&
            nearPlayer &&
            enemyHasLineOfSight(enemy)
        ) {
            enemy.fireTimer = randomBetween(1.6, 2.7);
            damagePlayer(5);
        }
    }
}

/* =========================================================
   PLAYER MOVEMENT
   ========================================================= */

function updateMovement(delta) {
    readKeyboardMovement();

    const forward = moveInput.forward;
    const right = moveInput.right;

    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);

    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);

    let dx = (forwardX * forward + rightX * right) * player.speed * delta;
    let dz = (forwardZ * forward + rightZ * right) * player.speed * delta;

    const length = Math.hypot(dx, dz);
    const maxStep = player.speed * delta;

    if (length > maxStep && length > 0) {
        dx = (dx / length) * maxStep;
        dz = (dz / length) * maxStep;
    }

    movePlayerWithCollision(dx, dz);

    // Jump physics.
    if (!player.grounded) {
        player.velocityY -= gravity * delta;
        player.position.y += player.velocityY * delta;

        if (player.position.y <= 0) {
            player.position.y = 0;
            player.velocityY = 0;
            player.grounded = true;
        }
    }
}

/* =========================================================
   GAME STATE
   ========================================================= */

function startGame() {
    if (started && !gameOver) {
        paused = false;

        if (pauseScreen) {
            pauseScreen.style.display = "none";
        }

        return;
    }

    started = true;
    paused = false;
    gameOver = false;

    if (startScreen) {
        startScreen.style.display = "none";
    }

    if (pauseScreen) {
        pauseScreen.style.display = "none";
    }

    player.health = 100;
    player.ammo = player.maxAmmo;
    player.position.set(0, 0, 17);
    player.velocityY = 0;
    player.grounded = true;
    player.yaw = Math.PI;
    player.pitch = 0;

    score = 0;
    shotsFired = 0;
    hits = 0;
    reloading = false;
    reloadTimer = 0;
    fireCooldown = 0;
    damageCooldown = 0;
    lockedEnemy = null;

    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        const spawn = enemySpawns[i % enemySpawns.length];

        enemy.health = 100;
        enemy.alive = true;
        enemy.model.visible = true;
        enemy.model.position.set(spawn[0], 0, spawn[1]);
        enemy.directionTimer = randomBetween(1, 3);
        enemy.fireTimer = randomBetween(1.5, 3);
    }

    updatePlayerModel();
    updateCamera();
    updateHUD();

    showToast("BATTLE STARTED");
}

function togglePause() {
    if (!started || gameOver) return;

    paused = !paused;

    if (pauseScreen) {
        pauseScreen.style.display = paused ? "flex" : "none";
    }

    if (pauseButton) {
        pauseButton.textContent = paused ? "RESUME" : "PAUSE";
    }
}

/* =========================================================
   BUTTONS AND STARTUP
   ========================================================= */

if (startButton) {
    startButton.addEventListener("click", startGame);
}

if (resumeButton) {
    resumeButton.addEventListener("click", () => {
        if (gameOver) return;

        paused = false;

        if (pauseScreen) {
            pauseScreen.style.display = "none";
        }

        if (pauseButton) {
            pauseButton.textContent = "PAUSE";
        }
    });
}

if (restartButton) {
    restartButton.addEventListener("click", startGame);
}

if (mobileControls) {
    mobileControls.style.touchAction = "none";
}

// Prevent browser gestures while playing.
document.addEventListener("contextmenu", (event) => {
    if (started) event.preventDefault();
});

function resizeGame() {
    const width = Math.max(1, gameRoot.clientWidth);
    const height = Math.max(1, gameRoot.clientHeight);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
}

window.addEventListener("resize", resizeGame);
window.addEventListener("orientationchange", () => {
    setTimeout(resizeGame, 150);
});

/* =========================================================
   MAIN LOOP
   ========================================================= */

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 0.04);

    if (started && !paused && !gameOver) {
        fireCooldown = Math.max(0, fireCooldown - delta);
        damageCooldown = Math.max(0, damageCooldown - delta);

        if (reloading) {
            reloadTimer -= delta;

            if (reloadTimer <= 0) {
                finishReload();
            }
        }

        updateMovement(delta);
        updateEnemies(delta);
    }

    updatePlayerModel();
    updateCamera();
    updateLockCircle();

    renderer.render(scene, camera);
}

updatePlayerModel();
updateCamera();
updateHUD();
resizeGame();
animate();

console.log("INTER RIVALRY: RIVALS loaded.");
