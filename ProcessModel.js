const ECN = "ECN";
const PCN = "PCN";
const ACN = "ACN";
const UACN = "UACN";

const KNIT = "K";
const PURL = "P";
const TUCK = "T";
const MISS = "M";
const EMPTY = "E";
const M1 = "Y";

class ContactNeighborhood {
  constructor(m, n, populateFirstRow = true) {
    this.width = 2 * m;
    this.height = n + 1;
    this.stitchType = new Array(this.width * this.height).fill(null);

    // Initialize empty contact neighborhood data structure: 2m x (n+1)
    this.contacts = Array.from({ length: this.width * this.height }, () => [
      null,
      ECN,
      [null, null],
    ]);

    if (populateFirstRow) {
      for (let i = 0; i < this.width; i++) {
        this.setAV(i, 0, PCN);
        this.setMV(i, 0, [0, 0]);
      }
    }
  }

  getST(i, j) {
    return this.neighborhood(i, j)[0];
  }

  setSt(i, j, st) {
    this.neighborhood(i, j)[0] = st;
  }

  getAV(i, j) {
    return this.neighborhood(i, j)[1];
  }

  // AV: Actualization Value
  setAV(i, j, cnType) {
    this.neighborhood(i, j)[1] = cnType;
  }

  getMV(i, j) {
    return this.neighborhood(i, j)[2];
  }

  getDeltaI(i, j) {
    return this.neighborhood(i, j)[2][0];
  }

  getDeltaJ(i, j) {
    return this.neighborhood(i, j)[2][1];
  }

  // MV: Movement vector
  setMV(i, j, mv) {
    this.neighborhood(i, j)[2] = mv;
  }

  setDeltaJ(i, j, deltaJ) {
    this.neighborhood(i, j)[2][1] = deltaJ;
  }

  setDeltaI(i, j, deltaI) {
    this.neighborhood(i, j)[2][0] = deltaI;
  }

  setStitchType(i, j, op, force = false) {
    if (i < 0 || i >= this.width || j < 0 || j >= this.height) return;
    const idx = j * this.width + i;
    if (!force && this.stitchType[idx] !== null && this.stitchType[idx] !== undefined) return;
    this.stitchType[idx] = op;
  }

  getStitchType(i, j) {
    if (i < 0 || i >= this.width || j < 0 || j >= this.height) return null;
    return this.stitchType[j * this.width + i];
  }

  neighborhood(i, j) {
    return this.contacts[j * this.width + i];
  }
}

export class ProcessModel {
  constructor(pattern) {
    this.instructions = pattern;
    this.width = pattern.width; // num cols, M
    this.height = pattern.height; // num rows, N
    this.cn = new ContactNeighborhood(this.width, this.height);
    this.populateContacts();
  }

  handleKPLower(i, j, op) {
    // Set ST
    this.cn.setSt(i, j, op);

    // Leave MV unchanged

    // Figure out how to handle AV
    if (j === 0 && this.cn.getAV(i, j) == ECN) {
      this.cn.setAV(i, j, PCN);
    }
    const AV = this.cn.getAV(i, j);
    const MV = this.cn.getMV(i, j);

    // Actualize PCN with no deltaI
    if (AV == PCN && MV[0] === 0) {
      this.cn.setAV(i, j, ACN);
    }

    if (AV == UACN) {
      // If knitting into UACN, first check the prior row on either side
      if (
        (this.cn.getAV(i + 1, j - 1) == ACN &&
          this.cn.getMV(i + 1, j - 1)[1] == 0) ||
        (this.cn.getAV(i - 1, j - 1) == ACN &&
          this.cn.getMV(i - 1, j - 1)[1] == 0)
      ) {
        // if it holds an ACN that wasn't moved, it is actually anchored. change this row to ACN
        this.cn.setAV(i, j, ACN);
      }

      if (this.cn.getAV(i, j - 1) == PCN) {
        this.cn.setAV(i, j - 1, ACN);
      }
    }
    if (AV == ECN) {
      // Otherwise do not change
    }
  }

  handleKPUpper(i, j) {
    // ST remains null for upper CN

    // Set upper CN MV
    this.cn.setMV(i, j + 1, [0, 0]);

    if (this.cn.getAV(i, j) == ACN) {
      // set to PCN if lower is ACN
      this.cn.setAV(i, j + 1, PCN);
    } else {
      this.cn.setAV(i, j + 1, UACN);
    }

    if (this.cn.getAV(i, j) == UACN) {
      let found = false;
      let search = 0;
      let iter = 0;

      while (!found) {
        if (j - search < 0) {
          break;
        }
        if (this.cn.getAV(i, j - search) === "PCN") {
          found = true;
          this.cn.setAV(i, j - search, ACN);
        }
        search++;
        iter++;
        if (iter > 1000) {
          console.error("COULDN'T FIND STITCH");
          break;
        }
      }
    }
  }

  handleTuckMissUpper(i, j, op) {
    if (op == TUCK) {
      this.cn.setAV(i, j + 1, UACN);
      this.cn.setMV(i, j + 1, [0, 0]);
    } else if (op == MISS) {
      this.cn.setAV(i, j + 1, ECN);
      this.cn.setMV(i, j + 1, [0, -1]);
    }
  }

  handleTuckMissLower(i, j, op) {
    const AV = this.cn.getAV(i, j);
    if (AV == PCN || AV == UACN) {
      // Set deltaJ to one to indicate that the CN has moved up
      this.cn.setDeltaJ(i, j, 1);
    } else if (AV == ECN) {
      // Special case if we are doing a miss stitch above a miss stitch
      // Look down the column to find where the delta J is positive, and increment it.
      let found = false;
      let search = 0;
      let iter = 0;
      while (!found) {
        const deltaJ = this.cn.getMV(i, j - search)[1];
        if (deltaJ > 0) {
          this.cn.setDeltaJ(i, j - search, deltaJ + 1);
          found = true;
        }
        search++;
        iter++;
        if (iter > 1000) {
          console.error("COULDN'T FIND STITCH");
          break;
        }
      }
    }
  }

  resolveM1Offset(i, offset, m1Dir) {
    if (m1Dir !== "L" && m1Dir !== "R") return offset;
    const dirOffset = m1Dir === "L" ? -1 : 1;
    const next = i + dirOffset;
    if (next < 0 || next >= this.cn.width) return offset;
    return dirOffset;
  }

  handleMakeOne(i, j, offset) {
    const prep = (ci, cj) => {
      if (this.cn.getAV(ci, cj) !== ECN) return;
      this.cn.setAV(ci, cj, PCN);
      this.cn.setMV(ci, cj, [0, 0]);
    };

    prep(i, j);
    prep(i + offset, j);

    this.handleKPLower(i, j, M1);
    this.handleKPLower(i + offset, j, M1);

    this.handleKPUpper(i, j);
    this.handleKPUpper(i + offset, j);
  }

  applyRowEndTurn(rowIndex, movingRight, activeMin, activeMax) {
    if (!Number.isFinite(activeMin) || !Number.isFinite(activeMax)) return;
    if (activeMax < 0) return;
    const edgeStitch = movingRight ? activeMax : activeMin;
    const headI = movingRight ? edgeStitch * 2 + 1 : edgeStitch * 2;
    const headJ = rowIndex + 1;
    if (
      headI < 0 ||
      headI >= this.cn.width ||
      headJ < 0 ||
      headJ >= this.cn.height
    ) {
      return;
    }

    const av = this.cn.getAV(headI, headJ);
    if (av === UACN || av === ECN) {
      this.cn.setAV(headI, headJ, PCN);
      this.cn.setMV(headI, headJ, [0, 0]);
    }
  }

  handleEmpty(i, j, offset) {
    // Preserve previously actualized CNs (e.g., heads from the row below) so empty
    // padding columns don't wipe out existing stitches/YO heads.
    const clear = (ci, cj) => {
      const av = this.cn.getAV(ci, cj);
      const st = this.cn.getST(ci, cj);
      if (av !== ECN || st) return;
      this.cn.setSt(ci, cj, null);
      this.cn.setAV(ci, cj, ECN);
      this.cn.setMV(ci, cj, [0, 0]);
    };

    clear(i, j);
    clear(i + offset, j);
    clear(i, j + 1);
    clear(i + offset, j + 1);
  }

  handleOp(i, j, op, offset, m1Dir) {
    // Record intended stitch type for both leg and head positions so downstream
    // consumers (3D/path) can retrieve the original op even after CN reuse.
    if (op != EMPTY && op != null) {
      this.cn.setStitchType(i, j, op, true);
      this.cn.setStitchType(i + offset, j, op, true);
      // head slots: keep the first writer so upper heads aren't clobbered by the next row's legs
      this.cn.setStitchType(i, j + 1, op, false);
      this.cn.setStitchType(i + offset, j + 1, op, false);
    }

    if (op == EMPTY || op == null) {
      this.handleEmpty(i, j, offset);
      return;
    }

    if (op == M1) {
      const m1Offset = this.resolveM1Offset(i, offset, m1Dir);
      this.handleMakeOne(i, j, m1Offset);
      return;
    }

    if (op == KNIT || op == PURL) {
      // lower pair
      this.handleKPLower(i, j, op);
      this.handleKPLower(i + offset, j, op);

      // upper pair
      this.handleKPUpper(i, j, op);
      this.handleKPUpper(i + offset, j, op);
    }

    if (op == TUCK || op == MISS) {
      // lower pair
      this.handleTuckMissLower(i, j, op);
      this.handleTuckMissLower(i + offset, j, op);

      // upper pair
      this.handleTuckMissUpper(i, j, op);
      this.handleTuckMissUpper(i + offset, j, op);
    }
  }

    processRow(n, ltr) {
    let activeMin = Infinity;
    let activeMax = -Infinity;
    const markActive = (m, op) => {
      if (op == EMPTY || op == null || op === -1) return;
      activeMin = Math.min(activeMin, m);
      activeMax = Math.max(activeMax, m);
    };
    if (ltr) {
      // left to right
      for (let m = 0; m < this.width; m++) {
        const op = this.instructions.op(m, n); // get current operation
        markActive(m, op);
        const m1Dir =
          op == M1 && typeof this.instructions.m1DirAt === "function"
            ? this.instructions.m1DirAt(m, n)
            : null;
        this.handleOp(2 * m, n, op, 1, m1Dir);
      }
    } else {
      // right to left
      for (let m = this.width - 1; m >= 0; m--) {
        const op = this.instructions.op(m, n);
        markActive(m, op);
        const m1Dir =
          op == M1 && typeof this.instructions.m1DirAt === "function"
            ? this.instructions.m1DirAt(m, n)
            : null;
        this.handleOp(2 * m + 1, n, op, -1, m1Dir);
      }
    }
    return { activeMin, activeMax };
  }

  populateContacts() {
    let movingRight = true;
    for (let n = 0; n < this.height; n++) {
      // do something each row
      const { activeMin, activeMax } = this.processRow(n, movingRight);
      this.applyRowEndTurn(n, movingRight, activeMin, activeMax);
      movingRight = !movingRight;
    }
  }
}
