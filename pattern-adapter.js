// pattern-adapter.js

export class Bimp {
  constructor(w, h, pixels, m1Dir = null) {
    this.width = w;
    this.height = h;
    this.pixels = pixels;
    this.m1Dir = m1Dir;
  }

  pad(xPad, yPad, fill) {
    const nw = this.width + xPad * 2;
    const nh = this.height + yPad * 2;
    const out = new Uint8Array(nw * nh).fill(fill);
    const outM1Dir = this.m1Dir ? new Array(nw * nh).fill(null) : null;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const outIndex = (y + yPad) * nw + (x + xPad);
        const inIndex = y * this.width + x;
        out[outIndex] = this.pixels[inIndex];
        if (outM1Dir) {
          outM1Dir[outIndex] = this.m1Dir[inIndex] ?? null;
        }
      }
    }
    return new Bimp(nw, nh, out, outM1Dir);
  }
}

/**
 * Convert AppPattern (UI rows)
 *
 * IMPORTANT:
 * YarnSim assumes row 0 is the BOTTOM row.
 */
// Normalize UI pattern rows, expanding YO (increase) and materializing decrease heads
export function normalizeAppPattern(AppPattern) {
  const rowsOut = [];

  function prevFaceType(row, idx) {
    for (let j = idx - 1; j >= 0; j--) {
      const st = row[j];
      if (!st) continue;
      if (st.type === 'dec_pad') continue;
      if (st.type === 'space') continue; // space only affects layout, not stitches
      return st.type === 'purl' ? 'purl' : 'knit';
    }
    return 'knit';
  }
  function isLastStitch(row, idx) {
    for (let j = idx + 1; j < row.length; j++) {
      const st = row[j];
      if (!st) continue;
      if (st.type === 'dec_pad') continue;
      return false;
    }
    return true;
  }

  for (const row of AppPattern.rows) {
    const out = [];
    for (let i = 0; i < row.length; i++) {
      const st = row[i];
      if (!st) continue;
      if (st.type === 'dec_pad') continue;

      if (st.type === 'space') {
        // Preserve column for spacing; maps to empty in bitmap.
        out.push({ type: 'space' });
        continue;
      }

      if (st.type === 'yo') {
        // YO is treated as a single M1 stitch (no extra base stitch).
        // Do not set m1Dir so M1 uses the same CN coordinates as knit.
        out.push({ type: 'm1', color: st.color, isYO: true, opacity: st.opacity });
        continue;
      }

      if (st.type === 'k2tog' || st.type === 'ssk') {
        // decrease: emit two heads based on the previous face type
        const face = prevFaceType(row, i);
        out.push(
          { type: face, color: st.color, opacity: st.opacity },
          { type: face, color: st.color, opacity: st.opacity }
        );
        continue;
      }

      out.push(st);
    }
    rowsOut.push(out);
  }
  while (rowsOut.length > 1 && rowsOut[0].length === 0) {
    rowsOut.shift();
  }
  return { rows: rowsOut };
}

export function appPatternToBimp(AppPattern) {
  const normalized = normalizeAppPattern(AppPattern);
  const rows = normalized.rows;

  const h = rows.length;
  const w = Math.max(1, ...rows.map(r => r.length));

  const EMPTY_PIX = 4;
  const M1_PIX = 5;
  const map = {
    knit: 0,
    purl: 1,
    miss: 2,
    tuck: 3,
    empty: EMPTY_PIX,
    space: EMPTY_PIX,
    yo: M1_PIX,
    m1: M1_PIX,
  };

  const pixels = new Uint8Array(w * h);
  const m1Dir = new Array(w * h).fill(null);
  let hasM1Dir = false;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const stitch = rows[y]?.[x];
      const s = stitch?.type ?? "empty";
      const idx = y * w + x;
      pixels[idx] = map[s] ?? EMPTY_PIX;
      if (s === "m1" && stitch?.m1Dir) {
        m1Dir[idx] = stitch.m1Dir;
        hasM1Dir = true;
      }
    }
  }

  return new Bimp(w, h, pixels, hasM1Dir ? m1Dir : null);
}
