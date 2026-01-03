const KNIT = "K";
const PURL = "P";
const TUCK = "T";
const MISS = "M";
const M1 = "Y";


const ECN = "ECN";
const PCN = "PCN";
const ACN = "ACN";
const UACN = "UACN";

function followTheYarn(DS) {
  let i = 0,
    j = 0,
    phase = 0,
    legNode = true,
    currentStitchRow = 0;
  const yarnPath = [];
  const orderByCn = new Map();
  const orderFromPhase = (p) => (p === 0 || p === 2 ? "a" : "b");
  

  const makeCnType = (cnI, row, side, layer, phase, stType = null) => {
    if (phase === 0 || phase === 1 || phase === 2 || phase === 3) {
      let order = orderFromPhase(phase);
      if (stType === M1 && side === "L" && layer === "H") {
        order = order === "a" ? "b" : "a";
      }
      return side + layer + order;
    }
    const key = `${row}:${cnI}:${side}${layer}`;
    const count = orderByCn.get(key) ?? 0;
    orderByCn.set(key, count + 1);
    const order = count === 0 ? "a" : "b";
    return side + layer + order;
  };

  function closeRowEnd() {
    const last = yarnPath.at(-1);
    if (!last) return;
    const [li, lj, lrow, lpart] = last;
    if (lrow !== currentStitchRow) return;
    const isLeg = lpart[1] === "B";
    const movingRight = currentStitchRow % 2 == 0;
    const dir = movingRight ? 1 : -1;
    const rowJ = isLeg ? lj : (lj - 1);
    const getType = typeof DS.getStitchType === "function"
      ? DS.getStitchType.bind(DS)
      : DS.getST.bind(DS);
    const findRowEndI = () => {
      if (movingRight) {
        for (let i = DS.width - 1; i >= 0; i--) {
          if (getType(i, rowJ)) return i;
        }
      } else {
        for (let i = 0; i < DS.width; i++) {
          if (getType(i, rowJ)) return i;
        }
      }
      return null;
    };
    let nextI = li + dir;

    if (rowJ < 0 || rowJ >= DS.height) return;
    if (nextI < 0 || nextI >= DS.width) return;

    // Add the next stitch legs (FBa/FBb) to complete the row tail.
    let stType = getType(nextI, rowJ);
    if (!stType) {
      const rowEndI = findRowEndI();
      if (!Number.isFinite(rowEndI)) return;
      nextI = rowEndI;
      stType = getType(nextI, rowJ);
    }
    yarnPath.push([nextI, rowJ, lrow, makeCnType(nextI, lrow, "F", "B", 0, stType)]);
    yarnPath.push([nextI, rowJ, lrow, makeCnType(nextI, lrow, "F", "B", 1, stType)]);


  }

  // Ensure the first emitted point is the first leg of a real stitch.
  // This avoids starting on a head node when the initial CN is empty/padding.
  {
    const maxSteps = DS.width * DS.height * 4;
    let guard = 0;
    while (
      guard < maxSteps &&
      !(legNode && addToList(i, j, legNode, phase, currentStitchRow, yarnPath, DS))
    ) {
      const next = nextCN(i, j, phase, currentStitchRow, DS);
      ({ i, j, phase, legNode, currentStitchRow } = next);
      guard++;
    }
    if (legNode && addToList(i, j, legNode, phase, currentStitchRow, yarnPath, DS)) {
      const side = phase < 2 ? "F" : "L";
      const stType = DS.getST(i, j);
      yarnPath.push([i, j, currentStitchRow, makeCnType(i, currentStitchRow, side, "B", phase, stType)]);
      const next = nextCN(i, j, phase, currentStitchRow, DS);
      ({ i, j, phase, legNode, currentStitchRow } = next);
    }
  }

  while (j < DS.height) {
    const side = phase < 2 ? "F" : "L";
    // cnType uses F/L for CN order and H/B for layer; within-CN a/b order is conceptual only.

    const added = addToList(i, j, legNode, phase, currentStitchRow, yarnPath, DS);
    if (added) {
      let location;
      const stTypeForPhase = DS.getStitchType?.(i, j);
      if (legNode) {
        // leg nodes do not move
        const stType = stTypeForPhase ?? DS.getST(i, j);
        location = [i, j, currentStitchRow, makeCnType(i, currentStitchRow, side, "B", phase, stType)];
      } else {
        // head nodes might move, find final location
        const final = finalLocation(i, j, DS);
        const stType =
          (DS.getStitchType?.(i, j - 1)) ?? // stitch type belongs to the row below this head
          DS.getST(i, j - 1);
        location = [final.i, final.j, currentStitchRow, makeCnType(final.i, currentStitchRow, side, "H", phase, stType)];
      }

      yarnPath.push(location);
    
    }

    // figure out which CN to process next
    const next = nextCN(
      i,
      j,
      phase,
      currentStitchRow,
      DS
    );
    if (next.currentStitchRow !== currentStitchRow) {
      closeRowEnd();
    }
    ({ i, j, phase, legNode, currentStitchRow } = next);
  }

  return yarnPath;
}

function addToList(i, j, legNode, phase, currentStitchRow, yarnPath, DS) {
  // determines whether to add a contact node to the yarn path

  if (legNode) {
    // if it is a leg node
    const st = DS.getStitchType?.(i, j) ?? DS.getST(i, j);
    return st == KNIT || st == PURL || st == M1 || st == MISS;
  } else {
    // head node
    let AV = DS.getAV(i, j);

    if (AV == ECN) {
      return false;
    } else if (AV == UACN) {
      if (phase >= 2) {
        DS.setAV(i, j, ACN);
        return true;
      }
      let m, n, row, part;
      if (i % 2 != j % 2) {
        // if parities are different, we look backward in the yarn path
        [m, n, row, part] = yarnPath.at(-1);
      } else {
        // When the parities are the same, the check looks forward along the yarn
        const check = nextCN(i, j, phase, currentStitchRow, DS);
        m = check.i;
        n = check.j;
      }
      // Determine final location
      const final = finalLocation(i, j, DS);

      if (n < final.j) {
        // if this CN is anchored
        DS.setAV(i, j, ACN); // update CN state
        return true;
      } else {
        return false;
      }
    } else {
      // it is an ACN or PCN
      return true;
    }
  }
}

function finalLocation(i, j, DS) {
  // determines where ACNs in the CN[i,j] grid end up in the yarn[i,j] grid
  const [di, dj] = DS.getMV(i, j);

  if (j == DS.height - 1) {
    return { i, j };
  } else if (di != 0) {
    // move horizontally
    return finalLocationRecursive(i + di, j, DS);
  } else {
    // move vertically
    return finalLocationRecursive(i, j + dj, DS);
  }
}

function finalLocationRecursive(i, j, DS) {
  // console.log(DS.getST(i, j));
  if (DS.getST(i, j) == KNIT || DS.getST(i, j) == PURL || DS.getST(i, j) == M1) {
    // CN is actualized with a knit or purl stitch
    return { i, j };
  } else if (j == DS.height - 1) {
    // if we hit the top, return? Is this right?
    return { i, j };
  } else {
    // console.log(j + DS.getDeltaJ(i, j));
    // Otherwise we need to accumulate vertical movement
    const dj = DS.getDeltaJ(i, j);
    if (dj === 0) {
      // empty/cleared cell: stop to avoid infinite recursion
      return { i, j };
    }
    return finalLocationRecursive(i, j + dj, DS);
  }
}

// function acnsAt(i, J, DS) {
// determines which ACNs are positioned at location (i,j) in the CN grid
// const ACNList = [];
// for all in 13*4
// check mv
// }

function nextCN(i, j, phase, currentStitchRow, DS) {
  // determines which CN to process next. CNs are processed in a square wave order
  // and reverse direction each row (as a knitting carriage does)
  const movingRight = currentStitchRow % 2 == 0;
  const dir = movingRight ? 1 : -1;

  let iNext = i;
  let jNext = j;
  let nextPhase = phase;

  if (phase === 0) {
    // first CN bottom (a) -> second CN bottom (b)
    iNext = i + dir;
    nextPhase = 1;
  } else if (phase === 1) {
    // second CN bottom (b) -> first CN head (a)
    iNext = i - dir;
    jNext = j + 1;
    nextPhase = 2;
  } else if (phase === 2) {
    // first CN head (a) -> second CN head (b)
    iNext = i + dir;
    nextPhase = 3;
  } else {
    // second CN head (b) -> next stitch first CN bottom (a)
    iNext = i + dir;
    jNext = j - 1;
    nextPhase = 0;
  }

  if (iNext < 0 || iNext >= DS.width) {
    const nextRow = currentStitchRow + 1;
    const startI = movingRight ? (DS.width - 1) : 0;
    const baseJ = (phase < 2) ? j : (j - 1);
    return {
      i: startI,
      j: baseJ + 1,
      phase: 0,
      legNode: true,
      currentStitchRow: nextRow,
    };
  }

  return {
    i: iNext,
    j: jNext,
    phase: nextPhase,
    legNode: nextPhase < 2,
    currentStitchRow: currentStitchRow,
  };
}

function calcLayer(nodes, source, target, lastType) {
  const isK =
    (nodes[source].st == "K" || nodes[source].st == "Y") &&
    (nodes[target].st == "K" || nodes[target].st == "Y");
  const isP = nodes[source].st == "P" && nodes[target].st == "P";
  if (!isK && !isP) return "mid";

  const baseLayer = lastType?.[1] === "B" ? "back" : "front";
  return isP ? (baseLayer === "back" ? "front" : "back") : baseLayer;
}

export class YarnModel {
  // ok. start by making a grid of nodes. these are all of the contact neighborhoods.
  constructor(cns) {
    this.width = cns.width;
    this.height = cns.height;
    this.cns = cns;

    this.contactNodes = cns.contacts.map((cn, i) => {
      const cj = Math.floor(i / this.width);
      const ci = i % this.width;
      const stitchLookup = typeof cns.getStitchType === "function"
        ? cns.getStitchType.bind(cns)
        : null;
      const stType = stitchLookup
        ? (cj > 0 ? (stitchLookup(ci, cj - 1) ?? stitchLookup(ci, cj)) : stitchLookup(ci, cj))
        : null;
      return {
        index: i,
        st: stType ?? cn[0] ?? null,
        cn: cn[1],
        mv: cn[2],
      };
    });

    this.yarnPath = followTheYarn(cns);
  }

  // There are four kinds of yarn CNS:
  // first head
  // last head
  // first leg
  //  last leg
  // they're NOT left and right - they depend on the direction the yarn is going

  yarnPathToLinks() {
    let source = 0;
    let last = this.yarnPath[0][3];
    const links = [];

    this.yarnPath.forEach(([i, j, stitchRow, headOrLeg], index) => {
      if (index == 0) return;
      let target = j * this.width + i;
      const linkType = last.slice(0, 2) + headOrLeg.slice(0, 2);
      const isCrossing =
        linkType === "FBFH" ||
        linkType === "FHFB" ||
        linkType === "LBLH" ||
        linkType === "LHLB";
      links.push({
        source: source,
        target: target,
        linkType,
        row: stitchRow,
        index: index - 1,
        layer: calcLayer(this.contactNodes, source, target, last),
        isCrossing,
      });
      source = target;
      last = headOrLeg;
    });

    return links;
  }

  makeNice() {
    return this.yarnPath.map(([i, j, stitchRow, headOrLeg]) => {
      // [flat CN index, stitchrow, headOrLeg, angle]
      const cnIndex = j * this.width + i;
      const isHead = headOrLeg?.[1] === "H";
      const ownerJ = isHead ? (j - 1) : j;
      const stFromLookup = (typeof this.cns.getStitchType === "function" && ownerJ >= 0)
        ? this.cns.getStitchType(i, ownerJ)
        : null;
      const stNode = this.contactNodes[cnIndex]?.st ?? null;
      return {
        cnIndex,
        i: i,
        j: j,
        row: stitchRow,
        cnType: headOrLeg,
        st: stFromLookup ?? stNode ?? null,
        angle: null,
        normal: [0, 0],
      };
    });
  }
}
