// yarnSimulation.yarnsim.js
// Logic is 1:1 copied from YarnSim yarnSimulation.js
// Only changes:
// 1. import paths fixed to .js
// 2. expose getState() for integration (non-breaking)

import * as d3 from "d3";
import { ProcessModel } from "./ProcessModel.js";
import { Pattern } from "./Pattern.js";
import { YarnModel } from "./YarnModel.js";
import { yarnLinkForce } from "./YarnForce.js";

// ===== YarnSim constants  =====
function findSimCanvases() {
  const container = document.getElementById('sim-container');
  if (!container) {
    throw new Error('[SIM] sim-container not found');
  }

  const canvases = Array.from(container.querySelectorAll('canvas'))
    .filter(c => c instanceof HTMLCanvasElement && c.getContext('2d'));

  if (canvases.length < 3) {
    throw new Error(
      `[SIM] Expected 3 usable canvas elements, found ${canvases.length}`
    );
  }

  return canvases.slice(0, 3); // back, mid, front
}



const X_PADDING = 1;
const Y_PADDING = 0;
const EMPTY_PIX = 4;

const STITCH_RATIO = 5 / 3;
const YARN_RATIO = 0.24;
const SPREAD = 0.88;

const ALPHA_DECAY = 0.05;
const ALPHA_MIN = 0.2;
const ITERATIONS = 1;
const LINK_STRENGTH = 0.1;
const HEIGHT_SHRINK = 0.7;

// ======================================================

export function simulate(pattern, yarnSequence, palette, scale) {
  let relaxed = false;
  let yarnWidth, stitchHeight, sim;

  const yarnSet = new Set(yarnSequence);
  const yarnPalette = { ...palette, border: "#00000033" };

  const dpi = Math.max(1, window.devicePixelRatio || 1);

  ///////////////////////
  // INIT PATTERN
  ///////////////////////
  const stitchPattern = new Pattern(pattern.pad(X_PADDING, Y_PADDING, EMPTY_PIX));

  ///////////////////////
  // INIT CANVASES
  ///////////////////////
  const container = document.getElementById("sim-container");
const bbox = container.getBoundingClientRect();

const safeWidth = bbox.width > 0 ? bbox.width : 600;
const safeHeight = bbox.height > 0 ? bbox.height : 400;

const width = safeWidth * scale;
const height = safeHeight * scale;

  const canvasWidth = dpi * width;
  const canvasHeight = dpi * height;

  

  const [backCanvas, midCanvas, frontCanvas] = findSimCanvases();

[backCanvas, midCanvas, frontCanvas].forEach((canvas) => {
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  canvas.style.cssText = `width: ${width}px; height: ${height}px;`;
});

const backCtx = backCanvas.getContext("2d");
const midCtx = midCanvas.getContext("2d");
const frontCtx = frontCanvas.getContext("2d");

if (!backCtx || !midCtx || !frontCtx) {
  throw new Error('[SIM] Failed to acquire 2D context from canvas');
}





  ///////////////////////
  // BUILD SIMULATION DATA
  ///////////////////////
  const testModel = new ProcessModel(stitchPattern);
  const yarnGraph = new YarnModel(testModel.cn);

  ///////////////////////
  // INITIALIZE NODES
  ///////////////////////
  function layoutNodes(yarnGraph) {
    const stitchWidth = Math.min(
      (canvasWidth * 0.9) / stitchPattern.width,
      ((canvasHeight * 0.9) / stitchPattern.height) * STITCH_RATIO
    );

    const halfStitch = stitchWidth / 2;
    stitchHeight = stitchWidth / STITCH_RATIO;

    yarnWidth = stitchWidth * YARN_RATIO;

    const offsetX =
      yarnWidth + (canvasWidth - stitchPattern.width * stitchWidth) / 2;
    const offsetY =
      -yarnWidth +
      (canvasHeight - stitchPattern.height * stitchHeight) / 2;

    yarnGraph.contactNodes.forEach((node, index) => {
      const i = index % yarnGraph.width;
      const j = (index - i) / yarnGraph.width;
      node.i = i;
      node.j = j;
      node.x = offsetX + i * halfStitch;
      node.y = offsetY + j * stitchHeight;
    });

    return yarnGraph.contactNodes;
  }

  const nodes = layoutNodes(yarnGraph);

  const yarnPath = yarnGraph.makeNice();
  const yarnPathLinks = yarnGraph.yarnPathToLinks();
  
  yarnPathLinks.forEach((link) => {
  const node = nodes[link.target] ?? nodes[link.source];
  if (!node) return;
  link.col = Math.floor((node.i - X_PADDING * 2) / 2);
});

  ///////////////////////
  // NORMALS
  ///////////////////////
  function unitNormal(prev, next, flip) {
    if (prev.index === next.index) return [0, 0];
    const x = prev.x - next.x;
    const y = prev.y - next.y;

    const mag = SPREAD * Math.sqrt(x ** 2 + y ** 2);

    if (flip) return [-y / mag, x / mag];
    return [y / mag, -x / mag];
  }

  function updateNormals() {
    yarnPath[0].normal = unitNormal(
      nodes[yarnPath[0].cnIndex],
      nodes[yarnPath[1].cnIndex],
      true
    );

    for (let index = 1; index < yarnPath.length - 1; index++) {
      let flip;
      if (yarnPath[index].cnType?.[1] === "H") {
        if (yarnPath[index].row % 2 == 0) {
          flip = true;
        } else {
          flip = false;
        }
      } else {
        if (yarnPath[index].row % 2 == 0) {
          flip = false;
        } else {
          flip = true;
        }
      }

      yarnPath[index].normal = unitNormal(
        nodes[yarnPath[index - 1].cnIndex],
        nodes[yarnPath[index + 1].cnIndex],
        flip
      );
    }

    yarnPath.at(-1).normal = unitNormal(
      nodes[yarnPath.at(-2).cnIndex],
      nodes[yarnPath.at(-1).cnIndex],
      true
    );
  }

  ///////////////////////
  // CURVE
  ///////////////////////
  const openYarnCurve = d3
    .line()
    .x((d) => nodes[d.cnIndex].x + (yarnWidth / 2) * d.normal[0])
    .y((d) => nodes[d.cnIndex].y + (yarnWidth / 2) * d.normal[1])
    .curve(d3.curveCatmullRomOpen);

  function yarnCurve(yarnLink) {
    const index = yarnLink.index;

    if (index == 0 || index > yarnPathLinks.length - 3) {
      return `M ${yarnLink.source.x} ${yarnLink.source.y} ${yarnLink.target.x} ${yarnLink.target.y}`;
    }

    const linkData = [
      yarnPath[index - 1],
      yarnPath[index],
      yarnPath[index + 1],
      yarnPath[index + 2],
    ];

    return openYarnCurve(linkData);
  }

  ///////////////////////
  // SEGMENT SORTING
  ///////////////////////
  function sortSegments() {
    const sortedSegments = {
      front: { border: [] },
      back: { border: [] },
      mid: { border: [] },
    };

    for (const color of yarnSet) {
      sortedSegments.front[color] = [];
      sortedSegments.back[color] = [];
      sortedSegments.mid[color] = [];
    }

    return sortedSegments;
  }

  ///////////////////////
  // YARN COLOR
  ///////////////////////
  function yarnColor(rowNum) {
  let r = rowNum;
  const lo = Y_PADDING;
  const hi = stitchPattern.height - Y_PADDING - 1;
  if (!Number.isFinite(r)) r = lo;
  if (r < lo) r = lo;
  if (r > hi) r = hi;
  return yarnSequence[(r - Y_PADDING) % yarnSequence.length];
}


  ///////////////////////
  // DRAW
  ///////////////////////
  function drawSegmentsToLayer(context, layer) {
    context.lineWidth = yarnWidth;

    Object.entries(layer).forEach(([colorIndex, paths]) => {
      context.strokeStyle = yarnPalette[colorIndex];
      context.stroke(new Path2D(paths.join(" ")));
    });
  }

  function draw() {
    frontCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    midCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    backCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    updateNormals();

    const layers = sortSegments();

    yarnPathLinks.forEach((link, index) => {
      if (index == 0 || index > yarnPathLinks.length - 3) return;
      const colorIndex = yarnColor(link.row);
      layers[link.layer][colorIndex].push(yarnCurve(link));
    });
    // ===== YarnSim-style loop legs (visual only) =====
yarnPath.forEach((p, idx) => {
  if (!p.cnType || p.cnType[1] !== 'H') return;

  const node = nodes[p.cnIndex];
  if (!node) return;

  const below = nodes.find(
    n => n.i === node.i && n.j === node.j - 1
  );
  if (!below) return;

  const colorIndex = yarnColor(p.row);

  const dx = yarnWidth * 0.35;

  layers.mid[colorIndex].push(
    `M ${node.x - dx} ${node.y} L ${below.x - dx} ${below.y}`,
    `M ${node.x + dx} ${node.y} L ${below.x + dx} ${below.y}`
  );
});





    drawSegmentsToLayer(backCtx, layers.back);
    drawSegmentsToLayer(frontCtx, layers.front);
    drawSegmentsToLayer(midCtx, layers.mid);
  }  
    

  ///////////////////////
  // RELAX
  ///////////////////////
  function relax(steps = 1) {
  if (relaxed) return;

  sim = d3
    .forceSimulation(nodes)
    .alphaMin(ALPHA_MIN)
    .alphaDecay(ALPHA_DECAY)
    .force(
      "link",
      yarnLinkForce(yarnPathLinks)
        .strength(LINK_STRENGTH)
        .iterations(ITERATIONS)
        .distance((l) => {
          if (l.isCrossing)
            return stitchHeight * HEIGHT_SHRINK;
          return Math.abs(l.source.x - l.target.x);
        })
    )
    .on("tick", draw);

  relaxed = true;

  const n = Math.max(1, parseInt(steps || 1, 10));
  sim.tick(n);
  sim.stop();
  draw();
}

  function stopSim() {
    if (sim) sim.stop();
  }

  // initial draw
  draw();

  // ===== Compatibility addition (non-breaking) =====
  function getState() {
    return {
      nodes,
      yarnPath,
      yarnPathLinks,
      yarnWidth,
      stitchHeight,
      canvasWidth,
      canvasHeight,
    };
  }
  return {
  relax,
  stopSim,

  nodes,
  yarnPath,
  yarnPathLinks,
  yarnWidth,
  stitchHeight,
  canvasWidth,
  canvasHeight,
};

  return { relax, stopSim, getState };
}
