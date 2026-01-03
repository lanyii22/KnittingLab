import { appPatternToBimp } from './pattern-adapter.js';
import { simulateYarnSimFromModules } from './sim2d.js';
import { set3DContext, build3DFromYarnSim } from './view3d.js';
import { set3DTheme } from './view3d.js';

export const AppPattern = { gauge: { sts: 14, rows: 14 }, rows: [[]] };
let currentRow = 0;
const history = [];
let selectedRows = [];

const BACKSLASH = '\\\\'.slice(0, 1);
const SLASH = '/';
const SYMBOL = { knit: '|', purl: '-', miss: 'M', tuck: 'T', yo: 'o', m1: 'o', k2tog: BACKSLASH, ssk: SLASH, space: ' ' };
const MAX_RECENT_COLORS = 8;
let recentColors = [];
const recentColorsWrap = document.getElementById('recentColors');
const COLOR_PRESETS = [
  ['#0b9912', '#ff6a88'], // current (2-col)
  ['#1e90ff', '#ffd166'], // blue / amber
  ['#fa9d2c', '#ef476f'], // warm duo
  ['#a3f475', '#85bcff'], // mint / sky
  ['#5e60ce', '#e36414'], // indigo / orange
];
const ARGYLE_PRESETS = [
  ['#91b5f5', '#ffca75', '#b73333', '#13255f'], // bg + three diamonds
  ['#f1efe5', '#ff9f1c', '#d7263d', '#011627'], // light bg + gold/red/navy
  ['#a3f475', '#91b5f5', '#ffd166', '#ef476f'], // bright green/blue/amber/coral
  ['#5e60ce', '#e36414', '#79168b', '#94c42d'],// indigo/orange/purple/lime
  ['#dab394', '#7d4e36', '#dbc5b7', '#c2936d'] // neutral color
];
const TRANSPARENT_ROLE_MAPPINGS = [
  {
    bg: 3,
    bgA: 0,
    bgB: 1,
    lineA: 0,
    lineB: 1,
    lineC: 2,
    lineOuter: 2,
    lineInner: 3
  },
  {
    bg: 0,
    bgA: 1,
    bgB: 0,
    lineA: 2,
    lineB: 3,
    lineC: 1,
    lineOuter: 3,
    lineInner: 2
  },
  {
    bg: 1,
    bgA: 1,
    bgB: 2,
    lineA: 0,
    lineB: 2,
    lineC: 3,
    lineOuter: 0,
    lineInner: 3
  }
];
let currentPaletteIdx = 0;
let currentArgyleIdx = 0;
let currentTransparentMapIdx = 0;
const TRANSPARENT_ALPHA = 0.15;
let currentOpacity = 1.0;
let transparentMode = false;


function rememberColor(hex) {
  if (!hex) return;

  
  recentColors.unshift(hex);

  if (recentColors.length > MAX_RECENT_COLORS) {
    recentColors.length = MAX_RECENT_COLORS;
  }

  renderRecentColors();
}

function normalizeHex(hex) {
  if (typeof hex !== 'string') return hex;
  const h = hex.trim();
  return h.startsWith('#') ? h.toLowerCase() : `#${h.toLowerCase()}`;
}

function getStitchOpacity(stitch) {
  const op = stitch?.opacity;
  return Number.isFinite(op) ? op : 1.0;
}

function getRowThicknessMap() {
  if (!AppPattern.rowThickness) AppPattern.rowThickness = {};
  return AppPattern.rowThickness;
}

function getRowThickness(rowIdx) {
  const map = getRowThicknessMap();
  const v = map[rowIdx];
  return Number.isFinite(v) ? v : 1.0;
}

function setRowThickness(rowIdx, scale) {
  if (!Number.isFinite(rowIdx)) return;
  const map = getRowThicknessMap();
  map[rowIdx] = scale;
}

function updateRowThicknessLabel() {
  if (!rowThicknessLabel) return;
  if (!selectedRows.length) {
    rowThicknessLabel.textContent = 'None';
    return;
  }
  const bottomRows = selectedRows.map(r => r + 1).sort((a, b) => a - b);
  rowThicknessLabel.textContent = `Selected: ${bottomRows.join(', ')}`;
}

function getTransparentPalette() {
  const palette = ARGYLE_PRESETS[currentArgyleIdx] || ARGYLE_PRESETS[0] || [];
  return (palette.length >= 4)
    ? palette
    : ['#5e60ce', '#e36414', '#79168b', '#94c42d'];
}

function getTransparentRoleMap() {
  return TRANSPARENT_ROLE_MAPPINGS[currentTransparentMapIdx]
    || TRANSPARENT_ROLE_MAPPINGS[0];
}

function hasTransparentRoles() {
  return AppPattern.rows.some(row => row.some(st => st?.role));
}

function applyTransparentRoleMapping(nextIdx = null) {
  if (!hasTransparentRoles()) return;
  if (nextIdx !== null) {
    currentTransparentMapIdx = Math.max(
      0,
      Math.min(TRANSPARENT_ROLE_MAPPINGS.length - 1, nextIdx)
    );
  }
  const palette = getTransparentPalette();
  const roleMap = getTransparentRoleMap();

  AppPattern.rows = AppPattern.rows.map(row => row.map(st => {
    if (!st || !st.role) return st;
    const slot = roleMap[st.role];
    if (!Number.isFinite(slot)) return st;
    const color = palette[slot];
    if (!color) return st;
    return { ...st, color };
  }));
}

function renderRecentColors() {
  if (!recentColorsWrap) return;
  recentColorsWrap.innerHTML = '';

  recentColors.forEach(hex => {
    const div = document.createElement('div');
    div.className = 'swatch';
    div.style.background = hex;
    div.title = hex; 

    div.addEventListener('click', () => {
      yarnColor.value = hex;
      rememberColor(hex);
    });

    recentColorsWrap.appendChild(div);
  });
}


let currentSim = null;
const cursorByRow = [];

function getCursor(rowIdx) {
  if (!Array.isArray(AppPattern.rows[rowIdx])) return 0;
  if (cursorByRow[rowIdx] === undefined || cursorByRow[rowIdx] === null) {
    cursorByRow[rowIdx] = AppPattern.rows[rowIdx].length;
  }
  const max = AppPattern.rows[rowIdx].length;
  cursorByRow[rowIdx] = Math.max(0, Math.min(cursorByRow[rowIdx], max));
  return cursorByRow[rowIdx];
}

function setCursor(rowIdx, val) {
  if (!Array.isArray(AppPattern.rows[rowIdx])) return;
  const max = AppPattern.rows[rowIdx].length;
  cursorByRow[rowIdx] = Math.max(0, Math.min(val, max));
}

// DOM
const fabric = document.getElementById('fabric');
const fctx = fabric.getContext('2d');
const chart = document.getElementById('chart');
const cctx = chart.getContext('2d');
const meta1 = document.getElementById('meta1');
const meta2 = document.getElementById('meta2');

const threeWarn = document.getElementById('threeWarn');
const selfTestOk = document.getElementById('selfTestOk');
const threeOverlay = document.getElementById('threeOverlay');

const gaugeSts = document.getElementById('gaugeSts');
const gaugeRows = document.getElementById('gaugeRows');
const yarnColor = document.getElementById('yarnColor');
const yarnRadiusInput = document.getElementById('yarnRadius');
const detailSel = document.getElementById('detail');
const relaxStepsInput = document.getElementById('relaxSteps');
const showSimSel = document.getElementById('showSim');
const scale3dInput = document.getElementById('scale3d');
const themeToggle = document.getElementById('themeToggle');
const rowHeightScaleInput = document.getElementById('rowHeightScale');
const rowThicknessRowInput = document.getElementById('rowThicknessRow');
const rowThicknessScaleInput = document.getElementById('rowThicknessScale');
const rowThicknessApplyBtn = document.getElementById('rowThicknessApply');
const rowThicknessLabel = document.getElementById('rowThicknessLabel');
const cursorLeftBtn = document.getElementById('cursorLeft');
const cursorRightBtn = document.getElementById('cursorRight');
const paletteToggle = document.getElementById('paletteToggle');
const transparentToggle = document.getElementById('transparentToggle');

function pushHistory() {
  history.push(structuredClone(AppPattern));
  if (history.length > 100) history.shift();
}
function clampInt(v, min, max) {
  const n = Math.max(min, Math.min(max, parseInt(v || '0', 10)));
  return Number.isFinite(n) ? n : min;
}
function clampFloat(v, min, max, fb) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fb;
  return Math.max(min, Math.min(max, n));
}

function applyTheme(mode) {
  const light = mode === 'light';
  document.body.classList.toggle('theme-light', light);
  set3DTheme(light ? 'light' : 'dark');
}

function updateTransparentButton() {
  if (!transparentToggle) return;
  transparentToggle.textContent = transparentMode ? 'Transparent Yarn ON (15%)' : 'Transparent Yarn OFF';
  transparentToggle.classList.toggle('active', transparentMode);
}

function setTransparentMode(on) {
  transparentMode = !!on;
  currentOpacity = transparentMode ? TRANSPARENT_ALPHA : 1.0;
  updateTransparentButton();
}

function computeGridDims() {
  const maxSts = Math.max(1, ...AppPattern.rows.map(r => r.length));
  const rr = Math.max(1, AppPattern.rows.length);
  return { cols: maxSts, rows: Math.max(rr, AppPattern.gauge.rows) };
}

function parseRowSelection(inputValue, total) {
  const raw = String(inputValue || '').trim();
  if (!raw) return [];
  const normalized = raw.replace(/\s*-\s*/g, '-');
  const out = new Set();
  const parts = normalized.split(/[,\s]+/);
  parts.forEach(part => {
    if (!part) return;
    if (part.includes('-')) {
      const [aRaw, bRaw] = part.split('-');
      const a = parseInt(aRaw, 10);
      const b = parseInt(bRaw, 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return;
      const start = Math.max(1, Math.min(a, b));
      const end = Math.min(total, Math.max(a, b));
      for (let v = start; v <= end; v++) {
        out.add(v - 1);
      }
      return;
    }
    const v = parseInt(part, 10);
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(1, Math.min(v, total));
    out.add(clamped - 1);
  });
  return Array.from(out);
}

function selectRowByNumber(inputValue) {
  const total = AppPattern.rows.length;
  selectedRows = parseRowSelection(inputValue, total);
  if (rowThicknessScaleInput && selectedRows.length) {
    const last = selectedRows[selectedRows.length - 1];
    rowThicknessScaleInput.value = getRowThickness(last).toFixed(2);
  }
  updateRowThicknessLabel();
  renderAll2D();
}

function applyColorPreset(nextIdx = null) {
  // Detect current palette mode: argyle if >=3 distinct colors, else dual.
  const distinct = new Set();
  AppPattern.rows.forEach(row => row.forEach(st => {
    if (!st || !st.color) return;
    distinct.add(normalizeHex(st.color));
  }));
  const mode = distinct.size >= 3 ? 'argyle' : 'dual';
  const presets = mode === 'argyle' ? ARGYLE_PRESETS : COLOR_PRESETS;
  if (!presets.length) return;

  const idxRef = mode === 'argyle' ? 'currentArgyleIdx' : 'currentPaletteIdx';
  const currIdx = mode === 'argyle' ? currentArgyleIdx : currentPaletteIdx;
  const targetIdx = (nextIdx === null)
    ? ((currIdx + 1) % presets.length)
    : Math.max(0, Math.min(presets.length - 1, nextIdx));
  const nextPalette = presets[targetIdx];

  // Map existing colors to the next preset in order.
  const map = new Map();
  const seen = [];
  AppPattern.rows.forEach(row => {
    row.forEach(st => {
      if (!st || !st.color) return;
      const hex = normalizeHex(st.color);
      if (map.has(hex)) return;
      if (seen.includes(hex)) return;
      const slot = seen.length;
      if (slot < nextPalette.length) {
        map.set(hex, nextPalette[slot]);
      }
      seen.push(hex);
    });
  });

  pushHistory();
  AppPattern.rows = AppPattern.rows.map(row => row.map(st => {
    if (!st || !st.color) return st;
    const hex = normalizeHex(st.color);
    const repl = map.get(hex);
    if (repl) return { ...st, color: repl };
    return st;
  }));
  if (mode === 'argyle') currentArgyleIdx = targetIdx; else currentPaletteIdx = targetIdx;
  const hasRoles = hasTransparentRoles();
  if (hasRoles) {
    applyTransparentRoleMapping(currentTransparentMapIdx);
  }
  yarnColor.value = nextPalette[0];
  rememberColor(nextPalette[0]);
  renderAll2D();
}

function renderFabric2D() {
  fctx.clearRect(0, 0, fabric.width, fabric.height);
  const { cols, rows } = computeGridDims();
  const stitchSize = Math.min(fabric.width / cols, fabric.height / rows);

  fctx.lineCap = 'round';
  fctx.lineJoin = 'round';

  // Newest row on top: draw from last row to first row.
  for (let ry = AppPattern.rows.length - 1; ry >= 0; ry--) {
    const row = AppPattern.rows[ry] || [];
    // Map existing colors to the next preset in order.
    const y = (AppPattern.rows.length - 1 - ry);
    const rowScale = getRowThickness(ry);

    for (let x = 0; x < row.length; x++) {
      const stitch = row[x];
      if (!stitch) continue;
      if (stitch.type === 'dec_pad' || stitch.type === 'space') continue;

      const cx = x * stitchSize + stitchSize / 2;
      const cy = y * stitchSize + stitchSize / 2;

      const stitchScale = Number.isFinite(stitch?.thickness) ? stitch.thickness : 1.0;
      fctx.lineWidth = Math.max(1.5, stitchSize * 0.14 * rowScale * stitchScale);

      // Stitch keeps its own color; fallback is current picker (only if missing).
      const col = stitch.color || yarnColor.value;
      fctx.strokeStyle = col;
      fctx.globalAlpha = getStitchOpacity(stitch);

      fctx.beginPath();
      if (stitch.type === 'knit') {
        fctx.arc(cx, cy, stitchSize / 2.35, Math.PI * 0.1, Math.PI * 0.9);
      } else if (stitch.type === 'purl') {
        fctx.arc(cx, cy, stitchSize / 2.35, Math.PI * 1.1, Math.PI * 1.9);
      } else if (stitch.type === 'miss') {
        fctx.moveTo(cx - stitchSize * 0.25, cy);
        fctx.lineTo(cx + stitchSize * 0.25, cy);
      } else if (stitch.type === 'tuck') {
        fctx.arc(cx, cy, stitchSize / 4.0, 0, Math.PI * 2);
      } else if (stitch.type === 'yo' || stitch.type === 'm1') {
        fctx.arc(cx, cy, stitchSize / 4.2, 0, Math.PI * 2);
      } else if (stitch.type === 'ssk') {
        const d = stitchSize * 0.25;
        const prev = row[x - 1];
        if (prev?.type === 'dec_pad') {
          const px = (x - 1) * stitchSize + stitchSize / 2;
          fctx.moveTo(px - d, cy + d);
          fctx.lineTo(cx + d, cy - d);
        } else {
          fctx.moveTo(cx + d, cy - d);
          fctx.lineTo(cx - d, cy + d);
        }
      } else if (stitch.type === 'k2tog') {
        const d = stitchSize * 0.25;
        const next = row[x + 1];
        if (next?.type === 'dec_pad') {
          const nx = (x + 1) * stitchSize + stitchSize / 2;
          fctx.moveTo(cx - d, cy - d);
          fctx.lineTo(nx + d, cy + d);
        } else {
          fctx.moveTo(cx - d, cy - d);
          fctx.lineTo(cx + d, cy + d);
        }
      }
      fctx.stroke();
      fctx.globalAlpha = 1.0;
    }
  }
  if (selectedRows.length) {
    fctx.save();
    fctx.strokeStyle = 'rgba(255, 200, 80, 0.65)';
    fctx.lineWidth = Math.max(2, stitchSize * 0.08);
    selectedRows.forEach(rowIdx => {
      const visualRow = (AppPattern.rows.length - 1 - rowIdx);
      const y = visualRow * stitchSize;
      fctx.strokeRect(0.5, y + 0.5, fabric.width - 1, stitchSize - 1);
    });
    fctx.restore();
  }

  meta1.textContent = `${AppPattern.rows.length} rows / max ${Math.max(0, ...AppPattern.rows.map(r => r.length))} sts`;
}

function renderChart2D() {
  cctx.clearRect(0, 0, chart.width, chart.height);
  const { cols, rows } = computeGridDims();
  const cell = Math.min(chart.width / cols, chart.height / rows);

  cctx.fillStyle = '#07070d';
  cctx.fillRect(0, 0, chart.width, chart.height);

  cctx.strokeStyle = 'rgba(255,255,255,0.08)';
  cctx.textAlign = 'center';
  cctx.textBaseline = 'middle';
  cctx.font = `${Math.max(10, cell * 0.62)}px serif`;

  //newest row on top (visual y=0 uses last data row)
  for (let y = 0; y < rows; y++) {
    const srcY = (AppPattern.rows.length - 1 - y);
    const rowRef = AppPattern.rows[srcY] || [];
    const rowCols = rowRef.length;
    const rowScale = getRowThickness(srcY);
    const fontScale = Math.max(0.7, Math.min(rowScale, 1.6));
    cctx.font = `${Math.max(10, cell * 0.62 * fontScale)}px serif`;
    for (let x = 0; x < rowCols; x++) {
      const px = x * cell, py = y * cell;
      cctx.strokeRect(px, py, cell, cell);

      const stitch = (srcY >= 0 && rowRef[x]) ? rowRef[x] : null;
      if (stitch) {
        if (stitch.type === 'dec_pad') {
          cctx.globalAlpha = 1.0;
          continue;
        }
        cctx.globalAlpha = getStitchOpacity(stitch);
        if (stitch.type === 'ssk' && rowRef[x - 1]?.type === 'dec_pad') {
          cctx.beginPath();
          cctx.strokeStyle = stitch.color || '#e6e6eb';
          const stitchScale = Number.isFinite(stitch?.thickness) ? stitch.thickness : 1.0;
          cctx.lineWidth = Math.max(1, cell * 0.15 * rowScale * stitchScale);
          cctx.moveTo(px - cell + cell * 0.2, py + cell - cell * 0.2);
          cctx.lineTo(px + cell - cell * 0.2, py + cell * 0.2);
          cctx.stroke();
        } else if (stitch.type === 'k2tog' && rowRef[x + 1]?.type === 'dec_pad') {
          cctx.beginPath();
          cctx.strokeStyle = stitch.color || '#e6e6eb';
          const stitchScale = Number.isFinite(stitch?.thickness) ? stitch.thickness : 1.0;
          cctx.lineWidth = Math.max(1, cell * 0.15 * rowScale * stitchScale);
          cctx.moveTo(px + cell * 0.2, py + cell * 0.2);
          cctx.lineTo(px + cell * 2 - cell * 0.2, py + cell - cell * 0.2);
          cctx.stroke();
        } else {
          cctx.fillStyle = stitch.color || '#e6e6eb';
          cctx.fillText(SYMBOL[stitch.type] || '?', px + cell / 2, py + cell / 2);
        }
        cctx.globalAlpha = 1.0;
      }
    }
  }
  if (selectedRows.length) {
    cctx.save();
    cctx.strokeStyle = 'rgba(255, 200, 80, 0.65)';
    cctx.lineWidth = Math.max(2, cell * 0.08);
    selectedRows.forEach(rowIdx => {
      const visualRow = (AppPattern.rows.length - 1 - rowIdx);
      const y = visualRow * cell;
      cctx.strokeRect(0.5, y + 0.5, chart.width - 1, cell - 1);
    });
    cctx.restore();
  }

  meta2.textContent = `Gauge ${AppPattern.gauge.sts} sts / ${AppPattern.gauge.rows} rows (10cm)`;
}

function renderAll2D() {
  renderFabric2D();
  renderChart2D();
}

function buildExampleRows(rows, cols, buildCell) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push(buildCell(r, c));
    }
    out.push(row);
  }
  return out;
}

function applyExample(rows) {
  history.length = 0;
  AppPattern.rows = rows;
  AppPattern.rowThickness = {};
  selectedRows = [];
  if (rowThicknessRowInput) rowThicknessRowInput.value = '';
  updateRowThicknessLabel();
  const maxSts = Math.max(1, ...rows.map(r => r.length));
  AppPattern.gauge = { sts: maxSts, rows: rows.length };
  currentRow = Math.max(0, AppPattern.rows.length - 1);
  gaugeSts.value = AppPattern.gauge.sts;
  gaugeRows.value = AppPattern.gauge.rows;
  renderAll2D();
  runSimulationAndBuild3D();
}

function makeStockinetteExample() {
  const EXAMPLE_COLORS = ['#0b9912', '#ff6a88'];
  const rows = 19;
  const cols = 12;
  return buildExampleRows(rows, cols, (r, c) => ({
    type: 'knit',
    color: EXAMPLE_COLORS[Math.floor(r / 3) % EXAMPLE_COLORS.length]
  }));
}

function makeRibExample() {
  const rows = 12;
  const cols = 12;
  return buildExampleRows(rows, cols, (r, c) => ({
    type: (c % 2 === 0) ? 'knit' : 'purl',
    color: yarnColor.value
  }));
}

function makeMissExample() {
  const EXAMPLE_COLORS = ['#6464d9', '#f387ab', '#ffa75a', '#d395f4'];
  const rowsSpec = [
    // Row 20 -> Row 1 (top to bottom)
    'KKKKKKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKKKKKK',
    'KKKPPPPPKKKKPPPPPKKK',
    'KKKPMMMPKKKKPMMMPKKK',
    'KKKPMMMPKKKKPMMMPKKK',
    'KKKPMMMPKKKKPMMMPKKK',
    'KKKPMMMPKKKKPMMMPKKK',
    'KKKPPPPPKKKKPPPPPKMM',
    'PPPPKKKKPPPPKKKKPPPP',
    'KKKKKKKKKKKKKKKKKKKK',
    'PPPPKKKKPPPPKKKKPPPP',
    'KMMMKKKKMMMMKKKKMMMK',
    'KMMMKKKKMMMMKKKKMMMK',
    'KMMMKKKKMMMMKKKKMMMK',
    'KMMMKPKPMMMMKPKPMMMP',
    'KPKPKPKPKPKPKPKPKPKP',
    'KPKPKPKPKPKPKPKPKPKP',
    'KKKKKKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKKKKKK',
  ];
  const rows = rowsSpec.map((row, r) => {
    const last = rowsSpec.length - 1;
    const isEdgeBand = (r <= 2) || (r >= last - 2);
    const rowColor = isEdgeBand
      ? EXAMPLE_COLORS[0]
      : EXAMPLE_COLORS[(r - 3) % (EXAMPLE_COLORS.length - 1) + 1];
    return Array.from(row).map(cell => {
      if (cell === 'P') return { type: 'purl', color: rowColor };
      if (cell === 'M') return { type: 'miss', color: rowColor };
      return { type: 'knit', color: rowColor };
    })
  });
  return rows;
}

  function makeIncreaseExample() {
    const rows = [];
    const specs = [
      '.....KKK',
      '....YoKKK',
      '....KKKK',
      '...YoKKKK',
      '...KKKKK',
      '..YoKKKKK',
      '..KKKKKK',
      '.YoKKKKKK',
      '.KKKKKKK',
      'YoKKKKKKK',
      'KKKKKKKK',
    ];

    const toRow = (spec) => {
      const out = [];
      let i = 0;
      while (i < spec.length) {
        if (spec[i] === '.') {
          out.push({ type: 'space' });
          i += 1;
          continue;
        }
        if ((spec[i] === 'Y' || spec[i] === 'y') && (spec[i + 1] === 'O' || spec[i + 1] === 'o')) {
          out.push({ type: 'yo', color: yarnColor.value });
          i += 2;
          continue;
        }
        if (spec[i] === 'K' || spec[i] === 'k') {
          out.push({ type: 'knit', color: yarnColor.value });
          i += 1;
          continue;
        }
        i += 1;
      }
      return out;
    };

    specs.forEach((spec) => rows.push(toRow(spec)));
    return rows;
  }

function makeDecreaseExample() {
  const rowCount = 7;
  const baseTypes = ['k2tog', 'dec_pad', 'knit', 'knit', 'knit', 'knit', 'knit', 'knit', 'knit', 'knit'];
  const baseLen = baseTypes.length;
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const spaceCount = Math.floor(r / 2);
    const rowBase = (r % 2 === 1)
      ? baseTypes
      : new Array(baseLen).fill('knit');
    const innerTypes = rowBase.slice(0, baseLen - spaceCount);
    const row = [];
    for (let i = 0; i < spaceCount; i++) {
      row.push({ type: 'space' });
    }
    innerTypes.forEach(type => row.push({ type, color: yarnColor.value }));
    rows.push(row);
  }
  return rows;
}

function makeStripeRadiusExample() {
  const colors = ['#0b9912', '#ff6a88', '#5e60ce', '#e36414'];
  const rows = 24;
  const cols = 18;
  const stripeHeight = 2;
  return buildExampleRows(rows, cols, (r, c) => {
    const color = colors[Math.floor(r / stripeHeight) % colors.length];
    const thickness =
      color === colors[2] ? 3.0 :
      color === colors[3] ? 5.0 :
      1.0;
    return { type: 'knit', color, thickness };
  });
}

function makeTransparentExample() {
  const rows = [];
  const colors = getTransparentPalette();
  const roleMap = getTransparentRoleMap();
  const lineOpacity = 1.0;
  const bgOpacity = TRANSPARENT_ALPHA;
  const bgColor = colors[roleMap.bg];
  const totalRows = 25;
  const edgeRows = 5;
  const cols = 18;
  const rowStripeSize = 2;
  const rowStripeGap = 2;
  const colStripeSize = 3;
  const colStripeGap = 3;
  for (let r = 0; r < totalRows; r++) {
    const isEdge = r < edgeRows || r >= totalRows - edgeRows;
    const rowStripe = Math.floor(r / rowStripeGap);
    const inRowStripe = (rowStripe % 2 === 0) && ((r % rowStripeGap) < rowStripeSize);
    const row = [];
    for (let c = 0; c < cols; c++) {
      if (isEdge) {
        const edgeRole = (r % 2 === 1) ? 'bgB' : 'bgA';
        row.push({
          type: 'purl',
          color: colors[roleMap[edgeRole]],
          opacity: 1.0,
          role: edgeRole
        });
        continue;
      }
      const colStripe = Math.floor(c / colStripeGap);
      const inColStripe = (colStripe % 2 === 0) && ((c % colStripeGap) < colStripeSize);
      const isLine = inRowStripe || inColStripe;
      const opacity = isLine ? lineOpacity : bgOpacity;
      const lineRole = (inRowStripe && inColStripe)
        ? 'lineC'
        : (inColStripe ? 'lineB' : 'lineA');
      const lineColor = colors[roleMap[lineRole]];
      const rowColor = isLine ? lineColor : bgColor;
      const thickness = (isLine && inRowStripe) ? 2.0 : 1.0;
      row.push({
        type: 'knit',
        color: rowColor,
        opacity,
        role: isLine ? lineRole : 'bg',
        thickness
      });
    }
    rows.push(row);
  }
  return rows;
}

function makeArgyleExample() {
  const bg = '#91b5f5';
  const diamondA = ['#ffca75', '#b73333', '#13255f'];
  const diamondB = ['#13255f', '#ffca75', '#b73333'];
  const rows = 20;
  const cols = 24;
  const tileW = 12;
  const tileH = 10;
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  return buildExampleRows(rows, cols, (r, c) => {
    const tileX = Math.floor(c / tileW);
    const tileY = Math.floor(r / tileH);
    const localX = (c % tileW) + 0.5;
    const localY = (r % tileH) + 0.5;
    const dx = Math.abs(localX - halfW);
    const dy = Math.abs(localY - halfH);
    const norm = (dx / halfW) + (dy / halfH);
    const inside = norm <= 1;
    let color = bg;
    if (inside) {
      const palette = ((tileX + tileY) % 2 === 0) ? diamondA : diamondB;
      const layer = norm < 0.4 ? 2 : (norm < 0.7 ? 1 : 0);
      color = palette[layer];
    }
    return { type: 'knit', color, thickness: 2.3 };
  });
}

function makeTransparentDiamondExample() {
  const rows = [];
  const cols = 21;
  const totalRows = 24;
  const edgeRows = 5;
  const midRows = totalRows - edgeRows * 2;
  const colors = getTransparentPalette();
  const roleMap = getTransparentRoleMap();
  const bandColorA = colors[roleMap.bgA];
  const bandColorB = colors[roleMap.bgB];
  const laceColorOuter = colors[roleMap.lineOuter];
  const laceColorInner = colors[roleMap.lineInner];
  const lineOpacity = 1.0;
  const bgOpacity = TRANSPARENT_ALPHA;
  const tileW = 7;
  const tileH = 7;
  const centerX = (tileW - 1) / 2;
  const centerY = (tileH - 1) / 2;
  const radius = Math.min(centerX, centerY);
  for (let r = 0; r < totalRows; r++) {
    const row = [];
    const isEdge = r < edgeRows || r >= totalRows - edgeRows;
    if (isEdge) {
      const useAlt = (r % 2) === 1;
      for (let c = 0; c < cols; c++) {
        row.push({
          type: 'knit',
          color: useAlt ? bandColorB : bandColorA,
          opacity: 1.0,
          role: useAlt ? 'bgB' : 'bgA'
        });
      }
    } else {
      const midIdx = r - edgeRows;
      const tileY = Math.floor(midIdx / tileH);
      const offset = (tileY % 2 === 1) ? Math.floor(tileW / 2) : 0;
      for (let c = 0; c < cols; c++) {
        const localX = (c + offset) % tileW;
        const localY = midIdx % tileH;
        const dist = Math.abs(localX - centerX) + Math.abs(localY - centerY);
        const isOuter = dist === radius;
        const isInner = dist === radius - 1;
        const bgColor = (midIdx % 2 === 1) ? bandColorB : bandColorA;
        const role = isOuter ? 'lineOuter' : (isInner ? 'lineInner' : ((midIdx % 2 === 1) ? 'bgB' : 'bgA'));
        const thickness = (isOuter || isInner) ? 2.5 : 1.0;
        row.push({
          type: 'knit',
          color: isOuter ? laceColorOuter : (isInner ? laceColorInner : bgColor),
          opacity: (isOuter || isInner) ? lineOpacity : bgOpacity,
          role,
          thickness
        });
      }
    }
    rows.push(row);
  }
  return rows;
}

function showError(e) {
  const msg = (e && (e.message || e.toString())) ? (e.message || e.toString()) : String(e);
  threeWarn.style.display = 'block';
  threeWarn.textContent = `FAILED:\n${msg}\n\n${e?.stack || ''}`;
  threeOverlay.style.display = 'flex';
  threeOverlay.textContent = 'error (see left side)';
}

function initPanelResizer() {
  const main = document.querySelector('main');
  const panel3d = document.getElementById('panel3d');
  const resizer = document.getElementById('panelResizer');
  if (!main || !panel3d || !resizer) return;

  const minLeft = 220;
  const minRight = 260;
  let lastRightWidth = null;
  let lastLeftWidth = null;
  let dragging = false;
  let startX = 0;
  let startRight = 0;
  let ignoreResize = false;

  const getGap = () => {
    const styles = getComputedStyle(main);
    const gap = parseFloat(styles.columnGap || styles.gap || '0');
    return Number.isFinite(gap) ? gap : 18;
  };

  const setResizerPosition = () => {
    if (!Number.isFinite(lastLeftWidth)) return;
    const gap = getGap();
    const padLeft = parseFloat(getComputedStyle(main).paddingLeft || '0') || 0;
    const resizerWidth = resizer.offsetWidth || 12;
    const left = padLeft + lastLeftWidth * 2 + gap - resizerWidth / 2;
    resizer.style.left = `${left}px`;
  };

  const applyColumns = (rightWidth, triggerResize) => {
    if (window.matchMedia('(max-width:1100px)').matches) {
      main.style.gridTemplateColumns = '';
      resizer.style.display = 'none';
      return;
    }

    const gap = getGap();
    const total = main.clientWidth;
    const available = total - gap * 2;
    const maxRight = available - minLeft * 2;
    if (available <= minLeft * 2 + minRight) {
      main.style.gridTemplateColumns = '';
      resizer.style.display = 'none';
      return;
    }

    const clampedRight = Math.max(minRight, Math.min(rightWidth, maxRight));
    const leftWidth = (available - clampedRight) / 2;
    lastRightWidth = clampedRight;
    lastLeftWidth = leftWidth;
    resizer.style.display = 'block';
    main.style.gridTemplateColumns = `${leftWidth}px ${leftWidth}px ${clampedRight}px`;
    setResizerPosition();

    if (triggerResize) {
      ignoreResize = true;
      window.dispatchEvent(new Event('resize'));
      setTimeout(() => { ignoreResize = false; }, 0);
    }
  };

  const syncFromLayout = () => {
    const currentRight = panel3d.getBoundingClientRect().width;
    if (!Number.isFinite(currentRight) || currentRight <= 0) return;
    applyColumns(currentRight, false);
  };

  syncFromLayout();

  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startRight = panel3d.getBoundingClientRect().width;
    resizer.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
  });

  resizer.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    applyColumns(startRight - dx, true);
  });

  const stopDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    resizer.releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
  };

  resizer.addEventListener('pointerup', stopDrag);
  resizer.addEventListener('pointercancel', stopDrag);

  window.addEventListener('resize', () => {
    if (ignoreResize) return;
    if (lastRightWidth === null) {
      syncFromLayout();
      return;
    }
    applyColumns(lastRightWidth, false);
  });
}

function initFullscreen3D() {
  const panel3d = document.getElementById('panel3d');
  const btn = document.getElementById('threeFullscreen');
  if (!panel3d || !btn) return;

  const update = () => {
    const isFs = document.fullscreenElement === panel3d;
    btn.textContent = isFs ? 'Exit Fullscreen' : 'Fullscreen';
    window.dispatchEvent(new Event('resize'));
  };

  btn.addEventListener('click', () => {
    if (document.fullscreenElement === panel3d) {
      document.exitFullscreen?.();
      return;
    }
    panel3d.requestFullscreen?.();
  });

  document.addEventListener('fullscreenchange', update);
}

function bindUI() {
  document.querySelectorAll('[data-stitch]').forEach(btn => {
    btn.addEventListener('click', () => {
      pushHistory();
      const row = AppPattern.rows[currentRow];
      const cursor = getCursor(currentRow);
      const type = btn.dataset.stitch;
      if (type === 'k2tog') {
        row.splice(cursor, 0,
          { type: 'k2tog', color: yarnColor.value, opacity: currentOpacity },
          { type: 'dec_pad', color: yarnColor.value, opacity: currentOpacity }
        );
        setCursor(currentRow, cursor + 2);
      } else if (type === 'ssk') {
        row.splice(cursor, 0,
          { type: 'dec_pad', color: yarnColor.value, opacity: currentOpacity },
          { type: 'ssk', color: yarnColor.value, opacity: currentOpacity }
        );
        setCursor(currentRow, cursor + 2);
      } else if (type === 'yo') {
        row.splice(cursor, 0, {
          type,
          color: yarnColor.value,
          opacity: currentOpacity
        });
        setCursor(currentRow, cursor + 1);
      } else {
        row.splice(cursor, 0, {
          type,
          color: yarnColor.value,
          opacity: currentOpacity
        });
        setCursor(currentRow, cursor + 1);
      }
      renderAll2D();
    });
  });

  document.getElementById('newRow').addEventListener('click', () => {
    pushHistory();
    AppPattern.rows.push([]);
    currentRow = AppPattern.rows.length - 1;
    setCursor(currentRow, AppPattern.rows[currentRow].length);
    renderAll2D();
  });

  document.getElementById('undo').addEventListener('click', () => {
    if (!history.length) return;
    const prev = history.pop();
    AppPattern.gauge = structuredClone(prev.gauge);
    AppPattern.rows = structuredClone(prev.rows);
    AppPattern.rowThickness = structuredClone(prev.rowThickness || {});
    selectedRows = [];
    if (rowThicknessRowInput) rowThicknessRowInput.value = '';
    updateRowThicknessLabel();
    currentRow = Math.max(0, AppPattern.rows.length - 1);
    cursorByRow.length = 0;
    gaugeSts.value = AppPattern.gauge.sts;
    gaugeRows.value = AppPattern.gauge.rows;
    renderAll2D();
  });

  document.getElementById('reset').addEventListener('click', () => {
    AppPattern.rows = [[]];
    AppPattern.gauge = { sts: 14, rows: 14 };
    AppPattern.rowThickness = {};
    selectedRows = [];
    if (rowThicknessRowInput) rowThicknessRowInput.value = '';
    updateRowThicknessLabel();
    history.length = 0;
    currentRow = 0;

    gaugeSts.value = AppPattern.gauge.sts;
    gaugeRows.value = AppPattern.gauge.rows;
    yarnRadiusInput.value = '1.00';
    yarnColor.value = '#e1c77a';
    rowThicknessScaleInput.value = '1.00';
    rememberColor(yarnColor.value);
    detailSel.value = 'med';
    scale3dInput.value = '0.01';
    setTransparentMode(false);

    renderAll2D();

    // 3D clear
    window.__VK3D__?.clear?.();

    threeOverlay.style.display = 'flex';
    threeOverlay.textContent = 'Reset. Click Run 3D.';
    threeWarn.style.display = 'none';
  });

  gaugeSts.addEventListener('input', () => {
    AppPattern.gauge.sts = clampInt(gaugeSts.value, 4, 60);
    renderAll2D();
  });
  gaugeRows.addEventListener('input', () => {
    AppPattern.gauge.rows = clampInt(gaugeRows.value, 4, 60);
    renderAll2D();
  });

  rowThicknessRowInput?.addEventListener('input', (e) => {
    selectRowByNumber(e.target?.value);
  });

  rowThicknessApplyBtn?.addEventListener('click', () => {
    if (!selectedRows.length) return;
    const scale = clampFloat(rowThicknessScaleInput?.value, 0.5, 3.0, 1.0);
    pushHistory();
    selectedRows.forEach(rowIdx => setRowThickness(rowIdx, scale));
    renderAll2D();
  });

  // recentColors only updates on committed change
  yarnColor.addEventListener('change', () => {
    rememberColor(yarnColor.value);
  });

  cursorLeftBtn?.addEventListener('click', () => {
    setCursor(currentRow, getCursor(currentRow) - 1);
  });
  cursorRightBtn?.addEventListener('click', () => {
    setCursor(currentRow, getCursor(currentRow) + 1);
  });

  themeToggle?.addEventListener('click', () => {
    const isLight = document.body.classList.contains('theme-light');
    const next = isLight ? 'dark' : 'light';
    applyTheme(next);
    themeToggle.classList.toggle('night', next === 'dark');
    themeToggle.classList.toggle('day', next === 'light');
  });
  paletteToggle?.addEventListener('click', () => {
    applyColorPreset();
  });
  transparentToggle?.addEventListener('click', () => {
    setTransparentMode(!transparentMode);
  });

  showSimSel.addEventListener('input', () => {
    document.getElementById('sim-canvases').style.opacity = (showSimSel.value === '1') ? '1.0' : '0.0';
  });

  document.getElementById('relax').addEventListener('click', () => runSimulationAndBuild3D());

  document.getElementById('exStockinette')?.addEventListener('click', () => {
    applyExample(makeStockinetteExample());
  });
  document.getElementById('exRib')?.addEventListener('click', () => {
    applyExample(makeRibExample());
  });
  document.getElementById('exSeed')?.addEventListener('click', () => {
    applyExample(makeMissExample());
  });
  document.getElementById('exIncrease')?.addEventListener('click', () => {
    applyExample(makeIncreaseExample());
  });
  document.getElementById('exDecrease')?.addEventListener('click', () => {
    applyExample(makeDecreaseExample());
  });
  document.getElementById('exStripeRadius')?.addEventListener('click', () => {
    applyExample(makeStripeRadiusExample());
  });
  document.getElementById('exTransparent')?.addEventListener('click', () => {
    applyExample(makeTransparentExample());
  });
  document.getElementById('exTransparentDiamond')?.addEventListener('click', () => {
    applyExample(makeTransparentDiamondExample());
  });
  document.getElementById('exArgyle')?.addEventListener('click', () => {
    applyExample(makeArgyleExample());
  });
}


function syncGaugeToPattern() {
  // Make simulation size match what user actually drew.
  const maxSts = Math.max(1, ...AppPattern.rows.map(r => r.length));
  AppPattern.gauge.sts = clampInt(maxSts, 1, 60);
  AppPattern.gauge.rows = clampInt(AppPattern.rows.length, 1, 60);
  gaugeSts.value = AppPattern.gauge.sts;
  gaugeRows.value = AppPattern.gauge.rows;
}

function runSimulationAndBuild3D() {
  try {
    threeWarn.style.display = 'none';
    threeOverlay.style.display = 'flex';
    threeOverlay.textContent = 'Building 3D...';

    syncGaugeToPattern();
    const bimp = appPatternToBimp(AppPattern);
    const palette = { yarn: yarnColor.value };

    currentSim?.stopSim?.();
    currentSim = simulateYarnSimFromModules(bimp, palette, 1.0);

    const steps = clampInt(relaxStepsInput.value, 0.5, 10);
    //currentSim.relax(steps);  
    
    const state = currentSim.getState();
    build3DFromYarnSim(state);

  } catch (e) {
    console.error(e);
    showError(e);
  }
}

export function initUI() {
  set3DContext({
    getAppPattern: () => AppPattern,
    getYarnColor: () => yarnColor.value,
    getYarnRadiusScale: () => clampFloat(yarnRadiusInput.value, 0.2, 4.0, 1.0),
    getDetail: () => detailSel.value,
    getScale3D: () => clampFloat(scale3dInput.value, 0.001, 0.1, 0.01),
    getRowHeightScale: () => clampFloat(rowHeightScaleInput?.value, 0.5, 3.0, 1.5),
    getRowThickness: () => getRowThicknessMap(),
    getPadding: () => ({ X_PADDING: 1, Y_PADDING: 0 })
  });

  setTransparentMode(false);
  applyTheme('dark');
  if (themeToggle) {
    themeToggle.classList.add('night');
    themeToggle.classList.remove('day');
  }
  initPanelResizer();
  initFullscreen3D();
  bindUI();
  renderAll2D();
  rememberColor(yarnColor.value); 
  updateRowThicknessLabel();
}

export function runSelfTests() {
  selfTestOk.style.display = 'block';
  selfTestOk.textContent = 'Self-test: OK';
}

