import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const container = document.getElementById('mapContainer');
if (container) {

  /* ---- 基本セットアップ ---- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  

  const   camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

const target = new THREE.Vector3(0, 0, 0);
let radius = 8;
let polarAngle = Math.PI / 3;  // 縦方向の角度(下記で説明。初期値は斜め上から見下ろす角度)
let angle = 0;                  // 水平方向の回転角(左右)

const POLAR_MIN = 0.001;              // 上限: ほぼ真上(垂直)
const POLAR_MAX = Math.PI / 2 - 0.05; // 下限: 水平に近い角度(完全な水平は避け、床が見えすぎないようにわずかに余裕を持たせています)

  function updateCamera() {
    camera.position.x = target.x + radius * Math.sin(polarAngle) * Math.sin(angle);
    camera.position.z = target.z + radius * Math.sin(polarAngle) * Math.cos(angle);
    camera.position.y = target.y + radius * Math.cos(polarAngle);
  camera.lookAt(target);
  }
  updateCamera();

  /* ---- モデル読み込み ---- */
  const loader = new GLTFLoader();
  loader.load('assets/map.glb', (gltf) => {
    const model = gltf.scene;

    // モデル中心にカメラのターゲットを合わせる
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    target.copy(center);
    const size = box.getSize(new THREE.Vector3()).length();
    radius = size * 0.5;  // 数値を大きくすると引きの画に、小さくすると寄った画になる
    updateCamera();

    scene.fog = new THREE.Fog(0x000000, radius * 1.5, radius * 4);

    model.traverse((child) => {
      if (!child.isMesh) return;

      if (child.name.startsWith('Building_')) {
        child.material = new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0,
          depthWrite: false,   // ← true から false に変更(これがポイント)
          colorWrite: false,
        });

        const edges = new THREE.EdgesGeometry(child.geometry, 30);
        const edgeLines = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: 0x00F0FF })
        );
        child.add(edgeLines);
      } else if (child.name.startsWith('Target_Red_')) {
        child.material = new THREE.MeshBasicMaterial({
          color: 0xF9E440,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,  // 追加
        });
      } else if (child.name.startsWith('Target_Blue_')) {
        child.material = new THREE.MeshBasicMaterial({
          color: 0xFF2E92,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,  // 追加
        });
      } else if (child.name.startsWith('Target_Green_')) {
        child.material = new THREE.MeshBasicMaterial({
          color: 0x39FF14,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,  // 追加
        });
      
      }
    });

    scene.add(model);

    const gridSize = size * 2.5; // モデルサイズに応じた地面の広さ
    const gridGeo = new THREE.PlaneGeometry(gridSize, gridSize, 1, 1);
    const gridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(0xFFFFFF) }, // 赤系のネオン色
        uSize: { value: gridSize },
        uDivisions: { value: 40.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform float uDivisions;
        void main() {
          vec2 grid = abs(fract(vUv * uDivisions - 0.5) - 0.5) / fwidth(vUv * uDivisions);
          float line = min(grid.x, grid.y);
          float lineAlpha = 1.0 - min(line, 1.0);

          // 中心(0.5, 0.5)からの距離に応じてフェード
          float dist = distance(vUv, vec2(0.5));
          float fade = 1.0 - smoothstep(0.0, 0.5, dist);

          gl_FragColor = vec4(uColor, lineAlpha * fade * 0.35);
        }
      `,
    });
    const gridMesh = new THREE.Mesh(gridGeo, gridMat);
    gridMesh.rotation.x = -Math.PI / 2; // 床として水平に寝かせる
    gridMesh.position.y = box.min.y - 0.3;
    gridMesh.renderOrder = -1;
    scene.add(gridMesh);
  });

  /* ---- 水平方向のみドラッグ回転 ---- */
  const hintEl = document.getElementById('mapHint');   // ← 追加
  let hasInteracted = false;                              // ← 追加
  let hintTimer = null;                                    // ← 追加

  function showHint() {                                     // ← 追加
    if (!hintEl) return;
    clearTimeout(hintTimer);
    hintEl.style.opacity = '1';
  }

  function hideHintAfterDelay(delay) {                      // ← 追加
    if (!hintEl) return;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintEl.style.opacity = '0';
    }, delay);
  }

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  function onPointerDown(e) {
    isDragging = true;
    lastX = (e.touches ? e.touches[0].clientX : e.clientX);
    lastY = (e.touches ? e.touches[0].clientY : e.clientY);
    hasInteracted = true;   // 初回操作があったことを記録
    showHint();              // ドラッグを始めた瞬間、ヒントを表示
  }
  function onPointerMove(e) {
    if (!isDragging) return;
    console.log('ドラッグ終了 → 0.9秒後に非表示');  // ← 追加
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    const deltaX = x - lastX;
    const deltaY = y - lastY;
    lastX = x;
    lastY = y;

    angle -= deltaX * 0.008;

    polarAngle -= deltaY * 0.008;  // 縦ドラッグで角度を変化
    polarAngle = Math.max(POLAR_MIN, Math.min(POLAR_MAX, polarAngle)); // 範囲を制限

    updateCamera();
  }
  function onPointerUp() {
    isDragging = false;
    showHint();   // 手を離したら、表示する
  }

  function showHintPulse() {
    const hintEl = document.getElementById('mapHint');
    let hasInteracted = false;   // 「初回操作をしたかどうか」を記録
    let hintTimer = null;

    function showHint() {
      if (!hintEl) return;
      hintEl.style.opacity = '1';
    }

    function hideHint() {
      if (!hintEl) return;
      hintEl.style.opacity = '0';
    }
  }

  container.addEventListener('mousedown', onPointerDown);
  container.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);

  container.addEventListener('touchstart', onPointerDown, { passive: true });
  container.addEventListener('touchmove', onPointerMove, { passive: true });
  container.addEventListener('touchend', onPointerUp);

  /* ---- リサイズ対応 ---- */
  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  /* ---- 描画ループ ---- */
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}