// Sublimaether v0.1.0a
// 飛ぶ気持ちよさを確認する最小実装
// 自機（デュロキセア機）操作・3人称追尾カメラ・電子世界グリッド

import * as THREE from 'three';

// =====================================================
// シーン・カメラ・レンダラ
// =====================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02060d);
scene.fog = new THREE.Fog(0x02060d, 800, 4000);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.5,
  10000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// =====================================================
// ライト
// =====================================================
const ambient = new THREE.AmbientLight(0x335577, 0.7);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xaad4ff, 0.9);
sun.position.set(500, 1000, 500);
scene.add(sun);

// =====================================================
// グラウンド（5km四方の電子世界グリッド）
// =====================================================
const MAP_SIZE = 5000;     // 5km四方
const GRID_DIV = 50;       // 100m間隔のグリッド

const grid = new THREE.GridHelper(MAP_SIZE, GRID_DIV, 0x1f589f, 0x0a2440);
grid.position.y = 0;
scene.add(grid);

// 床（半透明の暗いプレーン）
const floorGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
const floorMat = new THREE.MeshBasicMaterial({
  color: 0x040912,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.1;
scene.add(floor);

// 遠景の星（粒子）
const starGeo = new THREE.BufferGeometry();
const starCount = 600;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const r = 4500 + Math.random() * 500;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(1 - Math.random() * 1.2);
  starPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
  starPos[i * 3 + 1] = r * Math.cos(phi) * 0.3 + 200;
  starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({
  color: 0x6fb3ff,
  size: 2,
  sizeAttenuation: false,
  transparent: true,
  opacity: 0.7,
});
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

// =====================================================
// 自機（デュロキセア機）
// =====================================================
const aircraft = new THREE.Group();
aircraft.position.set(0, 200, 0);

// 機体本体（紺青の細長いBox）
const bodyMat = new THREE.MeshPhongMaterial({
  color: 0x1f3a5f,
  emissive: 0x0a1a2f,
  shininess: 80,
});
const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 8), bodyMat);
aircraft.add(body);

// 翼
const wing = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 2.5), bodyMat);
wing.position.z = 0.5;
aircraft.add(wing);

// 尾翼（垂直）
const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.8, 1.5), bodyMat);
tail.position.set(0, 1.0, 3.5);
aircraft.add(tail);

// エンジン光（青）
const engineMat = new THREE.MeshBasicMaterial({ color: 0x6fb3ff });
const engine = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), engineMat);
engine.position.set(0, 0, 4.2);
aircraft.add(engine);

scene.add(aircraft);

// =====================================================
// 飛行物理
// =====================================================
const flight = {
  speed: 50,           // 現在速度（m/s）
  minSpeed: 20,
  maxSpeed: 200,
  accel: 30,           // 加減速レート
  pitchRate: 1.2,      // ピッチ角速度（rad/s）
  yawRate: 0.8,
  rollRate: 2.0,
  pitch: 0,
  yaw: 0,
  roll: 0,
};

// =====================================================
// 入力
// =====================================================
const keys = Object.create(null);
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyH') {
    document.getElementById('controls').classList.toggle('hidden');
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

// =====================================================
// リサイズ
// =====================================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =====================================================
// HUD更新
// =====================================================
const hudSpd = document.getElementById('spd');
const hudAlt = document.getElementById('alt');

// =====================================================
// メインループ
// =====================================================
const clock = new THREE.Clock();
const tmpQ = new THREE.Quaternion();
const fwd = new THREE.Vector3();

function update(dt) {
  // 入力 → 角速度
  let pitchInput = 0, yawInput = 0, rollInput = 0;
  if (keys['ArrowUp'])    pitchInput -= 1;
  if (keys['ArrowDown'])  pitchInput += 1;
  if (keys['ArrowLeft'])  yawInput   += 1;
  if (keys['ArrowRight']) yawInput   -= 1;
  if (keys['KeyA'])       rollInput  += 1;
  if (keys['KeyD'])       rollInput  -= 1;

  // 加減速
  if (keys['KeyW']) flight.speed += flight.accel * dt;
  if (keys['KeyS']) flight.speed -= flight.accel * dt;
  flight.speed = Math.max(flight.minSpeed, Math.min(flight.maxSpeed, flight.speed));

  // 機体姿勢を機体ローカルで回転（順序：ピッチ→ヨー→ロール）
  // pitch：機体のX軸回り
  if (pitchInput !== 0) {
    tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchInput * flight.pitchRate * dt);
    aircraft.quaternion.multiply(tmpQ);
  }
  // yaw：機体のY軸回り
  if (yawInput !== 0) {
    tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawInput * flight.yawRate * dt);
    aircraft.quaternion.multiply(tmpQ);
  }
  // roll：機体のZ軸回り
  if (rollInput !== 0) {
    tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollInput * flight.rollRate * dt);
    aircraft.quaternion.multiply(tmpQ);
  }

  // 機体の前方ベクトル（機体ローカルの -Z 方向）
  fwd.set(0, 0, -1).applyQuaternion(aircraft.quaternion);
  aircraft.position.addScaledVector(fwd, flight.speed * dt);

  // マップ外に出すぎないように緩く制限（高度・水平）
  const halfMap = MAP_SIZE / 2;
  if (aircraft.position.x >  halfMap) aircraft.position.x =  halfMap;
  if (aircraft.position.x < -halfMap) aircraft.position.x = -halfMap;
  if (aircraft.position.z >  halfMap) aircraft.position.z =  halfMap;
  if (aircraft.position.z < -halfMap) aircraft.position.z = -halfMap;
  if (aircraft.position.y < 5)        aircraft.position.y = 5;
  if (aircraft.position.y > 1500)     aircraft.position.y = 1500;

  // 3人称追尾カメラ（機体の後方上方）
  const camOffset = new THREE.Vector3(0, 4, 18).applyQuaternion(aircraft.quaternion);
  camera.position.copy(aircraft.position).add(camOffset);
  camera.quaternion.copy(aircraft.quaternion);
  // カメラの向きを機体と揃える（少し下向きに）
  const lookAhead = new THREE.Vector3(0, 0, -50).applyQuaternion(aircraft.quaternion);
  camera.lookAt(aircraft.position.clone().add(lookAhead));

  // HUD
  hudSpd.textContent = Math.round(flight.speed * 3.6); // m/s → km/h
  hudAlt.textContent = Math.round(aircraft.position.y);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
}

animate();
