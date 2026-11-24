/**
 * Minimal QR Code encoder (byte mode, error correction level M, versions 1-10).
 *
 * Why hand-rolled: the desktop app must work offline and the Content-Security-Policy
 * only allows `img-src 'self' data:`, so a remote QR service is not an option and a
 * runtime dependency is not worth 40 KB for one dialog.
 *
 * API: `qrMatrix(text)` -> boolean[][], true = dark module. Throws when the payload
 * does not fit in version 10 (about 210 bytes), which is far beyond a share link.
 */

const EC_M = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: { ec: 22, groups: [[2, 38], [2, 39]] },
  9: { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] },
};

const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const FORMAT_EC_M = 0; // EC level M is 00b in the format information
const PAD = [0xec, 0x11];

/* ---------------- GF(256) ---------------- */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

/* ---------------- bit buffer ---------------- */
class Bits {
  constructor() { this.bits = []; }
  push(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() { return this.bits.length; }
  toBytes() {
    const out = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (this.bits[i + j] || 0);
      out.push(byte);
    }
    return out;
  }
}

function dataCodewords(version) {
  return EC_M[version].groups.reduce((sum, [count, size]) => sum + count * size, 0);
}

function chooseVersion(byteLength) {
  for (let version = 1; version <= 10; version++) {
    const countBits = version < 10 ? 8 : 16;
    const needed = 4 + countBits + byteLength * 8;
    if (needed <= dataCodewords(version) * 8) return version;
  }
  throw new Error(`QR payload too large: ${byteLength} bytes (max 210)`);
}

function buildCodewords(bytes, version) {
  const capacity = dataCodewords(version);
  const stream = new Bits();
  stream.push(0b0100, 4); // byte mode
  stream.push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) stream.push(byte, 8);
  const capacityBits = capacity * 8;
  for (let i = 0; i < 4 && stream.length < capacityBits; i++) stream.bits.push(0);
  while (stream.length % 8 !== 0) stream.bits.push(0);
  const out = stream.toBytes();
  let padIndex = 0;
  while (out.length < capacity) out.push(PAD[padIndex++ % 2]);

  const { ec, groups } = EC_M[version];
  const blocks = [];
  let cursor = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      const data = out.slice(cursor, cursor + size);
      cursor += size;
      blocks.push({ data, ec: rsRemainder(data, ec) });
    }
  }
  const interleaved = [];
  const maxData = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.data.length) interleaved.push(block.data[i]);
  }
  for (let i = 0; i < ec; i++) {
    for (const block of blocks) if (i < block.ec.length) interleaved.push(block.ec[i]);
  }
  return interleaved;
}

/* ---------------- BCH ---------------- */
function formatBits(mask) {
  const data = (FORMAT_EC_M << 3) | mask;
  let value = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((value >>> i) & 1) value ^= 0x537 << (i - 10);
  }
  return ((data << 10) | value) ^ 0x5412;
}

function versionBits(version) {
  let value = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((value >>> i) & 1) value ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | value;
}

/* ---------------- matrix ---------------- */
function emptyMatrix(size) {
  return Array.from({ length: size }, () => new Array(size).fill(false));
}

function placeFinder(matrix, reserved, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || x < 0 || y >= matrix.length || x >= matrix.length) continue;
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark = inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      matrix[y][x] = dark;
      reserved[y][x] = true;
    }
  }
}

function setupFunctionPatterns(matrix, reserved, version) {
  const size = matrix.length;
  placeFinder(matrix, reserved, 0, 0);
  placeFinder(matrix, reserved, 0, size - 7);
  placeFinder(matrix, reserved, size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    matrix[6][i] = dark; reserved[6][i] = true;
    matrix[i][6] = dark; reserved[i][6] = true;
  }

  // Alignment patterns
  const centers = ALIGNMENT[version];
  for (const row of centers) {
    for (const col of centers) {
      // Skip the three positions that overlap finder patterns.
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          matrix[row + r][col + c] = dark;
          reserved[row + r][col + c] = true;
        }
      }
    }
  }

  // Dark module
  matrix[size - 8][8] = true;
  reserved[size - 8][8] = true;

  // Reserve format information areas
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  // Version information (v7+)
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const bit = (versionBits(version) >>> i) & 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      matrix[b][a] = bit === 1; reserved[b][a] = true;
      matrix[a][b] = bit === 1; reserved[a][b] = true;
    }
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function placeData(matrix, reserved, codewords) {
  const size = matrix.length;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  const bitAt = (index) => index < totalBits ? ((codewords[index >> 3] >>> (7 - (index & 7))) & 1) === 1 : false;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset++) {
        const col = right - offset;
        if (reserved[row][col]) continue;
        matrix[row][col] = bitAt(bitIndex++);
      }
    }
    upward = !upward;
  }
}

function applyMask(matrix, reserved, mask) {
  const size = matrix.length;
  const test = MASKS[mask];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && test(r, c)) matrix[r][c] = !matrix[r][c];
    }
  }
}

function writeFormat(matrix, reserved, mask) {
  const size = matrix.length;
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    // first copy: the vertical strip beside the top-left finder, then the horizontal one
    if (i < 6) matrix[i][8] = dark;
    else if (i === 6) matrix[7][8] = dark;
    else if (i === 7) matrix[8][8] = dark;
    else if (i === 8) matrix[8][7] = dark;
    else matrix[8][14 - i] = dark;
    // second copy: split between the top-right and bottom-left finders
    if (i < 8) matrix[8][size - 1 - i] = dark;
    else matrix[size - 15 + i][8] = dark;
  }
  matrix[size - 8][8] = true;
  reserved[size - 8][8] = true;
}

function penalty(matrix) {
  const size = matrix.length;
  let score = 0;
  const runScore = (line) => {
    let value = 0;
    for (let i = 0; i < line.length; i++) {
      let run = 1;
      while (i + run < line.length && line[i + run] === line[i]) run++;
      if (run >= 5) value += 3 + (run - 5);
      i += run - 1;
    }
    return value;
  };
  for (let r = 0; r < size; r++) score += runScore(matrix[r]);
  for (let c = 0; c < size; c++) score += runScore(matrix.map((row) => row[c]));

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) score += 3;
    }
  }

  const pattern = [true, false, true, true, true, false, true, false, false, false, false];
  const reverse = [...pattern].reverse();
  const matches = (line, at, needle) => needle.every((v, i) => line[at + i] === v);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      if (matches(matrix[r], c, pattern) || matches(matrix[r], c, reverse)) score += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    const column = matrix.map((row) => row[c]);
    for (let r = 0; r <= size - 11; r++) {
      if (matches(column, r, pattern) || matches(column, r, reverse)) score += 40;
    }
  }

  const dark = matrix.flat().filter(Boolean).length;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  const version = chooseVersion(bytes.length);
  const codewords = buildCodewords(bytes, version);
  const size = 17 + version * 4;

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const matrix = emptyMatrix(size);
    const reserved = emptyMatrix(size);
    setupFunctionPatterns(matrix, reserved, version);
    placeData(matrix, reserved, codewords);
    applyMask(matrix, reserved, mask);
    writeFormat(matrix, reserved, mask);
    const score = penalty(matrix);
    if (!best || score < best.score) best = { score, matrix };
  }
  return best.matrix;
}

export function qrSvg(text, options = {}) {
  const matrix = qrMatrix(text);
  const size = matrix.length;
  const quiet = options.quiet ?? 4;
  const total = size + quiet * 2;
  const rects = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) rects.push(`M${c + quiet} ${r + quiet}h1v1h-1z`);
    }
  }
  return {
    size,
    viewBox: `0 0 ${total} ${total}`,
    path: rects.join(""),
  };
}

/** Test/debug helpers: block layout and the function-module map for a version. */
export const QR_EC_LAYOUT = EC_M;
export function qrReserved(version) {
  const size = 17 + version * 4;
  const matrix = emptyMatrix(size);
  const reserved = emptyMatrix(size);
  setupFunctionPatterns(matrix, reserved, version);
  return { matrix, reserved, size };
}
