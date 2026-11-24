import assert from "node:assert/strict";
import { qrMatrix, qrSvg, qrReserved, QR_EC_LAYOUT } from "../src/renderer/qr.js";

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

function readFormat(matrix, size) {
  let raw = 0;
  for (let i = 0; i < 15; i++) {
    const bit = i < 8 ? matrix[8][size - 1 - i] : matrix[size - 15 + i][8];
    if (bit) raw |= 1 << i;
  }
  const value = raw ^ 0x5412;
  // Independent BCH(15,5) check: the remainder of g(x)=0x537 must be zero.
  let rest = value;
  for (let i = 14; i >= 10; i--) if ((rest >>> i) & 1) rest ^= 0x537 << (i - 10);
  assert.equal(rest, 0, "format information must carry a valid BCH checksum");
  const data = value >> 10;
  return { ec: (data >> 3) & 0b11, mask: data & 0b111 };
}

/** Independent decoder used to prove the encoder round-trips. */
function decode(matrix) {
  const size = matrix.length;
  assert.equal((size - 17) % 4, 0, "matrix size must describe an integer version");
  const version = (size - 17) / 4;
  const { ec, mask } = readFormat(matrix, size);
  assert.equal(ec, 0b00, "encoder must use error correction level M");
  assert.ok(mask >= 0 && mask < 8, "format carries a mask number");

  const { reserved } = qrReserved(version);
  const bits = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset++) {
        const col = right - offset;
        if (reserved[row][col]) continue;
        bits.push(matrix[row][col] !== MASKS[mask](row, col) ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  const layout = QR_EC_LAYOUT[version];
  const blocks = [];
  for (const [count, blockSize] of layout.groups) {
    for (let i = 0; i < count; i++) blocks.push({ size: blockSize, data: [] });
  }
  let cursor = 0;
  const maxData = Math.max(...blocks.map((block) => block.size));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.size) block.data.push(codewords[cursor++]);
  }
  const data = blocks.flatMap((block) => block.data);

  const stream = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1));
  let pos = 0;
  const take = (length) => {
    let value = 0;
    for (let i = 0; i < length; i++) value = (value << 1) | stream[pos++];
    return value;
  };
  const mode = take(4);
  assert.equal(mode, 0b0100, "encoder must use byte mode");
  const length = take(version < 10 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < length; i++) bytes.push(take(8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function assertFunctionPatterns(matrix) {
  const size = matrix.length;
  const finder = (row, col) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const expect = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        assert.equal(matrix[row + r][col + c], expect, `finder at ${row},${col} row ${r} col ${c}`);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    assert.equal(matrix[6][i], i % 2 === 0, "horizontal timing pattern alternates");
    assert.equal(matrix[i][6], i % 2 === 0, "vertical timing pattern alternates");
  }
  assert.equal(matrix[size - 8][8], true, "dark module is always set");
}

const samples = [
  "https://example.com",
  "https://random-words-4821.trycloudflare.com",
  "HI",
  "共享密码：hymnix-2026",
  "x".repeat(120),
];

for (const sample of samples) {
  const matrix = qrMatrix(sample);
  assertFunctionPatterns(matrix);
  assert.equal(decode(matrix), sample, `round-trip for ${JSON.stringify(sample.slice(0, 24))}`);
}

assert.throws(() => qrMatrix("y".repeat(400)), /too large/);
const svg = qrSvg("https://example.com/a?b=1");
assert.ok(svg.path.length > 100, "SVG path carries the dark modules");
assert.ok(svg.viewBox.startsWith("0 0 "), "SVG has a view box with a quiet zone");

console.log("qr encoder: round-trip, function patterns and capacity checks passed");
