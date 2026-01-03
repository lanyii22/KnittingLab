import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { normalizeAppPattern } from './pattern-adapter.js';

// ====== context injected by ui.js ======
let CTX = {
  getAppPattern: () => ({ rows: [[]] }),
  getYarnColor: () => '#e1c77a',
  getYarnRadiusScale: () => 1.0,
  getDetail: () => 'med',
  getScale3D: () => 0.01,
  getRowHeightScale: () => 1.5,
  getRowThickness: () => ({}),
  getPadding: () => ({ X_PADDING: 1, Y_PADDING: 0 }),
};
export function set3DContext(ctx) {
  CTX = { ...CTX, ...ctx };
}

// ====== 3D module state ======
let scene, camera, renderer, controls;
let meshes = [];
let threeWrap, threeOverlay;
let LAST_STATE = null;
let BASE_YARN_COLOR = null;
let NORMALIZED_ROWS = null;
let floorMesh = null;
let gridHelper = null;
let hemiLight = null;
let ambientLight = null;
let panelLight = null;
let keyLight = null;
let rimLight = null;
let fiberMap = null;
let fiberMapLoading = false;
let fiberAlpha = null;

const THEME_COLORS = {
  dark: {
    sceneBg: 0x07070d,
    floor: 0x0a0a12,
    gridMajor: 0x2a2a3a,
    gridMinor: 0x141420,
    ambientColor: 0xffffff,
    ambientIntensity: 0.08,
    panelColor: 0xffffff,
    panelIntensity: 0.35,
    hemiSky: 0xf2f5ff,
    hemiGround: 0x1b1f2b,
    hemiIntensity: 0.82,
    keyColor: 0xf7f2e8,
    keyIntensity: 0.95,
    rimColor: 0xaec6ff,
    rimIntensity: 0.22,
  },
  light: {
    sceneBg: 0xf7f1e7,      
    floor: 0xf7efe2,       
    gridMajor: 0xe8dcc9,   
    gridMinor: 0xf2e7d6,   
    ambientColor: 0xfff6e8,
    ambientIntensity: 0.42,
    panelColor: 0xfff6e8,
    panelIntensity: 0.8,
    hemiSky: 0xffffff,
    hemiGround: 0xf6efe0,
    hemiIntensity: 1.2,
    keyColor: 0xfff5e6,
    keyIntensity: 0.95,
    rimColor: 0xdfe8ff,
    rimIntensity: 0.12,
  },
};
let current3DTheme = 'dark';

function apply3DTheme() {
  const cfg = THEME_COLORS[current3DTheme] || THEME_COLORS.dark;
  if (scene) scene.background = new THREE.Color(cfg.sceneBg);
  if (floorMesh) floorMesh.material.color.setHex(cfg.floor);
  if (gridHelper) {
    const mats = Array.isArray(gridHelper.material) ? gridHelper.material : [gridHelper.material];
    if (mats[0]) {
      mats[0].color.setHex(cfg.gridMajor);
      mats[0].opacity = current3DTheme === 'light' ? 0.32 : 0.45;
      mats[0].transparent = true;
    }
    if (mats[1]) {
      mats[1].color.setHex(cfg.gridMinor);
      mats[1].opacity = current3DTheme === 'light' ? 0.32 : 0.45;
      mats[1].transparent = true;
    }
  }
  if (hemiLight) {
    hemiLight.color.setHex(cfg.hemiSky);
    hemiLight.groundColor.setHex(cfg.hemiGround);
    hemiLight.intensity = cfg.hemiIntensity;
  }
  if (ambientLight) {
    ambientLight.color.setHex(cfg.ambientColor);
    ambientLight.intensity = cfg.ambientIntensity;
  }
  if (panelLight) {
    panelLight.color.setHex(cfg.panelColor);
    panelLight.intensity = cfg.panelIntensity;
  }
  if (keyLight) {
    keyLight.color.setHex(cfg.keyColor);
    keyLight.intensity = cfg.keyIntensity;
  }
  if (rimLight) {
    rimLight.color.setHex(cfg.rimColor);
    rimLight.intensity = cfg.rimIntensity;
  }
}

export function set3DTheme(theme) {
  current3DTheme = theme === 'light' ? 'light' : 'dark';
  apply3DTheme();
  if (renderer) renderer.render(scene, camera);
}

function requestFiberMap() {
  if (fiberMap || fiberMapLoading) return;
  if (!THREE.TextureLoader) return;
  fiberMapLoading = true;
  const loader = new THREE.TextureLoader();
  loader.load(
    './16pic_1827399_b.jpg',
    (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(3, 1);
      tex.anisotropy = renderer?.capabilities?.getMaxAnisotropy?.() || 4;
      fiberMap = tex;
      // alpha map: reuse same texture; we'll invert in shader via color convert (simple)
      fiberAlpha = tex.clone();
      fiberMapLoading = false;
      if (LAST_STATE) build3DFromYarnSim(LAST_STATE);
    },
    undefined,
    () => { fiberMapLoading = false; }
  );
}

export function init3D() {
  threeWrap = document.getElementById('threeWrap');
  threeOverlay = document.getElementById('threeOverlay');

  const old = threeWrap.querySelector('canvas');
  if (old) old.remove();

  scene = new THREE.Scene();

  const rect = threeWrap.getBoundingClientRect();
  const w = Math.max(200, Math.floor(rect.width));
  const h = Math.max(200, Math.floor(rect.height));

  camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 500);
  camera.position.set(0.0, 0.0, 3.0);
  camera.layers.enable(1);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(w, h);
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else if ('outputEncoding' in renderer && THREE.sRGBEncoding) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  threeWrap.appendChild(renderer.domElement);
  requestFiberMap();

  hemiLight = new THREE.HemisphereLight(0xffffff, 0x101020, 0.62);
  scene.add(hemiLight);
  ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
  scene.add(ambientLight);
  panelLight = new THREE.DirectionalLight(0xffffff, 0.6);
  panelLight.position.set(0.0, 0.2, 4.2);
  panelLight.layers.set(1);
  scene.add(panelLight);
  keyLight = new THREE.DirectionalLight(0xffffff, 1.18);
  keyLight.position.set(0.0, 0.6, 4.5);
  scene.add(keyLight);
  rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
  rimLight.position.set(0.0, 1.6, -3.8);
  scene.add(rimLight);

  floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 1.0, metalness: 0.0 })
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -1.0;
  scene.add(floorMesh);

  gridHelper = new THREE.GridHelper(12, 24, 0x2a2a3a, 0x141420);
  gridHelper.position.y = -1.0;
  scene.add(gridHelper);
  apply3DTheme();

  controls = new OrbitControls(camera, renderer.domElement);

  const FRONT_VIEW_POS = new THREE.Vector3(0, 0, 3);
  const FRONT_VIEW_TARGET = new THREE.Vector3(0, 0, 0);

  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);
  controls.update();

  function resize() {
    const r = threeWrap.getBoundingClientRect();
    const ww = Math.max(200, Math.floor(r.width));
    const hh = Math.max(200, Math.floor(r.height));
    renderer.setSize(ww, hh);
    camera.aspect = ww / hh;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // Hook buttons
  const btnFront = document.getElementById('viewFront');
  const btnFree = document.getElementById('viewFree');

  if (btnFront) {
    btnFront.addEventListener('click', () => {
      camera.position.copy(FRONT_VIEW_POS);
      controls.target.copy(FRONT_VIEW_TARGET);
      controls.enableRotate = false;
      controls.enablePan = false;
      controls.enableZoom = true;
      controls.update();
    });
  }

  if (btnFree) {
    btnFree.addEventListener('click', () => {
      controls.enableRotate = true;
      controls.enablePan = true;
      controls.enableZoom = true;
      if (threeOverlay) threeOverlay.style.display = 'none';
      controls.update();
    });
  }

  // Rebuild 3D on UI changes (without re-running relax)
  const yarnRadiusInput = document.getElementById('yarnRadius');
  const scale3dInput = document.getElementById('scale3d');
  const detailSel = document.getElementById('detail');
  const rowHeightScaleInput = document.getElementById('rowHeightScale');

  const rebuild = () => {
    if (LAST_STATE) build3DFromYarnSim(LAST_STATE);
  };

  yarnRadiusInput?.addEventListener('input', rebuild);
  scale3dInput?.addEventListener('input', rebuild);
  detailSel?.addEventListener('input', rebuild);
  rowHeightScaleInput?.addEventListener('input', rebuild);

  (function animate() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  })();

  // expose same API as your original HTML
  window.__VK3D__ = { clear, build3DFromYarnSim };

  if (threeOverlay) {
    threeOverlay.style.display = 'flex';
    threeOverlay.textContent = '3D is ready. Click Run 3D.';
  }
}

export function clear() {
  meshes.forEach(m => {
    if (!m) return;
    scene.remove(m);
    m.geometry?.dispose?.();
    m.material?.dispose?.();
  });
  meshes.length = 0;
}

function computeYarnRadius3D(state) {
  const uiScale = CTX.getYarnRadiusScale();
  const yarnWidth = Math.max(0.001, state?.yarnWidth ?? 8);
  const canvasW = Math.max(1, state?.canvasWidth ?? 1);
  const canvasH = Math.max(1, state?.canvasHeight ?? 1);
  const STITCH_RATIO = 5 / 3;
  const YARN_RATIO = 0.24;
  const refStitchWidth = Math.min(
    (canvasW * 0.9),
    (canvasH * 0.9) * STITCH_RATIO
  );
  const refYarnWidth = refStitchWidth * YARN_RATIO;

  const pattern = CTX.getAppPattern?.() || {};
  const rows = Array.isArray(pattern.rows) ? pattern.rows : [];
  const totalRows = Math.max(1, rows.length);
  const maxSts = rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 1);
  const rowFactor = Math.pow(totalRows / 1, 0.29);
  const colFactor = Math.pow(maxSts / 1, 0.35);
  const sizeFactor = Math.max(1.0, rowFactor * colFactor);

  const targetFactor = Math.pow(refYarnWidth / yarnWidth, 0.8);
  const growOnlyFactor = 1.0;
  const combined = Math.min(growOnlyFactor * sizeFactor, 100.0);

  const baseRadius = (yarnWidth * 0.5) * combined;
  return baseRadius * uiScale;
}

function adjustCameraForPattern(totalRows, maxSts, nodes) {
  if (!camera || !controls) return;
  const baseCols = 12;
  const baseRows = 18;
  const colScale = Math.min(2.0, Math.max(0, (maxSts - baseCols) / baseCols));
  const rowScale = Math.min(2.2, Math.max(0, (totalRows - baseRows) / baseRows));
  const zScale = Math.max(colScale, rowScale);

  let centerX = 0.0;
  let centerY = 0.0;
  let extentZ = zScale;
  if (Array.isArray(nodes) && nodes.length) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    nodes.forEach((n) => {
      if (!Number.isFinite(n?.x) || !Number.isFinite(n?.y)) return;
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    });
    if (Number.isFinite(minX) && Number.isFinite(maxX)) {
      centerX = (minX + maxX) / 2;
    }
    if (Number.isFinite(minY) && Number.isFinite(maxY)) {
      centerY = (minY + maxY) / 2;
    }
    const spanX = Number.isFinite(minX) && Number.isFinite(maxX) ? (maxX - minX) : 0;
    const spanY = Number.isFinite(minY) && Number.isFinite(maxY) ? (maxY - minY) : 0;
    extentZ = Math.max(zScale, (Math.max(spanX, spanY) * 0.008));
  }

  const x = centerX * CTX.getScale3D();
  const y = centerY * CTX.getScale3D();
  const z = 3.0 + extentZ * 7.0;

  camera.position.set(x, y, z);
  camera.rotation.set(0, 0, 0);
  controls.target.set(x, y, 0);
  controls.update();
  controls.saveState();
  controls.update();
}

function computeVisualZ({ layer, row, cnType, cn, radiusPx }) {
  const zStep = radiusPx * 3.3;
  const wobble = radiusPx * 0.55;
  const hl = (cnType && cnType[1] === 'H') ? +0.35 : -0.35;

  let z = 0;
  if (layer === 'front') z += zStep;
  else if (layer === 'back') z -= zStep;

  z += hl * wobble;
  z += (row % 2 === 0 ? +1 : -1) * (wobble * 0.45);

  if (cn === 'ECN') z -= wobble * 0.75;
  if (cn === 'UACN') z += wobble * 0.35;

  return z;
}

function colorForYarnPoint(p) {
  const rows = NORMALIZED_ROWS ?? CTX.getAppPattern().rows;
  const { nodes } = LAST_STATE || {};
  if (!p || !nodes) return CTX.getYarnColor();

  const node = nodes[p.cnIndex];
  if (!node) return CTX.getYarnColor();

  const cnI = node.i;
  const cnJ = node.j;

  const totalRows = rows.length;

  const patternRow = cnJ - Y_PADDING;
  const visualRow = patternRow;

  const patternCol = Math.floor((cnI - X_PADDING * 2) / 2);
  const rowData = rows?.[visualRow];
  const resolvedCol = resolveRowCol(rowData, patternCol);

  return rowData?.[resolvedCol]?.color
  ?? BASE_YARN_COLOR;
}
function zFromLink(link, radiusPx) {
  if (!link) return 0;

  // layer ?????????
  let z = 0;
  // no layer offset

  // linkType ???? loop ???
  if (link.isCrossing) {
    z += (link.layer === 'front' ? +1 : -1) * radiusPx * 0.1;
  }

  return z;
}
function resolveRowCol(rowData, col) {
  if (!rowData || !Number.isFinite(col) || col < 0) return col;
  let count = -1;
  for (let i = 0; i < rowData.length; i++) {
    const st = rowData[i];
    if (!st || st.type === 'dec_pad') continue;
    count += 1;
    if (count === col) return i;
  }
  return col;
}
function resolveRowFace(rowData, resolvedCol) {
  if (!rowData || !Number.isFinite(resolvedCol)) return 'knit';
  const direct = rowData[resolvedCol]?.type;
  if (direct === 'purl' || direct === 'knit') return direct;
  const isFace = (t) => t === 'purl' || t === 'knit';
  for (let offset = 1; offset < rowData.length; offset++) {
    const left = rowData[resolvedCol - offset]?.type;
    if (isFace(left)) return left;
    const right = rowData[resolvedCol + offset]?.type;
    if (isFace(right)) return right;
  }
  return 'knit';
}
function getStitchColor(row, col) {
  const rowsData = NORMALIZED_ROWS ?? CTX.getAppPattern().rows;
  const rows = rowsData.length;

  // ?? 2D ????????????????? visualRow
  const visualRow = row;

  const rowData = rowsData?.[visualRow];
  const resolvedCol = resolveRowCol(rowData, col);

  return rowData?.[resolvedCol]?.color
    ?? BASE_YARN_COLOR;
}

function colorForLink(link) {
  if (!link) return CTX.getYarnColor();

  const row = link.row;
  const col = link.col ?? 0;

  // miss ?????锟斤�???????????
  return getStitchColor(row, col);
}
function linkForPointIndex(state, pointIndex) {
  const links = state?.yarnPathLinks || [];
  if (!links.length) return null;
  // YarnModel ?????link[k] connects path[k] -> path[k+1]
  const k = Math.max(0, Math.min(links.length - 1, pointIndex - 1));
  return links[k];
}
// ===============================
// ?? True loop ?锟斤�??????????????
// ===============================
function isTrueLoopLink(link) {
  if (!link) return false;
  if (link.isCrossing === false) return false;

  // knit crossing ??锟斤�??????loop
  return link.isCrossing === true;
}


// ?锟斤�???????锟斤�?column jump??
function isColumnJump(state, i) {
  if (i <= 0) return false;
  const a = state.yarnPath[i - 1];
  const b = state.yarnPath[i];
  return a?.i !== b?.i;
}

  export function build3DFromYarnSim(state) {
    LAST_STATE = state;
    if (!BASE_YARN_COLOR) BASE_YARN_COLOR = CTX.getYarnColor();
    clear();
    apply3DTheme();
    function zPxForPoint(state, p, pointIndex, radiusPx) {
  // ===============================
  // 1?? ????????????锟斤�?
  // ===============================
  let z = 0;

  // ?????????? link??path[k] -> path[k+1]??
  let link = linkForPointIndex(state, pointIndex);

  const allowLoop = isTrueLoopLink(link);
  const jump = isColumnJump(state, pointIndex);

  // ===============================
  // 2?? ???? Z ??????????????锟斤�?
  // ===============================
  if (allowLoop) {
    z += radiusPx * 0.4;
  }

  if (jump) {
    z -= radiusPx * 0.2;
  }

  // ===============================
  // 3?? Column jump ????
  // crossing + column jump ??????
  // ===============================
  if (jump && link?.isCrossing) {
    link = null;
  }

  // ===============================
  // 4?? Crossing ??锟斤�????????
  // ===============================
  if (
    !link?.isCrossing &&
    pointIndex > 0 &&
    !jump
  ) {
    const prevLink = linkForPointIndex(state, pointIndex - 1);
    if (prevLink?.isCrossing) {
      link = prevLink;
    }
  }

  // ===============================
  // 5?? Link ???????????
  // ===============================
  if (link) {
    z = zFromLink(link, radiusPx);
  }

  // ===============================
  // 6?? Crossing ????????????????
  // ===============================
  if (link?.isCrossing) {
    const over =
      link.crossSign ??
      (link.layer === 'front' ? +1 : -1);

    z = over * radiusPx * 0.2;
  }

  // ===============================
  // 7?? Head / Leg ???????????
  // ===============================
  if (p?.cnType) {
    const hl = p.cnType[1] === 'H' ? +1 : -1;
    z += hl * radiusPx * 0.12;
  }

  // ===============================
  // 8?? Stitch face bias by point type
  // ===============================
  if (p?.cnType) {
    const st = state.nodes?.[p.cnIndex]?.st;
    const isK = st === 'K' || st === 'Y';
    const isP = st === 'P';
    if (isK || isP) {
      const cn = p.cnType;
      const bias = radiusPx * 1.0;
      if (isP) {
        // Purl: FBa/FBb back, LHa front, LHb back.
        if (cn.startsWith('FB') || cn === 'LHb') z -= bias;
        else if (cn === 'LHa') z += bias;
      } else {
        // Knit: FB back, LH front.
        if (cn.startsWith('FB')) z -= bias;
        else if (cn.startsWith('LH')) z += bias;
      }
    }
  }

  // ===============================
  // 9?? ????锟斤�?????????
  // ===============================
  const Z_MAX = radiusPx * 2.5;
  z = Math.max(-Z_MAX, Math.min(Z_MAX, z));

  return z;
}



  const { nodes, yarnPath } = state || {};
  if (!nodes || !yarnPath || yarnPath.length < 8) return;

  const { X_PADDING, Y_PADDING } = CTX.getPadding();
  const pxToWorld = CTX.getScale3D();
  const radiusPx = computeYarnRadius3D(state);
  const radiusWorld = radiusPx * pxToWorld;

  let maxI = -1;
  let maxJ = -1;
  nodes.forEach((n) => {
    if (Number.isFinite(n.i)) maxI = Math.max(maxI, n.i);
    if (Number.isFinite(n.j)) maxJ = Math.max(maxJ, n.j);
  });
  const gridWidth = Math.max(1, maxI + 1);
  const gridHeight = Math.max(1, maxJ + 1);

  let xSum = 0;
  let xCount = 0;
  let ySum = 0;
  let yCount = 0;
  for (let j = 0; j < gridHeight; j++) {
    const rowBase = j * gridWidth;
    for (let i = 0; i < gridWidth; i++) {
      const idx = rowBase + i;
      const node = nodes[idx];
      if (!node) continue;
      if (i + 1 < gridWidth) {
        const right = nodes[idx + 1];
        if (right && right.j === j) {
          xSum += Math.abs(right.x - node.x);
          xCount += 1;
        }
      }
      if (j + 1 < gridHeight) {
        const up = nodes[idx + gridWidth];
        if (up && up.i === i) {
          ySum += Math.abs(up.y - node.y);
          yCount += 1;
        }
      }
    }
  }
  const xSpacing = xCount ? (xSum / xCount) : 1;
  const ySpacing = yCount ? (ySum / yCount) : 1;
  const stitchRatio = 1;
  const fixedSpacing = 100;
  const derivedRowSpacing = (fixedSpacing * 1) / stitchRatio;
  const rowSpacing = Number.isFinite(derivedRowSpacing)
    ? derivedRowSpacing
    : (Number.isFinite(state?.stitchHeight) ? state.stitchHeight : ySpacing);
  const minNodeY = nodes.reduce(
    (min, n) => (Number.isFinite(n?.y) ? Math.min(min, n.y) : min),
    Infinity
  );
  const baseRowY0 = Number.isFinite(minNodeY) ? minNodeY : 0;
  const rowBaseY = (rowIndex) => baseRowY0 + rowIndex * rowSpacing;

  const RawPattern = CTX.getAppPattern();
  const normalized = normalizeAppPattern(RawPattern);
  NORMALIZED_ROWS = normalized.rows;
  const AppPattern = { ...RawPattern, rows: NORMALIZED_ROWS };
  const totalRows = AppPattern.rows.length;
  const rowsData = NORMALIZED_ROWS ?? AppPattern.rows;
  const maxSts = rowsData.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 1);
  adjustCameraForPattern(totalRows, maxSts, state?.nodes);
  const rowIndexForPath = new Array(state.yarnPath.length);
  const stitchOpacityForPath = new Array(state.yarnPath.length).fill(1);
  const stitchScaleForPath = new Array(state.yarnPath.length).fill(1);
  const rowThicknessMap = CTX.getRowThickness?.() || {};
  const rowScaleForRow = (rowIdx) => {
    const v = rowThicknessMap?.[rowIdx];
    return Number.isFinite(v) ? v : 1.0;
  };
  const rowScaleForPath = new Array(state.yarnPath.length).fill(1.0);
  const stitchKeys = state.yarnPath.map((p, i) => {
    const node = state.nodes[p.cnIndex];
    if (!node) {
      const link = linkForPointIndex(state, i);
      const linkRow = Number.isFinite(link?.row) ? link.row : null;
      rowIndexForPath[i] = (linkRow !== null && linkRow >= 0 && linkRow < totalRows) ? linkRow : null;
      if (Number.isFinite(linkRow)) {
        rowScaleForPath[i] = rowScaleForRow(linkRow);
      }
      if (Number.isFinite(link?.row) && Number.isFinite(link?.col)) {
        const visualRow = link.row;
        const rowData = AppPattern.rows?.[visualRow];
        const resolvedCol = resolveRowCol(rowData, link.col);
        if (rowData && resolvedCol >= 0 && rowData[resolvedCol] && rowData[resolvedCol].type !== 'dec_pad') {
          const st = rowData[resolvedCol];
          stitchOpacityForPath[i] = Number.isFinite(st?.opacity) ? st.opacity : 1;
          stitchScaleForPath[i] = Number.isFinite(st?.thickness) ? st.thickness : 1;
          return `${visualRow}:${resolvedCol}`;
        }
      }
      return null;
    }

    const row = Number.isFinite(p.row) ? p.row : (node.j - Y_PADDING);
    if (row < 0 || row >= totalRows) {
      rowIndexForPath[i] = null;
      return null;
    }
    rowIndexForPath[i] = row;
    rowScaleForPath[i] = rowScaleForRow(row);
    const col = Math.floor((node.i - X_PADDING * 2) / 2);

    const visualRow = row;
    const rowData = AppPattern.rows?.[visualRow];
    const resolvedCol = resolveRowCol(rowData, col);
    if (!rowData || resolvedCol < 0 || resolvedCol >= rowData.length || !rowData[resolvedCol] || rowData[resolvedCol].type === 'dec_pad') return null;
    const st = rowData[resolvedCol];
    stitchOpacityForPath[i] = Number.isFinite(st?.opacity) ? st.opacity : 1;
    stitchScaleForPath[i] = Number.isFinite(st?.thickness) ? st.thickness : 1;
    return `${visualRow}:${resolvedCol}`;
  });

  const resolvedStitchKeys = stitchKeys.slice();
  const resolvedStitchOpacity = stitchOpacityForPath.slice();
  const resolvedStitchScale = stitchScaleForPath.slice();
  const resolvedRowScale = rowScaleForPath.slice();

  let start = 0;
  while (start < resolvedStitchKeys.length) {
    const rowIndex = rowIndexForPath[start];
    let end = start;
    while (end + 1 < resolvedStitchKeys.length && rowIndexForPath[end + 1] === rowIndex) {
      end++;
    }

    if (rowIndex !== null && rowIndex !== undefined) {
      let firstKeyIndex = -1;
      for (let i = start; i <= end; i++) {
        if (resolvedStitchKeys[i]) { firstKeyIndex = i; break; }
      }

      if (firstKeyIndex !== -1) {
        const firstKey = resolvedStitchKeys[firstKeyIndex];
        const firstOpacity = resolvedStitchOpacity[firstKeyIndex];
        const firstScale = resolvedStitchScale[firstKeyIndex];
        const firstRowScale = resolvedRowScale[firstKeyIndex];
        for (let i = start; i < firstKeyIndex; i++) resolvedStitchKeys[i] = firstKey;
        for (let i = start; i < firstKeyIndex; i++) resolvedStitchOpacity[i] = firstOpacity;
        for (let i = start; i < firstKeyIndex; i++) resolvedStitchScale[i] = firstScale;
        for (let i = start; i < firstKeyIndex; i++) resolvedRowScale[i] = firstRowScale;
        for (let i = firstKeyIndex + 1; i <= end; i++) {
          if (!resolvedStitchKeys[i]) {
            resolvedStitchKeys[i] = resolvedStitchKeys[i - 1];
            resolvedStitchOpacity[i] = resolvedStitchOpacity[i - 1];
            resolvedStitchScale[i] = resolvedStitchScale[i - 1];
            resolvedRowScale[i] = resolvedRowScale[i - 1];
          }
        }
      }
    }

    start = end + 1;
  }

  const firstGlobalKeyIndex = resolvedStitchKeys.findIndex(k => k);
  if (firstGlobalKeyIndex === -1) {
    resolvedStitchKeys.fill('0:0');
    resolvedStitchOpacity.fill(1);
    resolvedStitchScale.fill(1);
    resolvedRowScale.fill(1);
  }
  const stitchCount = rowsData.reduce((sum, row) => {
    if (!Array.isArray(row)) return sum;
    for (let i = 0; i < row.length; i++) {
      const st = row[i];
      if (!st || st.type === 'dec_pad' || st.type === 'space') continue;
      sum += 1;
    }
    return sum;
  }, 0);
  const isMissAt = (row, col) => {
    if (!Number.isFinite(row) || !Number.isFinite(col)) return false;
    const visualRow = row;
    if (visualRow < 0 || visualRow >= rowsData.length) return false;
    const rowData = rowsData[visualRow];
    const resolvedCol = resolveRowCol(rowData, col);
    return rowData?.[resolvedCol]?.type === 'miss';
  };
  const isMissAtUi = (row, col) => {
    if (!Number.isFinite(row) || !Number.isFinite(col)) return false;
    if (row < 0 || row >= rowsData.length) return false;
    const rowData = rowsData[row];
    const resolvedCol = resolveRowCol(rowData, col);
    return rowData?.[resolvedCol]?.type === 'miss';
  };
  const isSpacePoint = (row, col) => {
    if (!Number.isFinite(row) || !Number.isFinite(col)) return false;
    const visualRow = row;
    if (visualRow < 0 || visualRow >= rowsData.length) return false;
    const rowData = rowsData[visualRow];
    if (!rowData) return false;
    const resolvedCol = resolveRowCol(rowData, col);
    if (!Number.isFinite(resolvedCol) || resolvedCol < 0 || resolvedCol >= rowData.length) return false;
    return rowData[resolvedCol]?.type === 'space';
  };
  const missLiftForBaseRow = (row, col) => {
    if (!Number.isFinite(row) || !Number.isFinite(col)) return 0;
    const uiRow = row;
    if (isMissAtUi(uiRow, col)) return 0;
    let lift = 0;
    for (let r = uiRow + 1; r < totalRows; r++) {
      if (isMissAtUi(r, col)) lift += 1;
      else break;
    }
    return lift;
  };
  const originRowForPoint = (p, node) =>
    Number.isFinite(p?.row) ? p.row : (node?.j - Y_PADDING);
  const originYForPoint = (p, node) => {
    const row = originRowForPoint(p, node);
    if (!Number.isFinite(row)) return node.y;
    const headOffsetRows = p?.cnType?.[1] === 'H' ? 1 : 0;
    const col = Math.floor((node.i - X_PADDING * 2) / 2);
    let liftRows = 0;
    if (headOffsetRows) {
      liftRows = missLiftForBaseRow(row, col);
    }
    return rowBaseY(row + headOffsetRows + liftRows);
  };
  const rowHeightScale = (CTX.getRowHeightScale ? CTX.getRowHeightScale() : 1.5);
  const scaleY = (y) => y * rowHeightScale;

  // find minY to lift to ground
  let minY = Infinity;

  for (let i = 0; i < yarnPath.length; i++) {
    const p = yarnPath[i];
    const node = nodes[p.cnIndex];
    if (!node) continue;

    const link = linkForPointIndex(state, i);
    if (!isTrueLoopLink(link)) continue;

    const ny = p.normal?.[1] ?? 0;
    const baseY = originYForPoint(p, node);
    const y = scaleY(baseY + ny * radiusPx * 0.5) * pxToWorld;

    if (y < minY) minY = y;
  }

  if (!Number.isFinite(minY)) minY = 0;

  const rowInfo = Array.from({ length: totalRows }, () => ({
    len: 1,
    displayLen: 1,
    simToDisplay: null,
    decPairs: null,
    yoCols: [],
    decCols: [],
    colInfo: [],
    decSet: null,
    decMeta: null,
    decSideByCol: null,
    decShift: null,
    mergeShift: null,
    mapLeft: null,
    mapRight: null,
    minX: Infinity,
    maxX: -Infinity,
    spacing: 0,
    left: 0,
    right: 0,
    leadingSpaces: 0
  }));
  let yoLeftOnly = false;
  let yoRightOnly = false;
  let yoBothSides = false;

  AppPattern.rows.forEach((row, vr) => {
    let leadingSpaces = 0;
    for (let i = 0; i < (row?.length || 0); i++) {
      const st = row[i];
      if (!st || st.type !== 'space') break;
      leadingSpaces += 1;
    }

    let len = 0;
    const yoCols = [];
    const decCols = [];
    const decMeta = [];
    const colInfo = [];
    const rawLen = row?.length || 0;
    const rawMid = (rawLen - 1) / 2;
    for (let i = 0; i < (row?.length || 0); i++) {
      const st = row[i];
      if (!st) continue;
      if (st.type === 'dec_pad') continue;
      if (st.type === 'space') {
        colInfo.push({ type: 'space' });
        len += 1;
        continue;
      }
      if (st.type === 'yo' || st.type === 'm1') {
        yoCols.push(len);
        colInfo.push({ type: 'yo' });
        len += 1;
        continue;
      }
      if (st.type === 'k2tog' || st.type === 'ssk') {
        const side =
          st.type === 'ssk' ? -1 :
          st.type === 'k2tog' ? 1 :
          (i < rawMid ? -1 : i > rawMid ? 1 : 0);
        const anchorCol = side < 0 ? len + 1 : len;
        decCols.push(anchorCol);
        decMeta.push({ col: anchorCol, side });
        colInfo.push({ type: st.type }, { type: st.type });
        len += 2;
        const isSskPad = st.type === 'ssk' && row[i - 1]?.type === 'dec_pad';
        if (!isSskPad) i += 1;
        continue;
      }
      colInfo.push({ type: st.type });
      len += 1;
    }
    rowInfo[vr].len = Math.max(1, len);
    rowInfo[vr].yoCols = yoCols;
    rowInfo[vr].colInfo = colInfo;
    rowInfo[vr].decCols = decCols;
    rowInfo[vr].decMeta = decMeta;
    rowInfo[vr].decSet = new Set(decCols);
    const decSideByCol = new Array(rowInfo[vr].len).fill(0);
    decMeta.forEach(({ col, side }) => {
      if (col >= 0 && col < decSideByCol.length) decSideByCol[col] = side;
    });
    rowInfo[vr].decSideByCol = decSideByCol;
    let expandedCol = 0;
    const decPairs = [];
    for (let i = 0; i < (row?.length || 0); i++) {
      const st = row[i];
      if (!st) continue;
      if (st.type === 'dec_pad') continue;
      if (st.type === 'space') {
        expandedCol += 1;
        continue;
      }
      if (st.type === 'yo' || st.type === 'm1') {
        expandedCol += 1;
        continue;
      }
      if (st.type === 'k2tog' || st.type === 'ssk') {
        const side = st.type === 'ssk' ? -1 : 1;
        const anchor = side > 0 ? expandedCol : expandedCol + 1;
        const source = side > 0 ? expandedCol + 1 : expandedCol;
        decPairs.push({ simCol: expandedCol, anchor, source, side });
        expandedCol += 2;
        continue;
      }
      expandedCol += 1;
    }
    rowInfo[vr].displayLen = Math.max(1, expandedCol);
    rowInfo[vr].simToDisplay = null;
    rowInfo[vr].decPairs = decPairs;
    rowInfo[vr].overlapTarget = new Array(rowInfo[vr].len).fill(null);
    const shift = new Array(rowInfo[vr].len).fill(0);
    if (decMeta.length) {
      decMeta.forEach(({ col, side }) => {
        if (col < 0 || col >= rowInfo[vr].len) return;
        if (side < 0) {
          for (let k = 0; k < col; k++) shift[k] += 1;
        } else if (side > 0) {
          for (let k = col + 1; k < rowInfo[vr].len; k++) shift[k] -= 1;
        } else {
          for (let k = 0; k < col; k++) shift[k] += 0.5;
          for (let k = col + 1; k < rowInfo[vr].len; k++) shift[k] -= 0.5;
        }
      });
    }
    rowInfo[vr].decShift = shift;
    const mergeShift = new Array(rowInfo[vr].len).fill(0);
    decMeta.forEach(({ col, side }) => {
      if (side > 0) {
        if (col >= 0 && col < mergeShift.length) mergeShift[col] -= 1;
      } else if (side < 0) {
        const prev = col - 1;
        if (prev >= 0 && prev < mergeShift.length) mergeShift[prev] += 1;
      }
    });
    rowInfo[vr].mergeShift = mergeShift;
    decPairs.forEach(({ source, anchor }) => {
      if (source >= 0 && source < rowInfo[vr].overlapTarget.length) {
        rowInfo[vr].overlapTarget[source] = anchor;
      }
    });
    rowInfo[vr].leadingSpaces = leadingSpaces;

    // Track YO side distribution for anchoring
    if (yoCols.length) {
      const midLen = (len - 1) / 2;
      const allLeft = yoCols.every(c => c < midLen);
      const allRight = yoCols.every(c => c > midLen);
      if (allLeft) yoLeftOnly = true;
      else if (allRight) yoRightOnly = true;
      else yoBothSides = true;
    }
  });

  nodes.forEach((n) => {
    const patternRow = n.j - Y_PADDING;
    const vr = patternRow;
    if (vr < 0 || vr >= totalRows) return;
    const col = Math.floor((n.i - X_PADDING * 2) / 2);
    const len = Math.max(rowInfo[vr].len, rowInfo[vr].displayLen ?? 0);
    if (col < 0 || col >= len) return;
    const info = rowInfo[vr];
    info.minX = Math.min(info.minX, n.x);
    info.maxX = Math.max(info.maxX, n.x);
 });

  // Use a fixed spacing anchor so adding rows does not shift previous rows.
  const spacing0 = fixedSpacing;
  const baseSpacing = spacing0;

    if (totalRows > 0) {
      const bottomIndex = totalRows - 1;
      const bottom = rowInfo[bottomIndex];
      const bottomLen = Math.max(bottom.len, bottom.displayLen ?? 0);
      bottom.left = 0;
      bottom.right = bottom.left + (bottomLen - 1) * spacing0;
      bottom.mapLeft = bottom.left;
      bottom.mapRight = bottom.right;
      bottom.spacing = spacing0;

      let baseLeft = bottom.left;
      let baseRight = bottom.right;

      for (let vr = bottomIndex - 1; vr >= 0; vr--) {
        const info = rowInfo[vr];
        const spacing = spacing0;
        const len = info.len;
        const prev = rowInfo[vr + 1];
        const leadingDiff = 0;
        const mapLeft = baseLeft + leadingDiff * spacing;
        const mapRight = mapLeft + (len - 1) * spacing;

        info.left = mapLeft;
        info.right = mapRight;
        info.mapLeft = mapLeft;
        info.mapRight = mapRight;
        baseLeft = mapLeft;
        baseRight = mapRight;
        info.spacing = spacing;
      }
    }

  const debugPointsByRow = Array.from({ length: totalRows }, () => []);
  const pts = [];
  const ptsPathIndex = [];
  const ptsSegIndex = [];
// Legacy true-loop stitchKey mapping (kept for reference; not used)
// const keysForPts = []; // ?????????? pts ???????stitchKey

const pathIndexForPts = [];
const pointBaseX = [];
const pointBaseY = [];
const pointRow = [];
const pointLayoutRow = [];
const pointCol = [];
const pointDisplayCol = [];
const pointPatternRow = [];
const pointPatternCol = [];
  const pointIsHeadNode = [];
  const pointNode = [];
  const pointNx = [];
  const pointNy = [];
  const pointZ = [];
  let lastFHbendSign = null;

let debugKPoints = [];
let debugKRow = null;
let debugKCount = 0;
let debugKLogged = false;

let currentStitchBaseX = null;
let currentStitchWidth = null;
let lastStitchBaseX = null;
let lastStitchRow = null;
let lastRowEndPreX = null;
const rowStartSeen = new Set();
const stitchBaseXByRow = new Map();
const stitchWidthByRow = new Map();
const rowEndPreXByRow = new Map();


  for (let i = 0; i < yarnPath.length; i++) {
    const p = yarnPath[i];
    const node = nodes[p.cnIndex];
    if (!node) continue;

    const nx = p.normal?.[0] ?? 0;
    const ny = p.normal?.[1] ?? 0;

    const zPx = zPxForPoint(state, p, i, radiusPx);

    const originRow = originRowForPoint(p, node);
    const baseY = originYForPoint(p, node);
    const patternRow = Number.isFinite(originRow) ? originRow : (node.j - Y_PADDING);
    const visualRow = patternRow;
    const layoutRow = patternRow;
    const patternCol = Math.floor((node.i - X_PADDING * 2) / 2);
    if (p?.cnType === 'FBa') {
      // debug hook removed
    }

  const link = linkForPointIndex(state, i);

  let baseX = node.x;
  let colIndex = patternCol;
  let displayCol = colIndex;
  if (layoutRow >= 0 && layoutRow < rowInfo.length) {
    const info = rowInfo[layoutRow];
    const mapLeft = Number.isFinite(info.mapLeft) ? info.mapLeft : info.left;
    const mapRight = Number.isFinite(info.mapRight) ? info.mapRight : info.right;
    const spacing = info.spacing || baseSpacing;
    colIndex = patternCol;
    displayCol = info.simToDisplay?.[colIndex] ?? colIndex;
    baseX = mapLeft + colIndex * spacing;
    const displayLen = info.displayLen || info.len || 1;
    const displaySpacing = (mapRight - mapLeft) / Math.max(1, displayLen - 1);
    const displayShift = displayCol - colIndex;
    if (displayShift) baseX += displaySpacing * displayShift;
    const segShift = info.decShift?.[colIndex] ?? 0;
    if (segShift) baseX += spacing * segShift;
    // Collect debug info for CN positions after mapping
    debugPointsByRow[layoutRow].push({
      cnIndex: p.cnIndex,
      i: node.i,
      j: node.j,
      row: layoutRow,
      col: colIndex,
      displayCol,
      baseX: Number(baseX.toFixed(2)),
      nodeX: Number(node.x.toFixed(2)),
      mapLeft: Number(mapLeft.toFixed(2)),
      mapRight: Number(mapRight.toFixed(2)),
      spacing: Number(spacing.toFixed(2)),
    });
    // dec stitch itself no extra offset; only segment shift applies
  }

  const cnType = p?.cnType || '';
  const side = cnType[0] || '';
  const layer = cnType[1] || '';
  const order = cnType[2] || '';
  const rowIndex = Number.isFinite(p?.row) ? p.row : null;
    const movingRight = (rowIndex !== null) ? (rowIndex % 2 === 0) : true;
  const dir = movingRight ? 1 : -1;
  const isHeadNode = layer === 'H';
  const currSt = nodes[p.cnIndex]?.st;
  // Simulation nodes use uppercase "Y" for make-one/YO; also accept UI lowercase.
  const isYO = currSt === 'yo' || currSt === 'm1' || currSt === 'Y';

  const stitchWidthLocal = currentStitchWidth || baseSpacing;
  const offset = 0.12 * stitchWidthLocal;

  if (layer === 'B' && side === 'F' && order === 'a') {
    const info = (layoutRow >= 0 && layoutRow < rowInfo.length) ? rowInfo[layoutRow] : null;
    const w = isYO ? ((info?.spacing || baseSpacing) * 1.0) : (info?.spacing || baseSpacing);
    if (rowIndex !== null) {
      const isFirstInRow = !rowStartSeen.has(rowIndex);
      if (isFirstInRow) {
        rowStartSeen.add(rowIndex);
        const prevRowEnd = rowEndPreXByRow.get(rowIndex - 1);
        if (Number.isFinite(prevRowEnd)) {
          baseX = prevRowEnd;
        }
      } else {
        const lastRowBase = stitchBaseXByRow.get(rowIndex);
        if (Number.isFinite(lastRowBase)) baseX = lastRowBase + dir * w;
      }
    } else if (
      lastStitchBaseX !== null
    ) {
      baseX = lastStitchBaseX + dir * w;
    }
    currentStitchBaseX = baseX;
    currentStitchWidth = w;
    lastStitchBaseX = baseX;
    lastStitchRow = rowIndex;
    if (rowIndex !== null) {
      stitchBaseXByRow.set(rowIndex, baseX);
      stitchWidthByRow.set(rowIndex, w);
    }
  }

  if (layer === 'B' && side === 'F' && order === 'b' && currentStitchBaseX !== null) {
    const w = rowIndex !== null ? (stitchWidthByRow.get(rowIndex) || currentStitchWidth || baseSpacing) : (currentStitchWidth || baseSpacing);
    const rowBase = rowIndex !== null ? (stitchBaseXByRow.get(rowIndex) ?? currentStitchBaseX) : currentStitchBaseX;
    if (rowBase !== null) baseX = rowBase + dir * (w - 2 * offset);
    lastRowEndPreX = baseX;
    if (rowIndex !== null) {
      const nextRow = Number.isFinite(yarnPath[i + 1]?.row) ? yarnPath[i + 1].row : null;
      const isPaddingFb = nextRow !== null && nextRow !== rowIndex;
      if (isPaddingFb) {
        rowEndPreXByRow.set(rowIndex, baseX);
      }
    }
  }

  if (layer === 'H' && side === 'L' && currentStitchBaseX !== null) {
    const w = rowIndex !== null ? (stitchWidthByRow.get(rowIndex) || currentStitchWidth || baseSpacing) : (currentStitchWidth || baseSpacing);
    const rowBase = rowIndex !== null ? (stitchBaseXByRow.get(rowIndex) ?? currentStitchBaseX) : currentStitchBaseX;
    const half = 0.5 * w;
    if (order === 'a') {
      if (rowBase !== null) baseX = rowBase + dir * half ;
    } else if (order === 'b') {
      if (rowBase !== null) baseX = rowBase + dir * (half + w - 2 * offset);
    }
  }

  if (!debugKLogged) {
    if (cnType === 'FBa') {
      debugKPoints = [{ cnType, x: baseX, y: baseY, z: zPx, i: node.i, j: node.j }];
      debugKRow = Number.isFinite(p?.row) ? p.row : null;
    } else if (debugKPoints.length > 0) {
      if (debugKRow !== null && p?.row === debugKRow) {
        const expected = ['FBb', 'LHa', 'LHb'][debugKPoints.length - 1];
        if (cnType === expected) {
          debugKPoints.push({ cnType, x: baseX, y: baseY, z: zPx, i: node.i, j: node.j });
          if (debugKPoints.length === 4) {
            debugKCount += 1;
            if (debugKCount >= 2) {
              debugKLogged = true;
            }
          }
        } else if (cnType === 'FBa') {
          debugKPoints = [{ cnType, x: baseX, y: baseY, z: zPx, i: node.i, j: node.j }];
          debugKRow = Number.isFinite(p?.row) ? p.row : null;
        } else {
          debugKPoints = [];
          debugKRow = null;
        }
      } else {
        debugKPoints = [];
        debugKRow = null;
      }
    }
  }
  pointBaseX.push(baseX);
  pointBaseY.push(baseY);
  pointRow.push(visualRow);
  pointLayoutRow.push(layoutRow);
  pointCol.push(colIndex);
  pointDisplayCol.push(displayCol);
  pointPatternRow.push(patternRow);
  pointPatternCol.push(patternCol);
  pointIsHeadNode.push(isHeadNode);
  pointNode.push(node);
  pointNx.push(nx);
  pointNy.push(ny);
  pointZ.push(zPx);
  pathIndexForPts.push(i);

  // stitchKey mapping for yarn color
  // Legacy true-loop stitchKey mapping (kept for reference; not used)
  /*
  // ??? link.row/link.col ????stitch??????? node.i/node.j ???
  if (isTrueLoopLink(link)) {
    const rowsN = CTX.getAppPattern().rows.length;

    const row = Number.isFinite(link.row) ? link.row : 0;
    const col = Number.isFinite(link.col) ? link.col : 0;

    // 2D ?????????3D ??? visualRow ????
    const visualRow = row;

    keysForPts.push(`${visualRow}:${col}`);
  } else {
    keysForPts.push(null);
  }
  */


}

// Overlap handling: keep 3-column logic, tilt/stack the second head onto the first for decreases.
const headPos = rowInfo.map(() => ({}));
for (let i = 0; i < pointBaseX.length; i++) {
  if (!pointIsHeadNode[i]) continue;
  const vr = pointLayoutRow[i];
  const col = pointCol[i];
  if (vr < 0 || vr >= rowInfo.length) continue;
  headPos[vr][col] = { x: pointBaseX[i], z: pointZ[i] };
}

const HEAD_OVERLAP_Z = radiusPx * 1.0;
const HEAD_OVERLAP_X_RATIO = 1.0;

for (let i = 0; i < pointBaseX.length; i++) {
  if (!pointIsHeadNode[i]) continue;
  const vr = pointLayoutRow[i];
  const col = pointCol[i];
  const info = rowInfo[vr];
  if (!info) continue;
  const target = info.overlapTarget?.[col];
  if (target === null || target === undefined) continue;

  const anchor = headPos[vr]?.[target];
  if (!anchor) continue;

  const dx = (anchor.x - pointBaseX[i]) * HEAD_OVERLAP_X_RATIO;
  pointBaseX[i] += dx;
  pointZ[i] = anchor.z + HEAD_OVERLAP_Z;
}

  const segVr = [];
  const segCol = [];
  const segIsHead = [];
  const segBaseX = [];
  for (let i = 0; i < pointBaseX.length - 1; i++) {
    const isHeadSeg = pointIsHeadNode[i] && pointIsHeadNode[i + 1];
    const pathIndex = pathIndexForPts[i + 1] ?? (i + 1);
    const link = linkForPointIndex(state, pathIndex);
    const linkRow = Number.isFinite(link?.row) ? link.row : null;
    let vr = Number.isFinite(linkRow) ? linkRow : pointLayoutRow[i];
    const baseX = (pointBaseX[i] + pointBaseX[i + 1]) * 0.5;

    let col = Number.isFinite(link?.col) ? link.col : pointDisplayCol[i];
    const currRow = Number.isFinite(yarnPath[pathIndex]?.row) ? yarnPath[pathIndex].row : null;
    const prevRow = Number.isFinite(yarnPath[pathIndex - 1]?.row) ? yarnPath[pathIndex - 1].row : null;
    if (prevRow !== null && currRow !== null && currRow !== prevRow) {
      vr = prevRow;
      if (i > 0 && Number.isFinite(segCol[i - 1])) {
        col = segCol[i - 1];
      }
    }
    const info = (vr >= 0 && vr < rowInfo.length) ? rowInfo[vr] : null;
    if (info) {
      const displayLen = info.displayLen || info.len || 1;
      const mapLeft = Number.isFinite(info.mapLeft) ? info.mapLeft : info.left;
      const mapRight = Number.isFinite(info.mapRight) ? info.mapRight : info.right;
      const displaySpacing = (mapRight - mapLeft) / Math.max(1, displayLen - 1);
      if (displaySpacing > 0) {
        col = Math.round((baseX - mapLeft) / displaySpacing);
        col = Math.max(0, Math.min(displayLen - 1, col));
      }
    }

    segVr.push(vr);
    segCol.push(col);
    segIsHead.push(isHeadSeg);
    segBaseX.push(baseX);
  }

  const headSum = rowInfo.map(info => new Array(info.displayLen || info.len).fill(0));
  const headCount = rowInfo.map(info => new Array(info.displayLen || info.len).fill(0));
  for (let i = 0; i < segBaseX.length; i++) {
    if (!segIsHead[i]) continue;
    const vr = segVr[i];
    if (vr < 0 || vr >= rowInfo.length) continue;
    const dcol = segCol[i];
    if (dcol < 0 || dcol >= headSum[vr].length) continue;
    headSum[vr][dcol] += segBaseX[i];
    headCount[vr][dcol] += 1;
  }

  const headCenter = rowInfo.map((info, vr) => {
    const out = new Array(info.displayLen || info.len).fill(null);
    for (let col = 0; col < out.length; col++) {
      if (headCount[vr][col] > 0) {
        out[col] = headSum[vr][col] / headCount[vr][col];
      }
    }
    return out;
  });

  const mergeDelta = rowInfo.map(info => new Array(info.displayLen || info.len).fill(0));
  rowInfo.forEach((info, vr) => {
    const pairs = info.decPairs || [];
    if (!pairs.length) return;
    pairs.forEach(({ source, anchor }) => {
      if (source < 0 || anchor < 0) return;
      if (source >= mergeDelta[vr].length || anchor >= mergeDelta[vr].length) return;
      const src = headCenter[vr]?.[source];
      const tgt = headCenter[vr]?.[anchor];
      if (!Number.isFinite(src) || !Number.isFinite(tgt)) return;
      mergeDelta[vr][source] += (tgt - src);
    });
  });

  const rowMinY = rowInfo.map(() => Infinity);
  for (let i = 0; i < pointNode.length; i++) {
    const vr = pointRow[i];
    if (vr === null || vr === undefined) continue;
    if (vr < 0 || vr >= rowMinY.length) continue;
    const baseY = pointBaseY[i];
    if (!Number.isFinite(baseY)) continue;
    const yWorld = scaleY(baseY) * pxToWorld;
    if (yWorld < rowMinY[vr]) rowMinY[vr] = yWorld;
  }

  const orderedMinY = rowMinY
    .filter((y) => Number.isFinite(y))
    .slice()
    .sort((a, b) => a - b);
  const rowOrder = rowMinY
    .map((_, idx) => idx)
    .filter((idx) => Number.isFinite(rowMinY[idx]))
    ;
  const rowShift = rowMinY.map(() => 0);
  for (let i = 0; i < rowOrder.length; i++) {
    const vr = rowOrder[i];
    const target = orderedMinY[i];
    rowShift[vr] = target - rowMinY[vr];
  }

  const segMaxIndex = Math.max(0, segBaseX.length - 1);
  const CURVE_Z_RATIO = 5;
  const pushPoint = (x, y, z, nx, ny, pathIndex, segIndex, yShift) => {
    pts.push(new THREE.Vector3(
      x * pxToWorld,
      scaleY(y) * pxToWorld + (yShift || 0) - minY,
      z * pxToWorld
    ));
    ptsPathIndex.push(pathIndex);
    ptsSegIndex.push(segIndex);
  };
  const pushBreak = () => {
    if (!pts.length) return;
    if (pts[pts.length - 1] === null) return;
    pts.push(null);
    ptsPathIndex.push(null);
    ptsSegIndex.push(null);
  };

  let lastValidIndex = null;
  for (let i = 0; i < pointBaseX.length; i++) {
    const baseX = pointBaseX[i];
    const baseY = pointBaseY[i];
    const node = pointNode[i];
    const nx = pointNx[i];
    const ny = pointNy[i];
    const zPx = pointZ[i];
    const segIndex = Math.max(0, Math.min(segMaxIndex, i - 1));

    const patternRow = pointPatternRow[i];
    const patternCol = pointPatternCol[i];
    const isSpace = isSpacePoint(patternRow, patternCol);
    const currRow = yarnPath[i]?.row;
    const prevRow = lastValidIndex !== null ? yarnPath[lastValidIndex]?.row : null;
    const allowSpaceBridge =
      Number.isFinite(currRow) &&
      Number.isFinite(prevRow) &&
      currRow !== prevRow;
    if (isSpace && !allowSpaceBridge) {
      if (lastValidIndex !== null) pushBreak();
      lastValidIndex = null;
      continue;
    }

    if (lastValidIndex !== null) {
      const prevIndex = lastValidIndex;
      const prevBaseX = pointBaseX[prevIndex];
      const prevBaseY = pointBaseY[prevIndex];
      const prevNode = pointNode[prevIndex];
      const prevNx = pointNx[prevIndex];
      const prevNy = pointNy[prevIndex];
      const prevZ = pointZ[prevIndex];

      const vr = pointRow[i];
      const info = (vr >= 0 && vr < rowInfo.length) ? rowInfo[vr] : null;
      const maxStep = (info?.spacing || baseSpacing) * 2.0;
      const dx = baseX - prevBaseX;
      const dy = baseY - prevBaseY;
      const segLen = Math.hypot(dx, dy);

      const prevSide = yarnPath[prevIndex]?.cnType?.[0] ?? null;
      const currSide = yarnPath[i]?.cnType?.[0] ?? null;
      const sameSide = prevSide && prevSide === currSide;
      const sideSign = sameSide ? (prevSide === 'F' ? 1 : -1) : 0;
      const curveScale = sameSide ? Math.min(1, segLen / Math.max(1e-6, maxStep * 0.6)) : 0;
      const prevRow = yarnPath[prevIndex]?.row;
      const currRow = yarnPath[i]?.row;
      const isRowTransition =
        Number.isFinite(prevRow) &&
        Number.isFinite(currRow) &&
        prevRow !== currRow;
      const prevVr = pointRow[prevIndex];
      const currVr = pointRow[i];
      const prevShift = Number.isFinite(prevVr) ? (rowShift[prevVr] || 0) : 0;
      const currShift = Number.isFinite(currVr) ? (rowShift[currVr] || 0) : 0;
      const stitchTypeForIndex = (idx) => {
        const getSt = (p) => {
          if (!p?.cnType || !p.cnType.startsWith('FB')) return null;
          return nodes[p.cnIndex]?.st ?? null;
        };
        // Prefer current FB point, then scan backward within this row.
        let st = getSt(yarnPath[idx]);
        if (st) return st;
        const row = yarnPath[idx]?.row;
        for (let k = idx - 1; k >= 0; k--) {
          if (yarnPath[k]?.row !== row) break;
          st = getSt(yarnPath[k]);
          if (st) return st;
        }
        // Fallback: check earlier points to avoid null for row-end pads.
        for (let k = idx - 1; k >= 0 && k >= idx - 6; k--) {
          st = getSt(yarnPath[k]);
          if (st) return st;
        }
        return null;
      };
      const segSt = stitchTypeForIndex(i);
      const segKey = typeof segSt === 'string' ? segSt.toUpperCase() : segSt;
      const segLink = linkForPointIndex(state, i);
      const isMissSeg = isMissAt(segLink?.row, segLink?.col);
      const isPurlSeg = segSt === 'P';
      const purlSign = isPurlSeg ? -1 : 1;

      const prevType = yarnPath[prevIndex]?.cnType ?? '';
      const currType = yarnPath[i]?.cnType ?? '';
      const isFBaFBb = prevType === 'FBa' && currType === 'FBb';
      const isFBbLHa = prevType === 'FBb' && currType === 'LHa';
      const isFBbLHb = prevType === 'FBb' && currType === 'LHb';
      const isLHbFBa = prevType === 'LHb' && currType === 'FBa';
      const isLHaLHb = prevType === 'LHa' && currType === 'LHb';
      const isLHbLHa = prevType === 'LHb' && currType === 'LHa';

      const addMid = (t, colorPathIndex = segIndex) => {
        const midX = prevBaseX + dx * t;
        const midY = prevBaseY + dy * t;
        const midNx = prevNx + (nx - prevNx) * t;
        const midNy = prevNy + (ny - prevNy) * t;
        let midZ = prevZ + (zPx - prevZ) * t;
        if (sideSign && curveScale) {
          const shape = Math.sin(Math.PI * t);
          midZ += sideSign * radiusPx * CURVE_Z_RATIO * curveScale * shape * purlSign;
        }
        const midShift = prevShift + (currShift - prevShift) * t;
        pushPoint(midX, midY, midZ, midNx, midNy, colorPathIndex, segIndex, midShift);
      };
      const addStraightMid = (t, colorPathIndex = segIndex) => {
        const midX = prevBaseX + dx * t;
        const midY = prevBaseY + dy * t;
        const midNx = prevNx + (nx - prevNx) * t;
        const midNy = prevNy + (ny - prevNy) * t;
        const midZ = prevZ + (zPx - prevZ) * t;
        const midShift = prevShift + (currShift - prevShift) * t;
        pushPoint(midX, midY, midZ, midNx, midNy, colorPathIndex, segIndex, midShift);
      };

      if (isMissSeg) {
        addStraightMid(1 / 3);
        addStraightMid(2 / 3);
      } else if (isLHaLHb || isLHbLHa) {
        const pushSmooth = (t, zScale, yScale) => {
          const midX = prevBaseX + dx * t;
          const midY = prevBaseY + dy * t + radiusPx * yScale;
          const midNx = prevNx + (nx - prevNx) * t;
          const midNy = prevNy + (ny - prevNy) * t;
          const midZ = prevZ + (zPx - prevZ) * t + radiusPx * zScale * purlSign;
          const midShift = prevShift + (currShift - prevShift) * t;
          pushPoint(midX, midY, midZ, midNx, midNy, segIndex, segIndex, midShift);
        };
        const zScale = isPurlSeg ? -3.0 : -3.0;
        pushSmooth(1 / 3, zScale, 1.2);
        pushSmooth(2 / 3, zScale, 1.2);
     } else if (isFBbLHa || isFBbLHb || isLHbFBa) {
       const t = 0.5;
       const midX = prevBaseX + dx * t;
        const midY = prevBaseY + dy * t;
        const midNx = prevNx + (nx - prevNx) * t;
        const midNy = prevNy + (ny - prevNy) * t;
        let bendSign = isPurlSeg ? -1 : 1;
        if (isFBbLHa || isFBbLHb) {
          lastFHbendSign = bendSign;
        } else if (isLHbFBa && lastFHbendSign !== null) {
          bendSign = lastFHbendSign;
        }
        const midZ = prevZ + (zPx - prevZ) * t + radiusPx * 0.9 * bendSign;
        pushPoint(midX, midY, midZ, midNx, midNy, segIndex, segIndex, prevShift + (currShift - prevShift) * t);
     } else if (isFBaFBb) {
        // first midpoint follows previous stitch face, second follows current
        const findPrevStitchFace = () => {
          const currRow = yarnPath[i]?.row;
          for (let k = i - 2; k >= 0; k--) {
            if (yarnPath[k]?.row !== currRow) break;
            const cn = yarnPath[k]?.cnType ?? '';
            if (!cn.startsWith('FB')) continue;
            return nodes[yarnPath[k].cnIndex]?.st ?? null;
          }
          return null;
        };
        const prevFace = findPrevStitchFace();
        const prevBendSign = prevFace === 'P' ? 1 : -1;
        const bendSign = isPurlSeg ? 1 : -1; // current stitch sign
        const pushSmooth = (t, zScale, yScale) => {
          const midX = prevBaseX + dx * t;
          const midY = prevBaseY + dy * t + radiusPx * yScale;
          const midNx = prevNx + (nx - prevNx) * t;
          const midNy = prevNy + (ny - prevNy) * t;
          const sign = t <= 0.5 ? prevBendSign : bendSign;
          const midZ = prevZ + (zPx - prevZ) * t + radiusPx * zScale * sign;
          const midShift = prevShift + (currShift - prevShift) * t;
          const colorPathIndex = t <= 0.5 ? (prevIndex ?? segIndex) : i;
          pushPoint(midX, midY, midZ, midNx, midNy, colorPathIndex, segIndex, midShift);
        };
        pushSmooth(1 / 3, 3.0, -1.2);
        pushSmooth(2 / 3, 3.0, -1.2);
      } else if (Math.abs(dx) > maxStep) {
        const t1 = 1 / 3;
        const t2 = 2 / 3;
        addMid(t1);
        addMid(t2);
      } else if (sideSign) {
        addMid(0.5);
      }
    }

    const rowShiftNow = Number.isFinite(pointRow[i]) ? (rowShift[pointRow[i]] || 0) : 0;
    pushPoint(baseX, baseY, zPx, nx, ny, i, segIndex, rowShiftNow);
    lastValidIndex = i;
  }

  const segments = [];
  let segStart = null;
  for (let i = 0; i < pts.length; i++) {
    if (!pts[i]) {
      if (segStart !== null) segments.push([segStart, i]);
      segStart = null;
      continue;
    }
    if (segStart === null) segStart = i;
  }
  if (segStart !== null) segments.push([segStart, pts.length]);

  if (!segments.length) return;

  const renderSegments = [];
  const minSpanPts = 6;
  segments.forEach(([start, end]) => {
    const spans = [];
    let spanStart = start;
    let spanTransparent = null;
    let spanScale = null;
    for (let i = start; i < end; i++) {
      const pathIndex = ptsPathIndex[i] ?? pathIndexForPts[i] ?? i;
      const op = resolvedStitchOpacity[pathIndex];
      const isTransparent = Number.isFinite(op) ? op < 0.999 : false;
      const rowScale = resolvedRowScale[pathIndex] ?? 1.0;
      const stitchScale = resolvedStitchScale[pathIndex] ?? 1.0;
      const scale = rowScale * stitchScale;
      if (spanTransparent === null) {
        spanTransparent = isTransparent;
        spanScale = scale;
        spanStart = i;
        continue;
      }
      if (isTransparent !== spanTransparent || scale !== spanScale) {
        spans.push([spanStart, i, spanTransparent, spanScale]);
        spanStart = i;
        spanTransparent = isTransparent;
        spanScale = scale;
      }
    }
    if (spanTransparent !== null) spans.push([spanStart, end, spanTransparent, spanScale]);

    const merged = [];
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const len = span[1] - span[0];
      if (len < minSpanPts) {
        if (merged.length) {
          merged[merged.length - 1][1] = span[1];
          continue;
        }
        if (i + 1 < spans.length) {
          spans[i + 1][0] = span[0];
          continue;
        }
      }
      merged.push(span);
    }
    // Add a small overlap at transparency boundaries so meshes touch.
    for (let i = 0; i < merged.length - 1; i++) {
      const a = merged[i];
      const b = merged[i + 1];
      if (a[2] !== b[2] || a[3] !== b[3]) {
        const boundary = b[0];
        a[1] = Math.min(end, boundary + 1);
        b[0] = Math.max(start, a[1] - 1);
      }
    }
    merged.forEach(span => {
      if (span[0] < span[1]) renderSegments.push(span);
    });
  });

  const allPts = pts;
  const allPtsPathIndex = ptsPathIndex;
  const allPtsSegIndex = ptsSegIndex;
  // Further split spans at row-change padding FBb->FBa boundaries to isolate that segment.
  const refineForRowChange = (span) => {
    const [start, end, isTransparent, spanScale] = span;
    const out = [];
    let segStart = start;
    for (let i = start + 1; i < end; i++) {
      const idxA = allPtsPathIndex[i - 1] ?? pathIndexForPts[i - 1] ?? (i - 1);
      const idxB = allPtsPathIndex[i] ?? pathIndexForPts[i] ?? i;
      const cnA = yarnPath[idxA]?.cnType;
      const cnB = yarnPath[idxB]?.cnType;
      const rowA = rowIndexForPath[idxA] ?? yarnPath[idxA]?.row ?? null;
      const rowB = rowIndexForPath[idxB] ?? yarnPath[idxB]?.row ?? null;
      const isRowChange = cnA === 'FBb' && cnB === 'FBa' && Number.isFinite(rowA) && Number.isFinite(rowB) && rowA !== rowB;
      if (isRowChange) {
        // keep the FBb->FBa half by overlapping one point into next span
        if (i + 1 <= end) {
          out.push([segStart, i + 1, isTransparent, spanScale]);
          segStart = i;
        } else {
          out.push([segStart, i, isTransparent, spanScale]);
          segStart = i;
        }
      }
    }
    if (segStart < end) out.push([segStart, end, isTransparent, spanScale]);
    return out;
  };
  if (renderSegments.length) {
    const refinedSegments = [];
    renderSegments.forEach(span => {
      refineForRowChange(span).forEach(s => refinedSegments.push(s));
    });
    renderSegments.length = 0;
    refinedSegments.forEach(s => renderSegments.push(s));
  }
  const totalPtCount = allPts.reduce((sum, p) => sum + (p ? 1 : 0), 0);
  let debugLogged = false;

  const buildMeshForSegment = (segStart, segEnd, isTransparent, rowScale = 1.0) => {
    // slice raw arrays
    const rawPts = allPts.slice(segStart, segEnd);
    const rawPtsPathIndex = allPtsPathIndex.slice(segStart, segEnd);
    const rawPtsSegIndex = allPtsSegIndex.slice(segStart, segEnd);
    const rawLocalPathIndexForPts = pathIndexForPts.slice(segStart, segEnd);

    // Insert a duplicate point at color boundaries so vertex colors hard-split (single mesh, hard edge).
    const pts = [];
    const ptsPathIndex = [];
    const ptsSegIndex = [];
    const localPathIndexForPts = [];
    let boundaryLastKey = null;
    let boundaryLastPathIndex = null;
    let boundaryLastSegIndex = null;
    let boundaryLastLocalIdx = null;
    for (let i = 0; i < rawPts.length; i++) {
      const p = rawPts[i];
      const segIdx = rawPtsSegIndex[i];
      const pathIdx = rawPtsPathIndex[i];
      const localIdx = rawLocalPathIndexForPts[i];
      if (!p) {
        pts.push(null);
        ptsPathIndex.push(null);
        ptsSegIndex.push(null);
        localPathIndexForPts.push(null);
        boundaryLastKey = null;
        boundaryLastPathIndex = null;
        boundaryLastSegIndex = null;
        boundaryLastLocalIdx = null;
        continue;
      }
      const keyIdx = pathIdx ?? localIdx ?? i;
      const key = resolvedStitchKeys[keyIdx];
      if (boundaryLastKey && key && key !== boundaryLastKey) {
        // duplicate boundary point with previous key to ensure hard edge
        pts.push(p.clone());
        ptsPathIndex.push(boundaryLastPathIndex);
        ptsSegIndex.push(boundaryLastSegIndex);
        localPathIndexForPts.push(boundaryLastLocalIdx);
      }
      pts.push(p);
      ptsPathIndex.push(pathIdx);
      ptsSegIndex.push(segIdx);
      localPathIndexForPts.push(localIdx);
      boundaryLastKey = key;
      boundaryLastPathIndex = pathIdx;
      boundaryLastSegIndex = segIdx;
      boundaryLastLocalIdx = localIdx;
    }

  if (pts.length < 6) return;

  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.0);

  // ===============================
// ??loop-aware tubularSegments
// ===============================
const detail = CTX.getDetail();

// loop ??= ??????knit ??
const basePerPoint =
  detail === 'high' ? 3.5 :
  detail === 'med'  ? 2.5 :
                      1.8;
const perStitch =
  detail === 'high' ? 18 :
  detail === 'med'  ? 12 :
                      8;
const segmentRatio = totalPtCount ? (pts.length / totalPtCount) : 1;
const minSegmentsByStitch = Math.floor(stitchCount * perStitch * segmentRatio);
const minSegments = Math.max(600, minSegmentsByStitch);
const maxSegments =
  detail === 'high' ? 60000 :
  detail === 'med'  ? 40000 :
                      30000;
const tubularSegments = Math.min(
  maxSegments,
  Math.max(minSegments, Math.floor(pts.length * basePerPoint))
);

  const radialSegments = detail === 'high' ? 14 : detail === 'med' ? 10 : 8;

  const segmentRadius = (isTransparent ? (radiusWorld * 0.7) : radiusWorld) * rowScale;
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, segmentRadius, radialSegments, false);

const DEBUG_STITCH_COLOR = false;

// ==============================
// Vertex colors (yarnPoint-based, stitch-accurate)
// ==============================
const rings = tubularSegments + 1;
const ringVerts = radialSegments + 1;
const totalVerts = rings * ringVerts;
const colors = new Float32Array(totalVerts * 3);
const alphas = new Float32Array(totalVerts);

const getKeyForIndex = (i) => {
  const pathIndex = ptsPathIndex[i] ?? localPathIndexForPts[i] ?? i;
  return resolvedStitchKeys[pathIndex];
};
const getOpacityForIndex = (i) => {
  const pathIndex = ptsPathIndex[i] ?? localPathIndexForPts[i] ?? i;
  const op = resolvedStitchOpacity[pathIndex];
  return Number.isFinite(op) ? op : 1;
};



let lastKey = null;
let currentColor = BASE_YARN_COLOR ?? CTX.getYarnColor();
let currentAlpha = 1.0;

// ???????pts ????????
const cum = new Float32Array(pts.length);
cum[0] = 0;
for (let i = 1; i < pts.length; i++) {
  cum[i] = cum[i - 1] + pts[i].distanceTo(pts[i - 1]);
}
const totalLen = cum[cum.length - 1] || 1;

// seg start/end lookup for t interpolation on a segment
const segStartIdx = new Map();
const segEndIdx = new Map();
for (let i = 0; i < ptsSegIndex.length; i++) {
  const s = ptsSegIndex[i];
  if (s === null || s === undefined) continue;
  if (!segStartIdx.has(s)) segStartIdx.set(s, i);
  segEndIdx.set(s, i);
}

// Segment coloring by stitch links; split at each FBa->FBb midpoint.
const DEBUG_SEG_COLOR = false;
const DEBUG_SEG_LIMIT = 20;
let debugSegCount = 0;
const findPrevKey = (startIdx, fallback) => {
  const rowIdx = rowIndexForPath[startIdx] ?? yarnPath[startIdx]?.row ?? null;
  if (rowIdx === null || rowIdx === undefined) return fallback;
  for (let i = startIdx; i >= 0; i--) {
    const r = rowIndexForPath[i] ?? yarnPath[i]?.row ?? null;
    if (r !== rowIdx) break;
    const k = resolvedStitchKeys[i];
    if (k) return k;
  }
  // If not found within row, fall back to last key before startIdx.
  for (let i = startIdx; i >= 0; i--) {
    const k = resolvedStitchKeys[i];
    if (k) return k;
  }
  return fallback;
};
const findNextKey = (startIdx, fallback) => {
  const rowIdx = rowIndexForPath[startIdx] ?? yarnPath[startIdx]?.row ?? null;
  if (rowIdx === null || rowIdx === undefined) return fallback;
  for (let i = startIdx; i < resolvedStitchKeys.length; i++) {
    const r = rowIndexForPath[i] ?? yarnPath[i]?.row ?? null;
    if (r !== rowIdx) break;
    const k = resolvedStitchKeys[i];
    if (k) return k;
  }
  // If not found within row, fall back to next key after startIdx.
  for (let i = startIdx; i < resolvedStitchKeys.length; i++) {
    const k = resolvedStitchKeys[i];
    if (k) return k;
  }
  return fallback;
};
const segColorInfo = new Array(Math.max(0, state.yarnPath.length - 1));
for (let s = 0; s < segColorInfo.length; s++) {
  const prev = yarnPath[s];
  const next = yarnPath[s + 1];
  if (!prev || !next) continue;
  const prevKey = resolvedStitchKeys[s] ?? null;
  const nextKey = resolvedStitchKeys[s + 1] ?? null;
  if (DEBUG_SEG_COLOR && debugSegCount < DEBUG_SEG_LIMIT) {
    if (!prevKey || !nextKey) {
      console.log(
        '[SegColor] NullKey',
        'seg', s,
        'prev', prev.cnType, 'row', prev.row, 'key', prevKey,
        'next', next.cnType, 'row', next.row, 'key', nextKey,
        'rowIdx', rowIndexForPath[s], '->', rowIndexForPath[s + 1]
      );
      debugSegCount += 1;
    }
  }
  const currKey = prevKey ?? nextKey;
  const isRowChangeSeg =
    prev.cnType === 'FBb' &&
    next.cnType === 'FBa' &&
    (() => {
      const r0 = rowIndexForPath[s] ?? yarnPath[s]?.row ?? null;
      const r1 = rowIndexForPath[s + 1] ?? yarnPath[s + 1]?.row ?? null;
      return Number.isFinite(r0) && Number.isFinite(r1) && r0 !== r1;
    })();
  if (isRowChangeSeg) {
    const a = prevKey ?? findPrevKey(s, null);
    const b = nextKey ?? findNextKey(s + 1, null);
    const chosen = a ?? b ?? currKey;
    if (chosen) segColorInfo[s] = { mode: 'solid', a: chosen };
    continue;
  }
  if (prev.cnType === 'FBa' && next.cnType === 'FBb' && currKey) {
    const next2 = yarnPath[s + 2];
    const rowIdx0 = Number.isFinite(rowIndexForPath[s]) ? rowIndexForPath[s] : yarnPath[s]?.row;
    const rowIdx1 = Number.isFinite(rowIndexForPath[s + 1]) ? rowIndexForPath[s + 1] : yarnPath[s + 1]?.row;
    const rowIdx2 = Number.isFinite(rowIndexForPath[s + 2]) ? rowIndexForPath[s + 2] : yarnPath[s + 2]?.row;
    const sameRow01 = Number.isFinite(rowIdx0) && Number.isFinite(rowIdx1) && rowIdx0 === rowIdx1;
    const rowChange12 = Number.isFinite(rowIdx1) && Number.isFinite(rowIdx2) && rowIdx1 !== rowIdx2;
    const isRowEndTail =
      next2 &&
      next2.cnType === 'FBa' &&
      sameRow01 &&
      rowChange12;
    if (isRowEndTail) {
      // Row-end padding segment (synthetic FBa->FBb): force to previous real stitch color.
      // Scan strictly before this segment within the same row to avoid picking the pad itself.
      const tailKey = findPrevKey(s - 1, null) ?? prevKey ?? currKey;
      segColorInfo[s] = { mode: 'solid', a: tailKey };
      continue;
    }
    const rowIdx = rowIndexForPath[s];
    const prevRowIdx = s > 0 ? rowIndexForPath[s - 1] : null;
    const isRowStart =
      Number.isFinite(rowIdx) &&
      (!Number.isFinite(prevRowIdx) || prevRowIdx !== rowIdx);
    if (isRowStart) {
      segColorInfo[s] = { mode: 'solid', a: currKey };
      continue;
    }
    // Defer to point-level key mapping (midpoints carry prev/current stitch key).
    segColorInfo[s] = { mode: 'point' };
    continue;
  }
  const key = prevKey ?? findPrevKey(s - 1, null);
  if (key) segColorInfo[s] = { mode: 'solid', a: key };
}

// ?????? -> pts index??????????
function indexAtArc(target) {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const posAttr = geometry.getAttribute('position');
if (posAttr) {
  let shifted = false;
  for (let r = 0; r < rings; r++) {
    const u = r / (rings - 1);
    const target = u * totalLen;
    const pIndex = indexAtArc(target);
    const segIndex = ptsSegIndex[pIndex] ?? Math.min(segBaseX.length - 1, pIndex);
    if (segIndex < 0) continue;
    if (!segIsHead[segIndex]) continue;
    const vr = segVr[segIndex];
    if (vr < 0 || vr >= mergeDelta.length) continue;
    const dcol = segCol[segIndex];
    if (dcol < 0 || dcol >= mergeDelta[vr].length) continue;
    const delta = mergeDelta[vr][dcol] ?? 0;
    if (!delta) continue;
    const dx = delta * pxToWorld;
    const base = r * ringVerts;
    for (let v = 0; v < ringVerts; v++) {
      const idx = (base + v) * 3;
      posAttr.array[idx] += dx;
    }
    shifted = true;
  }
  if (shifted) {
    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  }
}

if (!debugLogged) {
  debugLogged = true;
}


for (let r = 0; r < rings; r++) {
  const u = r / (rings - 1);
  const target = u * totalLen;

  const pIndex = indexAtArc(target);
  const segIndex = (ptsSegIndex[pIndex] ?? null);
  let key = null;
  if (segIndex !== null) {
    const segInfo = segColorInfo[segIndex];
    if (segInfo?.mode === 'split') {
      const startIdx = segStartIdx.get(segIndex);
      const endIdx = segEndIdx.get(segIndex);
      let tSeg = 0;
      if (Number.isFinite(startIdx) && Number.isFinite(endIdx) && endIdx > startIdx) {
        const segLen = cum[endIdx] - cum[startIdx];
        const pos = target - cum[startIdx];
        const raw = segLen > 1e-9 ? (pos / segLen) : 0;
        tSeg = Math.max(0, Math.min(1, raw));
      }
      key = tSeg <= 0.5 ? segInfo.a : segInfo.b;
    } else if (segInfo?.mode === 'solid') {
      key = segInfo.a;
    }
  }
  if (!key) key = getKeyForIndex(pIndex);
  const opAtPoint = getOpacityForIndex(pIndex);
  if (key !== lastKey || opAtPoint !== currentAlpha) {
    if (key) {
      const [vrStr, colStr] = key.split(':');
      const vr = Number(vrStr);
      const col = Number(colStr);
      const stitch = AppPattern.rows?.[vr]?.[col];
      currentColor = stitch?.color ?? BASE_YARN_COLOR;
      currentAlpha = opAtPoint;
    } else {
      currentColor = BASE_YARN_COLOR ?? CTX.getYarnColor();
      currentAlpha = 1;
    }
    lastKey = key;
  }
  if (!key) currentAlpha = opAtPoint;
  const c = new THREE.Color(currentColor);

  const base = r * ringVerts;
  for (let v = 0; v < ringVerts; v++) {
    const idx = (base + v) * 3;
    colors[idx + 0] = c.r;
    colors[idx + 1] = c.g;
    colors[idx + 2] = c.b;
    alphas[base + v] = currentAlpha;
  }
}





  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('vertexAlpha', new THREE.BufferAttribute(alphas, 1));

  const enableVertexAlpha = (mat, opts = {}) => {
    if (!mat) return;
    const alphaScale = Number.isFinite(opts.alphaScale) ? opts.alphaScale : 0.6;
    const colorScale = Number.isFinite(opts.colorScale) ? opts.colorScale : 0.7;
    mat.transparent = true;
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute float vertexAlpha;\nvarying float vVertexAlpha;\nvoid main() {')
        .replace('#include <color_vertex>', '#include <color_vertex>\n  vVertexAlpha = vertexAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying float vVertexAlpha;\nvoid main() {')
        .replace(
          '#include <output_fragment>',
          '#include <output_fragment>\n  float opaqueMask = step(0.999, vVertexAlpha);\n  float alphaScale = mix(' + alphaScale.toFixed(3) + ', 1.0, opaqueMask);\n  float colorScale = mix(' + colorScale.toFixed(3) + ', 1.0, opaqueMask);\n  gl_FragColor.rgb *= colorScale;\n  gl_FragColor.a *= vVertexAlpha * alphaScale;'
        );
    };
  };

  let material;
  if (isTransparent) {
    material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.4, // smooth, subtle highlight
      metalness: 0.0,
      transparent: true,
      opacity: 0.25, // base fade for fishline
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0.0,
      depthWrite: false // avoid occluding background when transparent
    });
    enableVertexAlpha(material, { alphaScale: 0.35, colorScale: 0.7 });
  } else {
    material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.0,
      bumpMap: fiberMap || null,
      bumpScale: 0.008, // very light bump to avoid pits
      normalMap: null, // disable normalMap for this grayscale texture
      roughnessMap: fiberMap || null,
      emissive: new THREE.Color(0x0f0f0f),
      emissiveIntensity: 0.02,
      depthWrite: true
    });
    if (fiberMap) {
      material.bumpMap.wrapS = material.bumpMap.wrapT = THREE.RepeatWrapping;
      material.roughnessMap.wrapS = material.roughnessMap.wrapT = THREE.RepeatWrapping;
      material.bumpMap.repeat.copy(fiberMap.repeat);
      material.roughnessMap.repeat.copy(fiberMap.repeat);
    }
    // Add subtle cloth-like sheen to hint at fuzz without heavy bump
    if ('sheen' in material) {
      material.sheen = 2;
      material.sheenColor = new THREE.Color(0xf6f6f6);
      material.sheenRoughness = 0.85;
    }
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.layers.enable(1);
  const group = new THREE.Group();
  group.add(mesh);

  if (!isTransparent) {
    // Outer fuzz shell
    const shellRadius = segmentRadius * 1.30;
    const shellGeo = new THREE.TubeGeometry(curve, tubularSegments, shellRadius, radialSegments, false);
    const innerColors = geometry.getAttribute('color');
    const innerAlpha = geometry.getAttribute('vertexAlpha');
    if (innerColors) {
      shellGeo.setAttribute('color', innerColors.clone());
    }
    if (innerAlpha) {
      shellGeo.setAttribute('vertexAlpha', innerAlpha.clone());
    }
    const shellMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      vertexColors: true,
      roughness: 1.0,
      metalness: 0.0,
      transparent: true,
      opacity: 0.35,
      alphaMap: fiberAlpha || null,
      bumpMap: fiberMap || null,
      bumpScale: 0.006,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.05,
      depthWrite: false
    });
    if (fiberMap) {
      shellMat.alphaMap.wrapS = shellMat.alphaMap.wrapT = THREE.RepeatWrapping;
      shellMat.alphaMap.repeat.copy(fiberMap.repeat);
      shellMat.bumpMap.wrapS = shellMat.bumpMap.wrapT = THREE.RepeatWrapping;
      shellMat.bumpMap.repeat.copy(fiberMap.repeat);
    }
    enableVertexAlpha(shellMat, { alphaScale: 0.2, colorScale: 0.5 });
    const shellMesh = new THREE.Mesh(shellGeo, shellMat);
    shellMesh.layers.enable(1);
    group.add(shellMesh);
  }

  scene.add(group);
  meshes.push(group);

  };

  renderSegments.forEach(([start, end, isTransparent, rowScale]) => buildMeshForSegment(start, end, isTransparent, rowScale));

  if (!meshes.length) return;

  if (threeOverlay) threeOverlay.style.display = 'none';

  // center mesh
  const box = new THREE.Box3();
  meshes.forEach(m => box.expandByObject(m));
  const center = new THREE.Vector3();
  box.getCenter(center);
  // Anchor X to global left edge (mapLeft) in world units to match 2D layout
  let anchorX = box.min.x;
  const anchorCandidates = rowInfo
    .map(info => Number.isFinite(info?.mapLeft) ? info.mapLeft : info?.left)
    .filter(Number.isFinite);
  if (anchorCandidates.length) {
    anchorX = Math.min(...anchorCandidates) * pxToWorld;
  } else {
    anchorX = center.x;
  }
  meshes.forEach((m) => {
    m.position.x -= anchorX;
    m.position.z -= center.z;
    m.position.y -= box.min.y;
  });
  if (controls) {
    const targetY = (box.max.y + box.min.y) * 0.5 - box.min.y;
    const targetX = center.x - anchorX;
    controls.target.set(targetX, targetY, 0);
    controls.update();
  }
}



























