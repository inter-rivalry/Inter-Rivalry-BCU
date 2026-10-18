import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

(() => {
  "use strict";

  // ==========================================
  // INTER RIVALRY: RIVALS
  // Mobile FPS prototype
  // ==========================================

  const $ = (id) => document.getElementById(id);

  const root = $("game-root");
  const startScreen = $("start");
  const hud = $("hud");
  const pauseScreen = $("pause");
  const mobile = $("mobile");

  if (!root) {
    console.error("Game root was not found.");
    return;
  }

  // ==========================================
  // GAME STATE
  // ==========================================

  let started = false;
  let paused = false;
  let gameOver = false;
  let thirdPerson = false;

  let health = 100;
  let score = 0;
  let ammo = 30;
  let reserveAmmo = 90;

  const MAGAZINE_SIZE = 30;
  const PLAYER_SPEED = 7;
  const PLAYER_RADIUS = 0.48;
  const PLAYER_HEIGHT = 1.8;
  const ARENA_LIMIT = 23;

  const keys = {};
  const walls = [];
  const wallMeshes = [];
  const enemies = [];
  const effects = [];

  let yaw = 0;
  let pitch = 0;
  let verticalVelocity = 0;
  let onGround = true;
  let reloading = false;
  let reloadTimer = 0;
  let shootCooldown = 0;
  let damageFlash = 0;
  let toastTimer = 0;
  let toastElement = null;
  let hitTimer = 0;
  let lastTime = 0;
  let lastDamageTime = 0;
  let enemySpawnTimer = 0;

  const playerPosition = new THREE.Vector3(0, 0, 12);
  const movement = { x: 0, y: 0 };
  const joystick = {
    active: false,
    pointerId: null,
    centerX: 0,
    centerY: 0,
    maxRadius: 42
  };

  let aimPointer = null;
  let lastAimX = 0;
  let lastAimY = 0;

  const raycaster = new THREE.Raycaster();
  raycaster.far = 100;

  const screenCenter = new THREE.Vector2(0, 0);

  // ==========================================
  // THREE.JS SCENE
  // ==========================================

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101827);
  scene.fog = new THREE.Fog(0x101827, 38, 85);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    150
  );

  camera.position.set(0, 1.65, 12);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  root.appendChild(renderer.domElement);

  // ==========================================
  // LIGHTING
  // ==========================================

  scene.add(new THREE.HemisphereLight(0xb9d9ff, 0x24243d, 2.0));

  const mainLight = new THREE.DirectionalLight(0xffffff, 2.0);
  mainLight.position.set(10, 22, 8);
  scene.add(mainLight);

  const redLight = new THREE.PointLight(0xff263f, 30, 20);
  redLight.position.set(-12, 4, -12);
  scene.add(redLight);

  const blueLight = new THREE.PointLight(0x1688ff, 30, 20);
  blueLight.position.set(12, 4, 12);
  scene.add(blueLight);

  // ==========================================
  // MATERIALS
  // ==========================================

  const materials = {
    floor: new THREE.MeshStandardMaterial({
      color: 0x202b3d,
      roughness: 0.95
    }),

    wall: new THREE.MeshStandardMaterial({
      color: 0x39485f,
      roughness: 0.85
    }),

    wallDark: new THREE.MeshStandardMaterial({
      color: 0x172337,
      roughness: 0.9
    }),

    red: new THREE.MeshStandardMaterial({
      color: 0xf52e49,
      roughness: 0.65
    }),

    blue: new THREE.MeshStandardMaterial({
      color: 0x258cff,
      roughness: 0.65
    }),

    white: new THREE.MeshStandardMaterial({
      color: 0xe9f3ff,
      roughness: 0.5
    }),

    black: new THREE.MeshStandardMaterial({
      color: 0x111722,
      roughness: 0.8
    }),

    groundMark: new THREE.MeshStandardMaterial({
      color: 0x3c4c66,
      roughness: 1
    }),

    bullet: new THREE.MeshBasicMaterial({
      color: 0xffdf75
    }),

    hitEffect: new THREE.MeshBasicMaterial({
      color: 0xff354d
    })
  };

  // ==========================================
  // ARENA
  // ==========================================

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(52, 52),
    materials.floor
  );

  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);

  const grid = new THREE.GridHelper(50, 50, 0x415575, 0x2c3b53);
  grid.position.y = 0.015;
  scene.add(grid);

  function addBox(x, y, z, width, height, depth, material, solid = true) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      material
    );

    mesh.position.set(x, y, z);
    scene.add(mesh);

    if (solid) {
      walls.push({
        x: x,
        z: z,
        halfW: width / 2,
        halfD: depth / 2,
        height: height,
        mesh: mesh
      });

      wallMeshes.push(mesh);
    }

    return mesh;
  }

  // Outer arena walls
  addBox(0, 2, -25, 52, 4, 1, materials.wallDark);
  addBox(0, 2, 25, 52, 4, 1, materials.wallDark);
  addBox(-25, 2, 0, 1, 4, 52, materials.wallDark);
  addBox(25, 2, 0, 1, 4, 52, materials.wallDark);

  // Wall trim
  addBox(0, 3.8, -24.4, 50, 0.15, 0.15, materials.red, false);
  addBox(0, 3.8, 24.4, 50, 0.15, 0.15, materials.blue, false);

  // Cover structures
  const cover = [
    [-14, -14, 5, 2, 2],
    [-7, -15, 2, 4, 2],
    [0, -13, 6, 2, 2],
    [9, -15, 3, 3, 2],
    [15, -11, 2, 5, 2],

    [-15, -5, 2, 6, 2],
    [-8, -6, 5, 2, 2],
    [0, -5, 3, 3, 2],
    [8, -5, 5, 2, 2],
    [15, -4, 2, 6, 2],

    [-14, 5, 5, 2, 2],
    [-7, 7, 2, 5, 2],
    [0, 5, 6, 2, 2],
    [9, 7, 3, 3, 2],
    [15, 6, 2, 5, 2],

    [-11, 15, 4, 2, 2],
    [-3, 15, 2, 4, 2],
    [6, 15, 5, 2, 2],
    [13, 14, 2, 4, 2],

    [-3, 0, 2, 3, 2],
    [4, 0, 2, 3, 2]
  ];

  for (let i = 0; i < cover.length; i++) {
    const [x
