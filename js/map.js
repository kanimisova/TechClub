import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const container = document.getElementById('mapContainer');
if (container) {

  /* ---- 基本セットアップ ---- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);

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
  let polarAngle = Math.PI / 3;
  let angle = 0;

  const POLAR_MIN = 0.001;
  const POLAR_MAX = Math.PI / 2 - 0.05;

  function updateCamera() {
    camera.position.x = target.x + radius * Math.sin(polarAngle) * Math.sin(angle);
    camera.position.z = target.z + radius * Math.sin(polarAngle) * Math.cos(angle);
    camera.position.y = target.y + radius * Math.cos(polarAngle);
    camera.lookAt(target);
  }
  updateCamera();

  /* ---- ラベル用の変数(共通の場所で定義) ---- */
  let roomLabelElements = [];
  let roomMeshes = [];   // ← 追加

  /* ---- モデル読み込み ---- */
  const loader = new GLTFLoader();
  loader.load('assets/map.glb', (gltf) => {
    const model = gltf.scene;

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    target.copy(center);
    const size = box.getSize(new THREE.Vector3()).length();
    radius = size * 0.75;
    updateCamera();

    scene.fog = new THREE.Fog(0x000000, radius * 1.5, radius * 4);

    const roomTargets = [];
    const roomNameMap = {
      '101': '3階 Macルーム',
      '205': '第一体育館',
      '305': '3階 3-5教室',
    };

    model.traverse((child) => {
      if (!child.isMesh) return;

      if (child.name.startsWith('Building_')) {
        child.material = new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0,
          depthWrite: false,
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
          opacity: 0.85,
          depthWrite: false,
        });
        const key = child.name.replace('Target_Red_', '');
        roomTargets.push({ object: child, label: roomNameMap[key] || key });
        roomMeshes.push(child);   // ← 追加

      } else if (child.name.startsWith('Target_Blue_')) {
        child.material = new THREE.MeshBasicMaterial({
          color: 0xFF2E92,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        });
        const key = child.name.replace('Target_Blue_', '');
        roomTargets.push({ object: child, label: roomNameMap[key] || key });
        roomMeshes.push(child);   // ← 追加

      } else if (child.name.startsWith('Target_Green_')) {
        child.material = new THREE.MeshBasicMaterial({
          color: 0x39FF14,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        });
        const key = child.name.replace('Target_Green_', '');
        roomTargets.push({ object: child, label: roomNameMap[key] || key });
        roomMeshes.push(child);   // ← 追加
      }
    });

    scene.add(model);

    /* ---- 部屋ごとの個別トグルを生成 ---- */
    const roomToggleList = document.getElementById('mapRoomToggleList');
    if (roomToggleList) {
      roomTargets.forEach((room, index) => {
        const row = document.createElement('label');
        row.className = 'map-toggle-row';
        row.innerHTML = `
          <input type="checkbox" checked data-room-index="${index}">
          <span class="map-toggle-track"><span class="map-toggle-thumb"></span></span>
          <span class="map-toggle-row-label mono">${room.label}</span>
        `;
        roomToggleList.appendChild(row);

        const checkbox = row.querySelector('input');
        checkbox.addEventListener('change', () => {
          setRoomVisible(index, checkbox.checked);
          syncAllToggleState();
        });
      });
    }

    /* ---- シンプルなラベル(部屋名テキストのみ) ---- */
    const labelsContainer = document.getElementById('mapLabels');
    if (labelsContainer) {
      roomLabelElements = roomTargets.map((room) => {
        const el = document.createElement('div');
        el.className = 'map-label-simple';
        el.textContent = room.label;
        labelsContainer.appendChild(el);
        return { object: room.object, el };
      });

      updateSimpleLabels();   // ← 追加: 初期位置を計算
      roomLabelElements.forEach(({ el }) => el.classList.add('is-visible'));  // ← 追加: 最初から表示
    }

    /* ---- ネオングリッド ---- */
    const gridSize = size * 2.5;
    const gridGeo = new THREE.PlaneGeometry(gridSize, gridSize, 1, 1);
    const gridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(0xFFFFFF) },
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
          float dist = distance(vUv, vec2(0.5));
          float fade = 1.0 - smoothstep(0.0, 0.5, dist);
          gl_FragColor = vec4(uColor, lineAlpha * fade * 0.35);
        }
      `,
    });
    const gridMesh = new THREE.Mesh(gridGeo, gridMat);
    gridMesh.rotation.x = -Math.PI / 2;
    gridMesh.position.y = box.min.y - 0.3;
    gridMesh.renderOrder = -1;
    scene.add(gridMesh);

  }, undefined, (error) => {
    console.error('モデルの読み込みに失敗しました:', error);
  });

  /* ---- ヒント表示制御 ---- */
  const hintEl = document.getElementById('mapHint');

  function showHint() {
    if (!hintEl) return;
    hintEl.style.opacity = '1';
  }
  function hideHint() {
    if (!hintEl) return;
    hintEl.style.opacity = '0';
  }

  /* ---- ラベル位置の更新 ---- */
  function updateSimpleLabels() {
    roomLabelElements.forEach(({ object, el }) => {
      const worldPos = new THREE.Vector3();
      object.getWorldPosition(worldPos);
      const screenPos = worldPos.clone().project(camera);
      const x = (screenPos.x * 0.5 + 0.5) * container.clientWidth;
      const y = (-screenPos.y * 0.5 + 0.5) * container.clientHeight;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    });
  }

  let roomsVisible = true; // デフォルトの状態(下記「デフォルトの変更方法」参照)

  function setRoomsVisible(visible) {
    roomsVisible = visible;

    // 部屋本体をふわっとフェード
    roomMeshes.forEach((mesh) => {
      const targetOpacity = visible ? 0.85 : 0;
      animateOpacity(mesh.material, targetOpacity);
    });

    // ラベルも連動
    roomLabelElements.forEach(({ el }) => {
      el.classList.toggle('is-visible', visible);
    });
  }

  function setRoomVisible(index, visible) {
    const mesh = roomMeshes[index];
    const label = roomLabelElements[index];
    if (mesh) animateOpacity(mesh.material, visible ? 0.85 : 0);
    if (label) label.el.classList.toggle('is-visible', visible);
  }

  function syncAllToggleState() {
    const allToggle = document.getElementById('mapRoomToggleAll');
    const checkboxes = document.querySelectorAll('#mapRoomToggleList input');
    const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
    if (allToggle) allToggle.checked = allChecked;
  }

  // opacityを滑らかに変化させる簡易アニメーション
  function animateOpacity(material, target) {
    const duration = 400; // ミリ秒
    const start = material.opacity;
    const startTime = performance.now();

    function step(now) {
      const t = Math.min((now - startTime) / duration, 1);
      material.opacity = start + (target - start) * t;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---- 水平・縦方向ドラッグ回転 ---- */
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  function onPointerDown(e) {
    isDragging = true;
    lastX = (e.touches ? e.touches[0].clientX : e.clientX);
    lastY = (e.touches ? e.touches[0].clientY : e.clientY);
    hideHint();
    roomLabelElements.forEach(({ el }) => el.classList.remove('is-visible'));
  }
  function onPointerMove(e) {
    if (!isDragging) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    const deltaX = x - lastX;
    const deltaY = y - lastY;
    lastX = x;
    lastY = y;

    angle -= deltaX * 0.008;
    polarAngle -= deltaY * 0.008;
    polarAngle = Math.max(POLAR_MIN, Math.min(POLAR_MAX, polarAngle));

    updateCamera();
  }
  function onPointerUp() {
    isDragging = false;
    showHint();
    updateSimpleLabels();
    roomLabelElements.forEach(({ el }) => el.classList.add('is-visible'));
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

  /* ---- 部屋の表示/非表示トグル ---- */
  const roomToggleAll = document.getElementById('mapRoomToggleAll');
  if (roomToggleAll) {
    roomToggleAll.addEventListener('change', () => {
      setRoomsVisible(roomToggleAll.checked);
      // 個別チェックボックスも一括で連動
      document.querySelectorAll('#mapRoomToggleList input').forEach((cb) => {
        cb.checked = roomToggleAll.checked;
      });
    });
  }

  /* ---- 全画面表示 ---- */
  const fullscreenBtn = document.getElementById('mapFullscreenBtn');

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        if (container.requestFullscreen) {
          container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) { // Safari対応
          container.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    });

    // 全画面表示のON/OFFに合わせて、レンダラーとカメラのサイズを再計算
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    function onFullscreenChange() {
      // 少し待ってからサイズを再取得(ブラウザのレイアウト確定を待つ)
      setTimeout(() => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);

        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
        fullscreenBtn.textContent = isFullscreen ? '✕' : '⛶';

        updateSimpleLabels(); // ラベル位置も再計算
      }, 100);
    }
  }

  /* ---- 設定パネルの開閉 ---- */
  const settingsBtn = document.getElementById('mapSettingsBtn');
  const settingsPanel = document.getElementById('mapSettingsPanel');

  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = settingsPanel.classList.toggle('is-open');
      settingsBtn.classList.toggle('is-open', isOpen);
    });
  
    // パネルの外側をクリックしたら閉じる
    document.addEventListener('click', (e) => {
      if (!settingsPanel.contains(e.target) && e.target !== settingsBtn) {
        settingsPanel.classList.remove('is-open');
        settingsBtn.classList.remove('is-open');
      }
    });
  }

}